// Communication Agent (Chief of Staff): ONE voice to Roy. It gathers context from the whole floor (war room +
// work_items + workflows + approvals + agent_messages + PRs + fleet status + knowledge), produces a structured
// 6-section SUMMARY, answers "ask the team" with links, and turns REAL choices into Decision-Inbox approvals —
// never a chaotic per-agent chat. Everything stays traceable to the source (ids/issue/pr). No shell-out.
// No "server-only" so it is unit-testable.
import crypto from "node:crypto";
import { db, recordAudit, getSetting, setSetting } from "./db.ts";
import { redact } from "./redact.ts";
import { listWorkItems, type WorkItem } from "./work-items.ts";
import { listWorkflows, type Workflow } from "./workflows.ts";
import { listApprovalsRO, createApproval, type Approval } from "./approvals.ts";
import { listRecentAgentMessages, type AgentMessage } from "./agent-messages.ts";
import { readTeams } from "./teams.ts";
import { readAgents } from "./agents.ts";
import { buildWarRoom } from "./war-room.ts";
import { searchKnowledge } from "./knowledge-index.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function httpStatusOf(e: unknown): number { return e instanceof HttpError ? e.status : 500; }

export type SummaryType = "live" | "hourly" | "daily_standup" | "end_of_day" | "urgent_question";
export const SUMMARY_TYPES: SummaryType[] = ["live", "hourly", "daily_standup", "end_of_day", "urgent_question"];

/** A single line of a summary/answer, carrying the ids needed to open its source context (fully traceable). */
export interface SourceRef {
  text: string;
  work_item_id?: string | null;
  workflow_id?: string | null;
  approval_id?: string | null;
  issue?: number | null;
  pr?: number | null;
  agent_id?: string | null;
  knowledge_id?: string | null;
}
export interface SummarySections {
  done: SourceRef[];       // Wat is afgerond?
  running: SourceRef[];    // Wat loopt nu?
  blocked: SourceRef[];    // Wat is geblokkeerd?
  usage: SourceRef[];      // Wat kostte het / usage?
  decisions: SourceRef[];  // Welke beslissingen wachten op Roy?
  advice: SourceRef[];     // Advies van het team
}
export interface Summary {
  id: string;
  team_id: string | null;
  type: SummaryType;
  title: string;
  sections: SummarySections;
  period_start: string | null;
  period_end: string | null;
  created_by: string | null;
  delivered_phone: boolean;
  created_at: string;
}

const now = () => new Date().toISOString();
const clip = (v: unknown, max = 300): string => redact(typeof v === "string" ? v : String(v ?? "")).slice(0, max);

// ── per-team communicator (stored in settings — additive, no teams-CAS migration) ──
export function communicatorForTeam(teamId: string): string | null {
  const set = getSetting(`comm.communicator.${teamId}`, "");
  if (set) return set;
  try { return readTeams().teams.find((t) => t.id === teamId)?.lead ?? null; } catch { return null; }
}
export function setCommunicator(teamId: string, agentId: string | null, actor?: string): void {
  setSetting(`comm.communicator.${teamId}`, agentId ? String(agentId).slice(0, 120) : "");
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "comm.set_communicator", detail: clip(`${teamId} → ${agentId ?? "(default lead)"}`, 200) });
}
export interface CommunicatorRow { team_id: string; team_name: string; communicator_agent_id: string | null; communicator_name: string | null }
export function listCommunicators(): CommunicatorRow[] {
  const agents = safe(() => readAgents().agents, [] as ReturnType<typeof readAgents>["agents"]);
  const nameOf = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? id : null);
  return safe(() => readTeams().teams.filter((t) => t.enabled && !t.is_template), [] as ReturnType<typeof readTeams>["teams"]).map((t) => {
    const cid = communicatorForTeam(t.id);
    return { team_id: t.id, team_name: t.name, communicator_agent_id: cid, communicator_name: nameOf(cid) };
  });
}

// ── context ──
function periodStart(type: SummaryType): string | null {
  if (type === "hourly") return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (type === "daily_standup" || type === "end_of_day") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  return null; // live / urgent → current state, no lower bound
}
interface Context {
  health: ReturnType<typeof buildWarRoom>["health"];
  events: ReturnType<typeof buildWarRoom>["events"];
  workItems: WorkItem[];
  workflows: Workflow[];
  pending: Approval[];
  approvals: Approval[];
  messages: AgentMessage[];
}
/** Gather the whole-floor context, scoped to a team when given (work items + workflows filtered by team_id). */
export function gatherContext(teamId?: string | null): Context {
  const wr = safe(() => buildWarRoom(), null);
  const nowMs = Date.now();
  let approvals = safe(() => listApprovalsRO(200), [] as Approval[]);
  let messages = safe(() => listRecentAgentMessages(120), [] as AgentMessage[]);
  let workItems = safe(() => listWorkItems({ limit: 300 }), [] as WorkItem[]);
  let workflows = safe(() => listWorkflows({ limit: 200 }), [] as Workflow[]);
  if (teamId) {
    // a TEAM summary must describe that team — scope the approval-/message-derived sections to the team's work
    // items too (Approval/AgentMessage have no team_id, so bind via work_item_id ∈ the team's items).
    workItems = workItems.filter((w) => w.team_id === teamId);
    workflows = workflows.filter((w) => w.team_id === teamId);
    const ids = new Set(workItems.map((w) => w.id));
    approvals = approvals.filter((a) => a.work_item_id != null && ids.has(a.work_item_id));
    messages = messages.filter((m) => m.work_item_id != null && ids.has(m.work_item_id));
  }
  const pending = approvals.filter((a) => a.status === "pending" && (!a.expires_at || Date.parse(a.expires_at) > nowMs));
  return {
    health: wr?.health ?? { mode: "stopped", online: false, workers: { active: 0, max: null }, agents: { active: 0, total: 0 }, workflows_running: 0, open_decisions: pending.length, blockers: 0, prs_ready: 0, breaker: { tripped: false, fails: 0 }, budget_warning: null },
    events: wr?.events ?? [],
    workItems, workflows, pending, approvals, messages,
  };
}

// ── the 6-section summary ──
const inPeriod = (ts: string | null | undefined, since: string | null) => !since || (!!ts && ts >= since);
const wiRef = (w: WorkItem, text?: string): SourceRef => ({ text: text ?? w.title, work_item_id: w.id, issue: w.issue, pr: w.pr });

export function buildSections(type: SummaryType, ctx: Context): SummarySections {
  const since = periodStart(type);
  const CAP = 8;

  // count from the FULL filtered sets (the display list is capped separately — a capped array is never a count)
  const doneWi = ctx.workItems.filter((w) => w.state === "done" && inPeriod(w.updated_at, since));
  const mergedApprovals = ctx.approvals.filter((a) => a.kind === "merge" && a.status === "approved" && inPeriod(a.decided_at, since));
  const done = [
    ...doneWi.slice(0, CAP).map((w) => wiRef(w)),
    ...mergedApprovals.slice(0, CAP).map((a): SourceRef => ({ text: `Merged PR #${a.pr ?? "?"}`, approval_id: a.id, pr: a.pr, work_item_id: a.work_item_id, issue: a.issue })),
  ].slice(0, CAP);
  const doneTotal = doneWi.length + mergedApprovals.length;
  if (doneTotal > done.length) done.push({ text: `…and ${doneTotal - done.length} more done` });

  const running = [
    ...ctx.workItems.filter((w) => w.state === "running" || w.state === "review").slice(0, CAP).map((w) => wiRef(w, `${w.title} — ${w.state}`)),
    ...ctx.workflows.filter((w) => w.status === "running" || w.status === "waiting_user").slice(0, CAP).map((w): SourceRef => ({ text: `Workflow: ${w.title} — ${w.status.replace(/_/g, " ")}`, workflow_id: w.id, work_item_id: w.work_item_id })),
  ].slice(0, CAP);

  const blockedWi = ctx.workItems.filter((w) => w.state === "blocked");
  const blockedWf = ctx.workflows.filter((w) => w.status === "blocked");
  const blockerMsgsAll = ctx.messages.filter((m) => m.type === "blocker" && m.status !== "done" && m.status !== "rejected");
  const blockedCount = blockedWi.length + blockedWf.length + blockerMsgsAll.length;
  const blocked = [
    ...blockedWi.slice(0, CAP).map((w) => wiRef(w, `Blocked: ${w.title}`)),
    ...blockedWf.slice(0, CAP).map((w): SourceRef => ({ text: `Workflow blocked: ${w.title}`, workflow_id: w.id, work_item_id: w.work_item_id })),
    ...blockerMsgsAll.slice(0, CAP).map((m): SourceRef => ({ text: `Blocker: ${clip(m.payload?.note ?? "needs attention", 160)}`, work_item_id: m.work_item_id, agent_id: m.from_agent_id })),
  ].slice(0, CAP);
  if (blockedCount > blocked.length) blocked.push({ text: `…and ${blockedCount - blocked.length} more blocked` });

  const h = ctx.health;
  // scoped counts (a team summary must count the team's work); agents/workers stay fleet resources (shared).
  const runningWf = ctx.workflows.filter((w) => w.status === "running" || w.status === "waiting_user").length;
  const prsReady = ctx.pending.filter((a) => a.kind === "merge").length || ctx.workItems.filter((w) => w.pr != null && w.state === "review").length;
  const usage: SourceRef[] = [
    { text: `${doneWi.length} tasks done${since ? " in period" : ""}, ${mergedApprovals.length} PRs merged` },
    { text: `${runningWf} workflows running · ${h.agents.active}/${h.agents.total} agents active · ${h.workers.active} workers` },
    { text: `${prsReady} PRs ready · ${blockedCount} blockers · ${ctx.pending.length} decisions waiting` },
  ];
  if (process.env.VAULT_DIR) usage.push({ text: "Knowledge vault configured" });
  usage.push({ text: "Token cost/usage not tracked yet (placeholder)" });

  const decisions = ctx.pending.slice(0, CAP).map((a): SourceRef => ({ text: `${a.kind.replace(/_/g, " ")}: ${clip(a.summary, 160)}`, approval_id: a.id, work_item_id: a.work_item_id, issue: a.issue, pr: a.pr }));

  const advice: SourceRef[] = [];
  if (ctx.pending.length) advice.push({ text: `${ctx.pending.length} decision${ctx.pending.length > 1 ? "s" : ""} waiting — review the Decision Inbox.` });
  if (blockedCount) advice.push({ text: `${blockedCount} item${blockedCount > 1 ? "s" : ""} blocked — unblock to keep the team moving.` });
  if (h.breaker.tripped) advice.push({ text: `Circuit breaker tripped (${h.breaker.fails} fails) — investigate before resuming.` });
  if (!h.online && h.mode !== "stopped") advice.push({ text: "Fleet looks offline — the supervisor may be down." });
  if (advice.length === 0) advice.push({ text: "All clear — nothing needs you right now." });

  return { done, running, blocked, usage, decisions, advice };
}

// ── generate + store ──
function rowToSummary(r: Record<string, unknown>): Summary {
  let sections: SummarySections;
  try { sections = JSON.parse(r.sections_json as string); } catch { sections = { done: [], running: [], blocked: [], usage: [], decisions: [], advice: [] }; }
  return {
    id: r.id as string, team_id: (r.team_id as string) ?? null, type: r.type as SummaryType, title: (r.title as string) ?? "",
    sections, period_start: (r.period_start as string) ?? null, period_end: (r.period_end as string) ?? null,
    created_by: (r.created_by as string) ?? null, delivered_phone: !!(r.delivered_phone as number), created_at: r.created_at as string,
  };
}
const TYPE_LABEL: Record<SummaryType, string> = { live: "Live update", hourly: "Hourly update", daily_standup: "Daily standup", end_of_day: "End-of-day report", urgent_question: "Urgent question" };

export interface GenerateInput { type?: SummaryType; team_id?: string | null; created_by?: string | null; notify?: boolean }
export function generateSummary(input: GenerateInput = {}): Summary {
  const type = SUMMARY_TYPES.includes(input.type as SummaryType) ? (input.type as SummaryType) : "live";
  const teamId = input.team_id ? String(input.team_id) : null;
  const ctx = gatherContext(teamId);
  const sections = buildSections(type, ctx);
  const teamName = teamId ? safe(() => readTeams().teams.find((t) => t.id === teamId)?.name ?? teamId, teamId) : "Fleet";
  const id = crypto.randomUUID();
  const ts = now();
  const title = `${TYPE_LABEL[type]} · ${teamName}`;
  db().prepare("INSERT INTO communication_summaries (id,team_id,type,title,sections_json,period_start,period_end,created_by,delivered_phone,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)")
    .run(id, teamId, type, title, JSON.stringify(sections), periodStart(type), ts, input.created_by ? String(input.created_by).slice(0, 120) : (teamId ? communicatorForTeam(teamId) : null) ?? "system", ts);
  recordAudit({ actor: input.created_by ?? "communication", via: "system", action: "comm.summary", detail: clip(`${type} · ${teamName}`, 160) });

  if (input.notify) deliverToPhone(id, sections, title);
  return getSummary(id)!;
}

function deliverToPhone(id: string, sections: SummarySections, title: string): void {
  (async () => {
    try {
      const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
      if (!isPhoneConfigured()) return;
      const p = getProvider();
      if (!p) return;
      await p.sendMessage(renderSummaryText({ title, sections }));
      db().prepare("UPDATE communication_summaries SET delivered_phone=1 WHERE id=?").run(id);
    } catch { /* best-effort */ }
  })();
}

export interface SummaryFilter { type?: SummaryType; team_id?: string; limit?: number }
export function listSummaries(f: SummaryFilter = {}): Summary[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.type) { where.push("type = ?"); args.push(f.type); }
  if (f.team_id) { where.push("team_id = ?"); args.push(f.team_id); }
  const n = Number.isFinite(Math.trunc(Number(f.limit))) ? Math.min(200, Math.max(1, Math.trunc(Number(f.limit)))) : 60;
  const sql = `SELECT * FROM communication_summaries ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToSummary);
}
export function getSummary(id: string): Summary | null {
  const r = db().prepare("SELECT * FROM communication_summaries WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToSummary(r) : null;
}

/** Compact text rendering for phone delivery. HTML-escaped (Telegram sends with parse_mode HTML); the React UI
 *  renders the sections directly and does not use this. */
export function renderSummaryText(s: Pick<Summary, "title" | "sections">): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sec = (label: string, refs: SourceRef[]) => (refs.length ? `${label}\n${refs.map((r) => `• ${esc(r.text)}`).join("\n")}` : "");
  return [
    `📋 ${esc(s.title)}`,
    sec("✅ Done", s.sections.done),
    sec("🔄 Running", s.sections.running),
    sec("⛔ Blocked", s.sections.blocked),
    sec("📊 Usage", s.sections.usage),
    sec("🤔 Decisions waiting", s.sections.decisions),
    sec("💡 Advice", s.sections.advice),
  ].filter(Boolean).join("\n\n");
}

// ── ask the team (deterministic context search — short answer + links, not stored, no chat noise) ──
export interface AskResult { question: string; answer: string; refs: SourceRef[] }
export function askTeam(question: string, teamId?: string | null): AskResult {
  const q = clip(question, 400);
  const terms = q.toLowerCase().split(/[^a-z0-9#]+/).filter((t) => t.length > 2);
  const score = (text: string) => terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0);
  const ctx = gatherContext(teamId);
  const scored: { ref: SourceRef; s: number }[] = [];
  for (const w of ctx.workItems) { const s = score(`${w.title} ${w.description ?? ""}`); if (s) scored.push({ ref: wiRef(w, `${w.title} (${w.state})`), s }); }
  for (const a of ctx.pending) { const s = score(a.summary); if (s) scored.push({ ref: { text: `Decision: ${clip(a.summary, 160)}`, approval_id: a.id, work_item_id: a.work_item_id, pr: a.pr, issue: a.issue }, s }); }
  for (const w of ctx.workflows) { const s = score(w.title); if (s) scored.push({ ref: { text: `Workflow: ${w.title} (${w.status})`, workflow_id: w.id, work_item_id: w.work_item_id }, s }); }
  for (const e of ctx.events) { const s = score(e.title); if (s) scored.push({ ref: { text: e.title, work_item_id: e.work_item_id, workflow_id: e.workflow_id, approval_id: e.approval_id, issue: e.issue, pr: e.pr }, s }); }
  // consult the Knowledge Vault too (safe, access-scoped) — the project brain informs the answer
  for (const h of safe(() => searchKnowledge(q, { team_id: teamId, limit: 4 }), [] as ReturnType<typeof searchKnowledge>)) {
    scored.push({ ref: { text: `Knowledge: ${clip(h.item.title, 160)}`, knowledge_id: h.item.id }, s: h.score + 1 });
  }
  const refs = scored.sort((x, y) => y.s - x.s).slice(0, 6).map((x) => x.ref);
  const answer = refs.length
    ? `Found ${refs.length} related item${refs.length > 1 ? "s" : ""}${terms.length ? ` for "${terms.slice(0, 4).join(" ")}"` : ""}. See the links below.`
    : "Nothing on the floor matches that right now — check the War Room for the full picture.";
  recordAudit({ actor: "roy", via: "dashboard", action: "comm.ask", detail: clip(question, 160) });
  return { question: q, answer, refs };
}

// ── escalate a REAL choice into the Decision Inbox (not a loose chat message) ──
export interface EscalateInput { question: string; work_item_id?: string | null; issue?: number | null; pr?: number | null; team_id?: string | null; advice?: string | null; created_by?: string | null }
export function escalate(input: EscalateInput): { approval: Approval } {
  const summary = clip(input.question, 300);
  if (!summary) throw new HttpError(400, "question required");
  const { approval } = createApproval({
    kind: "escalation",
    summary,
    work_item_id: input.work_item_id ?? null,
    issue: input.issue ?? null,
    pr: input.pr ?? null,
    agent_id: input.created_by ?? null,
    advice: input.advice ? clip(input.advice, 300) : null,
    diff_preview: `The team needs your decision:\n\n${summary}${input.advice ? `\n\nTeam advice: ${clip(input.advice, 300)}` : ""}`,
    action: { type: "noop" }, // the decision IS the outcome (recorded); no automated follow-up
  });
  (async () => {
    try {
      const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
      if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
    } catch { /* best-effort */ }
  })();
  recordAudit({ actor: input.created_by ?? "communication", via: "system", action: "comm.escalate", approval_id: approval.id, detail: clip(summary, 160) });
  return { approval };
}

function safe<T>(fn: () => T, dflt: T): T { try { return fn(); } catch { return dflt; } }
