// Run: node --test mission-control/lib/watchdog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FleetStatus } from "./types";

// Isolate the SQLite db in a temp FLEET_DIR before anything calls db() (created lazily once).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "watchdog-"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
process.env.FLEET_DIR = TMP;
// phone deliberately UNCONFIGURED: alerts must degrade to audit + state, never throw or hit the network
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_ALLOWED_CHAT_ID;

const { evaluateFleetHealth, runWatchdog, ALERT_COOLDOWN_MS } = await import("./watchdog.ts");
const { getSetting } = await import("./db.ts");

const okStatus = (over: Partial<FleetStatus & { online?: boolean }> = {}): FleetStatus & { online?: boolean } =>
  ({
    schema: 1, supervisor_pid: process.pid, heartbeat: new Date().toISOString(), mode: "running",
    claiming: true, pause_reason: null, knobs: { max_workers: 1, max_pr_per_day: 5, fail_break: 3, router: null, review: null, effort: null, depth: null },
    breaker: { consecutive_fails: 0, tripped: false }, prs_today: 0, attempts_today: 0, applied_rev: 1, slots: [],
    online: true, ...over,
  }) as FleetStatus & { online?: boolean };

test("evaluateFleetHealth: pure states", () => {
  // paused/stopped on purpose → idle, never an alert
  assert.equal(evaluateFleetHealth("paused", null).state, "idle");
  assert.equal(evaluateFleetHealth("stopped", okStatus({ online: false })).state, "idle");
  // desired running, never reported → alert
  const noStatus = evaluateFleetHealth("running", null);
  assert.equal(noStatus.state, "alert");
  assert.match(noStatus.problems[0], /never reported/);
  // healthy → ok
  assert.deepEqual(evaluateFleetHealth("running", okStatus()), { state: "ok", problems: [] });
  // dead supervisor / stale heartbeat → alert
  assert.equal(evaluateFleetHealth("running", okStatus({ online: false })).state, "alert");
  // breaker tripped → alert even while online
  const tripped = evaluateFleetHealth("running", okStatus({ breaker: { consecutive_fails: 5, tripped: true } }));
  assert.equal(tripped.state, "alert");
  assert.match(tripped.problems[0], /breaker/i);
  // fleet reports paused while desired is running → alert
  assert.equal(evaluateFleetHealth("running", okStatus({ mode: "paused" })).state, "alert");
});

test("runWatchdog: alert → cooldown dedupe → recovery all-clear (phone unconfigured degrades gracefully)", async () => {
  const t0 = Date.now();
  // 1. down: first tick records the alert state (phone not configured → audited only)
  const down = { readFleetMode: () => "running", readStatus: () => null };
  const r1 = await runWatchdog(t0, down);
  assert.equal(r1.state, "alert");
  assert.equal(r1.alerted, false); // no phone in tests — degraded, not thrown
  assert.match(r1.note ?? "", /phone not configured/);
  assert.equal(getSetting("watchdog.state"), "alert");

  // 2. still down inside the cooldown → deduped (no second alert attempt)
  const r2 = await runWatchdog(t0 + 60_000, down);
  assert.match(r2.note ?? "", /cooldown/);

  // 3. still down AFTER the cooldown → re-alert path taken again
  const r3 = await runWatchdog(t0 + ALERT_COOLDOWN_MS + 1000, down);
  assert.match(r3.note ?? "", /phone not configured/);

  // 4. back online → recovery all-clear once, state returns to ok
  const up = { readFleetMode: () => "running", readStatus: () => okStatus() };
  const r4 = await runWatchdog(t0 + ALERT_COOLDOWN_MS + 2000, up);
  assert.equal(r4.state, "ok");
  assert.equal(r4.recovered, true);
  assert.equal(getSetting("watchdog.state"), "ok");

  // 5. still ok → quiet (no repeated all-clear)
  const r5 = await runWatchdog(t0 + ALERT_COOLDOWN_MS + 3000, up);
  assert.equal(r5.recovered, false);
});

test("runWatchdog: an intentionally paused fleet never alerts", async () => {
  const r = await runWatchdog(Date.now(), { readFleetMode: () => "paused", readStatus: () => null });
  assert.equal(r.state, "idle");
  assert.equal(r.alerted, false);
  assert.equal(getSetting("watchdog.state"), "idle");
});
