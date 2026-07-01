// PURE presentation layer for the Decision Inbox. NO server imports (db/fleet/github) so it is shared
// by the client page AND unit-tested under `node --test`. Turns a server `publicApproval` row into the
// derived fields the UI renders: kind label, risk level + tone, target, status, expiry, relative times.
import type { Approval, ApprovalKind } from "./approvals";

/** What actually leaves the server (token hash already stripped by publicApproval). */
export type PublicApproval = Omit<Approval, "decision_token_hash">;
export type RiskLevel = "high" | "medium" | "low" | "none";
/** Visual tone keys → mapped to dark-theme classes in the page (never raw colors here). */
export type Tone = "emerald" | "red" | "amber" | "indigo" | "slate";

const KIND_LABELS: Record<ApprovalKind, string> = {
  merge: "Merge PR",
  cap_increase: "Raise cap",
  force_opus: "Force Opus",
  deploy: "Deploy",
  secret_access: "Secret access",
  plan_signoff: "Plan sign-off",
  risky_action: "Risky action",
  prompt_confirm: "Make a task?",
  workflow_step: "Workflow step",
  escalation: "Team escalation",
};
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as ApprovalKind] ?? kind.replace(/_/g, " ");
}

// Kinds whose default stakes are high/medium when no explicit risk text is provided.
const HIGH_KINDS = new Set(["deploy", "secret_access", "force_opus"]);
const MED_KINDS = new Set(["merge", "cap_increase", "risky_action"]);

/** Classify risk from the (redacted) risk text, falling back to the kind's inherent stakes. */
export function riskLevel(a: { kind: string; risk?: string | null }): RiskLevel {
  const t = (a.risk ?? "").toLowerCase();
  if (/\b(high|critical|danger|halt|irrevers|destroy|delete|drop|force[- ]?push|prod)/.test(t)) return "high";
  if (/\b(medium|moderate|caution|careful)\b/.test(t)) return "medium";
  if (/\b(low|minor|trivial|safe)\b/.test(t)) return "low";
  if (HIGH_KINDS.has(a.kind)) return "high";
  if (MED_KINDS.has(a.kind)) return "medium";
  return a.risk ? "medium" : "none"; // unclassified-but-present risk text ⇒ medium
}

export const RISK_TONE: Record<RiskLevel, Tone> = {
  high: "red",
  medium: "amber",
  low: "emerald",
  none: "slate",
};

export function targetLabel(a: { issue?: number | null; pr?: number | null; work_item_id?: string | null }): string {
  if (a.pr) return `PR #${a.pr}`;
  if (a.issue) return `issue #${a.issue}`;
  if (a.work_item_id) return String(a.work_item_id);
  return "—";
}

export function statusBadge(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "pending": return { label: "Pending", tone: "amber" };
    case "approved": return { label: "Approved", tone: "emerald" };
    case "rejected": return { label: "Rejected", tone: "red" };
    case "expired": return { label: "Expired", tone: "slate" };
    default: return { label: status, tone: "slate" };
  }
}

export function decidedViaLabel(via?: string | null): string {
  if (!via) return "—";
  const m: Record<string, string> = {
    dashboard: "Dashboard", telegram: "Telegram", whatsapp: "WhatsApp",
    phone: "Phone", api: "API token", system: "System",
  };
  return m[via] ?? via;
}

/** Treat a pending row past its expiry as expired even before the DB lazily flips it. */
export function isExpired(a: { status: string; expires_at?: string | null }, now = Date.now()): boolean {
  if (a.status === "expired") return true;
  if (a.status === "pending" && a.expires_at) return Date.parse(a.expires_at) < now;
  return false;
}

function humanizeMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "in 4h" / "expired" / "no expiry". */
export function expiresIn(a: { expires_at?: string | null }, now = Date.now()): string {
  if (!a.expires_at) return "no expiry";
  const ms = Date.parse(a.expires_at) - now;
  return ms <= 0 ? "expired" : `in ${humanizeMs(ms)}`;
}

/** "3m ago" / "just now". */
export function relativeTime(iso?: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return "just now";
  return `${humanizeMs(ms)} ago`;
}

export interface ApprovalView {
  id: string;
  kind: string;
  kindLabel: string;
  summary: string;
  target: string;
  agent: string | null;
  risk: RiskLevel;
  riskText: string | null;
  riskTone: Tone;
  advice: string | null;
  diffPreview: string | null;
  status: string;
  statusLabel: string;
  statusTone: Tone;
  decidedVia: string | null;
  decidedViaLabel: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
  createdLabel: string;
  expiresLabel: string;
  expired: boolean;
  pending: boolean;
  hasTarget: boolean;
  issue: number | null;
  pr: number | null;
  notificationIds: string[];
}

/** Map one server row → everything the card + drawer need. Deterministic (`now` injectable for tests). */
export function approvalView(a: PublicApproval, now = Date.now()): ApprovalView {
  const expired = isExpired(a, now);
  const status = expired && a.status === "pending" ? "expired" : a.status;
  const sb = statusBadge(status);
  const rl = riskLevel(a);
  let notificationIds: string[] = [];
  try {
    const p = JSON.parse(a.notification_ids_json ?? "null");
    if (Array.isArray(p)) notificationIds = p.map(String);
  } catch {
    /* ignore malformed */
  }
  return {
    id: a.id,
    kind: a.kind,
    kindLabel: kindLabel(a.kind),
    summary: a.summary,
    target: targetLabel(a),
    agent: a.agent_id ?? a.requested_by_agent_id ?? null,
    risk: rl,
    riskText: a.risk ?? null,
    riskTone: RISK_TONE[rl],
    advice: a.advice ?? null,
    diffPreview: a.diff_preview ?? null,
    status,
    statusLabel: sb.label,
    statusTone: sb.tone,
    decidedVia: a.decided_via ?? null,
    decidedViaLabel: decidedViaLabel(a.decided_via),
    decidedBy: a.decided_by ?? null,
    decidedAt: a.decided_at ?? null,
    reason: a.reason ?? null,
    createdAt: a.created_at,
    createdLabel: relativeTime(a.created_at, now),
    expiresLabel: status === "pending" ? expiresIn(a, now) : sb.label.toLowerCase(),
    expired,
    pending: status === "pending",
    hasTarget: !!(a.issue || a.pr),
    issue: a.issue ?? null,
    pr: a.pr ?? null,
    notificationIds,
  };
}

/** The dashboard action set. approve/reject/pause go through the SAME decideApproval() as the phone. */
export type DashboardAction = "approve" | "reject" | "pause" | "manager";
