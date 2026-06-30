// Centralized, pretty Telegram message formatting (HTML parse mode). All DYNAMIC content goes through
// esc() so user/issue text can never break the markup. Static structure uses HTML tags + emoji.
import type { Approval } from "../approvals";
import type { StatusSummary } from "./types";

/** Escape for Telegram HTML parse mode. MUST wrap every dynamic value. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const code = (s: unknown) => `<code>${esc(s)}</code>`;
const RULE = "──────────────";
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ── simple confirmations ──
export const ok = (msg: string) => `✅ ${esc(msg)}`;
export const warn = (msg: string) => `⚠️ ${esc(msg)}`;
export const err = (msg: string) => `🛑 ${esc(msg)}`;
export function info(title: string, lines: string[] = []): string {
  return [`<b>${esc(title)}</b>`, ...lines].filter(Boolean).join("\n");
}

// ── help ──
export function helpCard(): string {
  return [
    "🛰 <b>Mission Control</b> — phone commands",
    "",
    "📊 <b>Status</b>",
    `${code("/status")} ${code("/fleet")} ${code("/agents")} ${code("/tasks")} ${code("/prs")} ${code("/decisions")}`,
    "",
    "🎛 <b>Control</b>",
    `${code("/pause")} ${code("/resume")} ${code("/stop")} ${code("/breaker_reset")}`,
    "",
    "📝 <b>Tasks</b>",
    `${code("/task")} &lt;text&gt;  ·  ${code("/prompt")} &lt;text&gt;  ·  ${code("/goal")} &lt;text&gt;`,
    "",
    "👥 <b>Roles</b>",
    `${code("/assign")} &lt;role&gt; &lt;text&gt;`,
    `${code("/frontend")} ${code("/backend")} ${code("/qa")} ${code("/security")} ${code("/manager")} &lt;text&gt;`,
    "",
    "🔧 <b>Work</b>",
    `${code("/continue")} &lt;issue&gt;  ·  ${code("/cancel")} &lt;issue&gt;  ·  ${code("/priority")} &lt;issue&gt; high|normal|low`,
    "",
    "💬 <i>Or just send an idea — I'll offer to make it a task.</i>",
    "",
    "<b>Examples</b>",
    `${code("/task add a dark-mode toggle")}`,
    `${code("/frontend fix the mobile navbar")}`,
    `${code("/priority 42 high")}`,
  ].join("\n");
}

// ── fleet status ──
export function statusCard(s: StatusSummary): string {
  const head = !s.online
    ? "🔴 <b>Offline</b>"
    : s.claiming
      ? "🟢 <b>Running</b>"
      : `🟡 <b>${esc((s.pauseReason ?? "paused").replace(/_/g, " "))}</b>`;
  const slots = s.slots.length
    ? s.slots
        .map((sl) => `• #${esc(sl.issue ?? "?")} <i>${esc(sl.phase ?? "—")}</i>${sl.title ? ` — ${esc(clip(sl.title, 40))}` : ""}`)
        .join("\n")
    : "<i>idle</i>";
  return [
    `🛰 <b>Mission Control</b>   ${head}`,
    RULE,
    `🧩 mode: <b>${esc(s.mode)}</b>   ·   👷 workers: <b>${esc(s.workers)}</b>`,
    `📋 PRs today: <b>${esc(s.prsToday)}</b>   ·   🧯 breaker: <b>${s.breakerTripped ? "TRIPPED" : "ok"}</b>`,
    `🔐 pending approvals: <b>${esc(s.pendingApprovals)}</b>`,
    "",
    "👷 <b>Workers</b>",
    slots,
  ].join("\n");
}

// ── lists ──
export function listCard(title: string, items: string[], empty: string): string {
  if (!items.length) return `${title}\n<i>${esc(empty)}</i>`;
  return [title, RULE, ...items].join("\n");
}

// ── approval card ──
export function approvalCard(a: Approval): string {
  const lines = [
    `🔐 <b>Approval needed</b> · ${esc(a.kind.replace(/_/g, " "))}`,
    RULE,
    `<b>${esc(clip(a.summary, 200))}</b>`,
  ];
  const meta: string[] = [];
  if (a.agent_id) meta.push(`👤 ${esc(a.agent_id)}`);
  if (a.issue) meta.push(`📍 issue #${esc(a.issue)}`);
  if (a.pr) meta.push(`🔀 PR #${esc(a.pr)}`);
  if (meta.length) lines.push(meta.join("   ·   "));
  if (a.risk) lines.push(`⚠️ <b>risk:</b> ${esc(a.risk)}`);
  if (a.advice) lines.push(`💡 <b>advice:</b> ${esc(a.advice)}`);
  if (a.diff_preview) lines.push("", `<blockquote>${esc(clip(a.diff_preview, 600))}</blockquote>`);
  if (a.expires_at) lines.push("", `⏱ <i>expires ${esc(a.expires_at.slice(0, 16).replace("T", " "))} UTC</i>`);
  return lines.join("\n");
}
