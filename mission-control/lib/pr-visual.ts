// Visual PR approval — PURE server logic for the /api/fleet/pr-visual route (route stays thin).
// Stores the worker's post-PR screenshot under $FLEET_DIR/data/screenshots (0600/0700), derives the
// merge RISK from the changed file paths via the SAME permission-layer rules (detectRisk), builds a
// redacted+compressed diff preview, and creates ONE deduped pending "merge" approval per PR.
// No "server-only" import so `node --test` can exercise it (house style: lib/approvals.ts).
import fs from "node:fs";
import path from "node:path";
import { detectRisk, type Risk, type RiskCategory } from "./permissions.ts";
import { createApproval, listPendingApprovals, type Approval } from "./approvals.ts";
import { redactPreview } from "./redact.ts";
import { compressDiff } from "./token-optimization/compressor.ts";
import { esc } from "./phone/format.ts";

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on the uploaded PNG
const MAX_PREVIEW = 900;

function fleetDir(): string {
  const env = process.env.FLEET_DIR;
  if (env && env.trim()) return env.trim();
  return path.resolve(process.cwd(), "..");
}

/** Strict PR-number parse — the number lands in a filesystem path, so it must be a plain positive int. */
export function parsePrNumber(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function screenshotDir(): string {
  return path.join(fleetDir(), "data", "screenshots");
}
/** Canonical on-disk path for a PR screenshot. Throws on a non-integer pr (path-traversal-proof). */
export function screenshotPath(pr: number): string {
  if (!Number.isSafeInteger(pr) || pr <= 0) throw new Error(`invalid pr: ${pr}`);
  return path.join(screenshotDir(), `pr-${pr}.png`);
}
export function screenshotExists(pr: number): boolean {
  try {
    return fs.existsSync(screenshotPath(pr));
  } catch {
    return false;
  }
}
export function screenshotTooLarge(bytes: number): boolean {
  return !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_SCREENSHOT_BYTES;
}
/** Save (overwrite) the screenshot for a PR — dir 0700, file 0600. Throws on the size guard. */
export function saveScreenshot(pr: number, buf: Buffer): string {
  if (screenshotTooLarge(buf.length)) throw new Error(`screenshot must be 1..${MAX_SCREENSHOT_BYTES} bytes`);
  const file = screenshotPath(pr);
  fs.mkdirSync(screenshotDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600); // writeFileSync mode doesn't apply on overwrite
  } catch {}
  return file;
}

/** Split the worker's newline-separated changed-paths field into clean relative paths. */
export function parseFileList(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500);
}

/** Merge risk from the changed files — the SAME path rules the permission layer uses. A PR with no
 *  known files is diff-blind and detectRisk already fail-closes that to high. */
export function riskForPr(pr: number, files: string[]): { risk: Risk; categories: RiskCategory[] } {
  return detectRisk({ type: "merge", pr, files: files.map((p) => ({ path: p, status: "modified" as const })) });
}

/** Redact + compress the diffstat text into an approval-preview (≤ ~900 chars). Never leaks a secret:
 *  compressDiff redacts on the way in, redactPreview redacts + clamps on the way out. */
export function buildDiffPreview(diffstat: string | null | undefined): string | null {
  const raw = String(diffstat ?? "").trim();
  if (!raw) return null;
  const compressed = compressDiff(raw, Math.ceil(MAX_PREVIEW / 4)); // token budget ≈ chars/4
  return redactPreview(compressed.summary, MAX_PREVIEW);
}

export interface PrVisualInput {
  pr: number;
  issue?: number | null;
  title?: string | null;
  verdict?: string | null;
  diffstat?: string | null;
  files: string[];
}

/** Idempotent per-PR merge approval: reuse a live PENDING kind="merge" approval for this PR (no
 *  duplicate cards on worker retries); otherwise create one carrying the detected risk + preview. */
export function ensureMergeApproval(input: PrVisualInput): { approval: Approval; created: boolean; risk: Risk } {
  const { risk, categories } = riskForPr(input.pr, input.files);
  let existing: Approval | null = null;
  try {
    existing = listPendingApprovals().find((a) => a.kind === "merge" && a.pr === input.pr) ?? null;
  } catch {
    existing = null; // store hiccup → fall through to create (createApproval will surface real errors)
  }
  if (existing) return { approval: existing, created: false, risk };
  const title = String(input.title ?? "").trim();
  const verdict = String(input.verdict ?? "").trim();
  const { approval } = createApproval({
    kind: "merge",
    summary: `Merge PR #${input.pr}${title ? `: ${title}` : ""}`,
    pr: input.pr,
    issue: input.issue ?? null,
    risk: `${risk}${categories.length ? ` · ${categories.join(",")}` : ""}`,
    advice: verdict ? `reviewer verdict: ${verdict}` : null,
    diff_preview: buildDiffPreview(input.diffstat),
    action: { type: "merge", pr: input.pr, deleteBranch: true },
  });
  return { approval, created: true, risk };
}

/** Telegram-HTML photo caption (everything dynamic esc()'d; ≤1024 chars is enforced by the sender). */
export function photoCaption(input: PrVisualInput, risk: Risk): string {
  const lines = [`📸 <b>${esc(String(input.title ?? `PR #${input.pr}`).slice(0, 160))}</b>`];
  const meta = [`🔀 PR #${esc(input.pr)}`, `⚠️ risk: <b>${esc(risk)}</b>`];
  if (input.issue) meta.unshift(`📍 issue #${esc(input.issue)}`);
  lines.push(meta.join("   ·   "));
  const verdict = String(input.verdict ?? "").trim();
  if (verdict) lines.push(`🧪 verdict: ${esc(verdict.slice(0, 120))}`);
  return lines.join("\n");
}
