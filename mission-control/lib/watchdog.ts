// Fleet Watchdog — detects a silently-dead fleet and alerts the phone. The failure mode this closes:
// the fleet went down and nobody noticed until the next manual look. Deterministic evaluation (pure,
// unit-testable), deduped alerts (state machine in settings + a cooldown), and a recovery all-clear.
// Trigger: GET/POST /api/fleet/watchdog (systemd timer / cron / uptime service). If the dashboard
// itself is down that route can't run — deploy/watchdog.sh covers that case with a direct Telegram call.
import { getSetting, setSetting, recordAudit } from "./db.ts";
import { esc } from "./phone/format.ts";
import type { FleetStatus } from "./types";

export type WatchdogState = "ok" | "alert" | "idle";

export interface HealthReport {
  state: WatchdogState;
  problems: string[];
}

export const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // re-alert at most every 30 min while still down

/** PURE: desired state + reported status → health. `status.online` is computed by readStatus(). */
export function evaluateFleetHealth(desiredMode: string, status: (FleetStatus & { online?: boolean }) | null): HealthReport {
  // paused/stopped on purpose → the fleet being quiet is EXPECTED; never alert on it.
  if (desiredMode !== "running") return { state: "idle", problems: [] };
  const problems: string[] = [];
  if (!status) problems.push("no status.json — the supervisor has never reported (service not running?)");
  else {
    if (!status.online) problems.push("supervisor offline (dead pid or heartbeat older than 5 min)");
    if (status.breaker?.tripped) problems.push(`circuit breaker TRIPPED (${status.breaker.consecutive_fails} consecutive fails)`);
    if (status.online && status.mode !== "running") problems.push(`desired mode is running but the fleet reports "${status.mode}"${status.pause_reason ? ` (${status.pause_reason})` : ""}`);
  }
  return { state: problems.length ? "alert" : "ok", problems };
}

export interface WatchdogRun extends HealthReport {
  alerted: boolean; // a Telegram alert was actually sent this run
  recovered: boolean; // this run announced the all-clear
  phone_configured: boolean;
  note: string | null;
}

/** Injectable readers so the state machine is unit-testable (fleet.ts is server-only). */
export interface WatchdogDeps {
  readFleetMode?: () => string;
  readStatus?: () => (FleetStatus & { online?: boolean }) | null;
}

/** Run one watchdog tick: evaluate → dedupe → alert/recover via the phone. Never throws. */
export async function runWatchdog(now = Date.now(), deps: WatchdogDeps = {}): Promise<WatchdogRun> {
  let health: HealthReport;
  try {
    let mode: string;
    let status: (FleetStatus & { online?: boolean }) | null;
    if (deps.readFleetMode && deps.readStatus) {
      mode = deps.readFleetMode();
      status = deps.readStatus();
    } else {
      const m = await import("./fleet.ts"); // lazy: fleet.ts is server-only
      mode = (deps.readFleetMode ?? (() => m.readFleet().mode))();
      status = (deps.readStatus ?? m.readStatus)();
    }
    health = evaluateFleetHealth(mode, status);
  } catch (e) {
    health = { state: "alert", problems: [`watchdog could not read fleet state: ${e instanceof Error ? e.message : "error"}`] };
  }

  const prev = (getSetting("watchdog.state", "ok") as WatchdogState) || "ok";
  const lastAlert = Number(getSetting("watchdog.last_alert_ts", "0")) || 0;
  const out: WatchdogRun = { ...health, alerted: false, recovered: false, phone_configured: false, note: null };

  try {
    const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
    out.phone_configured = isPhoneConfigured();

    if (health.state === "alert") {
      const shouldAlert = prev !== "alert" || now - lastAlert >= ALERT_COOLDOWN_MS;
      if (shouldAlert) {
        recordAudit({ actor: "watchdog", via: "system", action: "watchdog.alert", detail: health.problems.join("; ").slice(0, 200) });
        if (out.phone_configured) {
          const text = [
            "🛑 <b>Fleet watchdog</b> — the fleet is DOWN while it should be running",
            ...health.problems.map((p) => `• ${esc(p)}`),
            "",
            "<i>Check: systemctl status dev-fleet · /status here once it's back.</i>",
          ].join("\n");
          const r = await getProvider()!.sendStatusUpdate(text);
          out.alerted = r.ok;
          if (!r.ok) out.note = `alert send failed: ${r.error ?? "unknown"}`;
        } else out.note = "phone not configured — alert only audited";
        setSetting("watchdog.last_alert_ts", String(now));
      } else out.note = "still down — within the alert cooldown";
    } else if (health.state === "ok" && prev === "alert") {
      // recovery all-clear (once, on the alert→ok transition)
      recordAudit({ actor: "watchdog", via: "system", action: "watchdog.recovered", detail: "fleet back online" });
      if (out.phone_configured) {
        const r = await getProvider()!.sendStatusUpdate("✅ <b>Fleet watchdog</b> — the fleet is back online.");
        out.recovered = r.ok;
      } else out.recovered = true; // state machine still recovers without a phone
    }
  } catch (e) {
    out.note = `watchdog notify error: ${e instanceof Error ? e.message : "error"}`;
  }

  try {
    setSetting("watchdog.state", health.state);
    setSetting("watchdog.last_run_ts", String(now));
    setSetting("watchdog.last_problems", health.problems.join(" | ").slice(0, 500));
  } catch {
    /* settings write is best-effort */
  }
  return out;
}
