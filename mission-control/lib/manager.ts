// Manager / Decomposer: turns a BIG task into a validated decomposition PLAN (subtasks · roles · risks ·
// dependencies · a workflow proposal · test strategy), raises a plan_signoff approval, and ONLY after approval
// materialises the subtasks into child work_items (+ optionally agent-ready GitHub issues) and starts a workflow.
// It never shells out and never touches git/GitHub except through the existing validated services. Reuses
// work_items + workflows + plan-only mode + durable approvals. No "server-only" so it is unit-testable.
import crypto from "node:crypto";
import { db, recordAudit, getSetting, setSetting } from "./db.ts";
import { redact } from "./redact.ts";
import { createWorkItem, getWorkItem, updateWorkItem, childWorkItems, type WorkItem, type WorkItemRisk, WORK_ITEM_RISKS } from "./work-items.ts";
import { createApproval, getApproval, type Approval } from "./approvals.ts";
import { createWorkflowFromTemplate, getTemplate } from "./workflows.ts";
import { postAgentMessage } from "./agent-messages.ts";
import { readAgents } from "./agents.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function httpStatusOf(e: unknown): number { return e instanceof HttpError ? e.status : 500; }

// ── config (runtime-overridable via settings, else env, else default) — NO hardcoded limits ──
export interface ManagerConfig { max_subtasks_per_plan: number; max_depth: number; allow_github_issues: boolean; }
const DEFAULTS: ManagerConfig = { max_subtasks_per_plan: 12, max_depth: 2, allow_github_issues: false };
const intCfg = (key: string, env: string | undefined, dflt: number, lo: number, hi: number): number => {
  const raw = getSetting(`manager.${key}`, "") || (env ?? "");
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && raw !== "" ? Math.min(hi, Math.max(lo, n)) : dflt;
};
export function getManagerConfig(): ManagerConfig {
  return {
    max_subtasks_per_plan: intCfg("max_subtasks", process.env.MANAGER_MAX_SUBTASKS, DEFAULTS.max_subtasks_per_plan, 1, 50),
    max_depth: intCfg("max_depth", process.env.MANAGER_MAX_DEPTH, DEFAULTS.max_depth, 0, 6),
    allow_github_issues:
      (getSetting("manager.allow_github_issues", "") || process.env.MANAGER_ALLOW_GITHUB_ISSUES || "").toLowerCase() === "true"
        ? true
        : DEFAULTS.allow_github_issues,
  };
}
export function setManagerConfig(patch: Partial<ManagerConfig>, actor?: string): ManagerConfig {
  if (patch.max_subtasks_per_plan !== undefined) setSetting("manager.max_subtasks", String(Math.min(50, Math.max(1, Math.trunc(patch.max_subtasks_per_plan)))));
  if (patch.max_depth !== undefined) setSetting("manager.max_depth", String(Math.min(6, Math.max(0, Math.trunc(patch.max_depth)))));
  if (patch.allow_github_issues !== undefined) setSetting("manager.allow_github_issues", patch.allow_github_issues ? "true" : "false");
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "manager.config", detail: redact(JSON.stringify(patch)).slice(0, 200) });
  return getManagerConfig();
}

// ── types ──
export interface Subtask {
  title: string;
  description: string | null;
  role: string | null;          // validated against the agents registry (config-driven; unknown ⇒ unassigned)
  risk_level: WorkItemRisk;
  skills: string[];
  depends_on: number[];         // indices of subtasks that must finish first (a DAG; cycles are rejected)
}
export interface DecompositionPlan {
  goal: string;
  scope: string;
  subtasks: Subtask[];
  roles: string[];              // derived: the distinct roles the plan uses
  risks: string[];
  workflow_template_id: string | null;
  ordering: number[];           // derived: a topological order of the subtask indices
  test_strategy: string;
  create_github_issues: boolean;
  child_ids?: (string | null)[];   // filled at materialisation (aligned with subtasks)
  child_issues?: (number | null)[];
}
export interface ManagerPlan {
  id: string;
  work_item_id: string;
  source: string | null;
  source_ref: string | null;
  status: "proposed" | "approved" | "rejected" | "materialized";
  plan: DecompositionPlan;
  depth: number;
  approval_id: string | null;
  workflow_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── helpers ──
const now = () => new Date().toISOString();
const s = (v: unknown, max: number): string => redact(typeof v === "string" ? v : String(v ?? "")).slice(0, max);
const strArr = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => redact(x).slice(0, 120)).slice(0, max) : [];
const clampRisk = (v: unknown): WorkItemRisk => (WORK_ITEM_RISKS.includes(v as WorkItemRisk) ? (v as WorkItemRisk) : "low");
const isHigh = (r: WorkItemRisk) => r === "high" || r === "critical";

/** The roles the fleet actually has (from the agents registry) — never a hardcoded allowlist. */
function validRoles(): Set<string> {
  try { return new Set(readAgents().agents.map((a) => a.role).filter(Boolean)); } catch { return new Set(); }
}

/** Decomposition depth of a work item = how many parent hops to a root (cycle-safe, capped). */
export function workItemDepth(id: string): number {
  let depth = 0, cur = getWorkItem(id), seen = new Set<string>();
  while (cur?.parent_task_id && !seen.has(cur.id) && depth < 20) {
    seen.add(cur.id);
    cur = getWorkItem(cur.parent_task_id);
    depth++;
  }
  return depth;
}

/** Topological order of subtasks by depends_on; throws 400 on a cycle or an out-of-range dependency. */
function topoOrder(subtasks: Subtask[]): number[] {
  const n = subtasks.length;
  const indeg = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (const dep of subtasks[i].depends_on) {
      if (dep < 0 || dep >= n || dep === i) throw new HttpError(400, `subtask ${i} has an invalid dependency ${dep}`);
      adj[dep].push(i); indeg[i]++;
    }
  }
  const queue = indeg.map((d, i) => (d === 0 ? i : -1)).filter((i) => i >= 0);
  const order: number[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of adj[u]) if (--indeg[v] === 0) queue.push(v);
  }
  if (order.length !== n) throw new HttpError(400, "subtask dependencies contain a cycle");
  return order;
}

function normalizeSubtask(raw: unknown, roles: Set<string>): Subtask {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = s(o.title, 240);
  if (!title) throw new HttpError(400, "each subtask needs a title");
  const role = typeof o.role === "string" && roles.has(o.role) ? o.role : null; // config-driven; unknown ⇒ unassigned
  const deps = Array.isArray(o.depends_on)
    ? Array.from(new Set(o.depends_on.filter((x): x is number => Number.isInteger(x)).map((x) => Math.trunc(x))))
    : [];
  return { title, description: typeof o.description === "string" ? s(o.description, 2000) : null, role, risk_level: clampRisk(o.risk_level), skills: strArr(o.skills), depends_on: deps };
}

/** Validate + normalise a decomposition plan against the limits + the agents registry. */
export function normalizeDecomposition(input: Partial<DecompositionPlan>, cfg = getManagerConfig()): DecompositionPlan {
  const goal = s(input.goal, 1000);
  if (!goal) throw new HttpError(400, "decomposition.goal required");
  const roles = validRoles();
  const rawSubs = Array.isArray(input.subtasks) ? input.subtasks : [];
  if (rawSubs.length === 0) throw new HttpError(400, "at least one subtask is required");
  if (rawSubs.length > cfg.max_subtasks_per_plan)
    throw new HttpError(400, `too many subtasks (${rawSubs.length} > max ${cfg.max_subtasks_per_plan}) — split the task`);
  const subtasks = rawSubs.map((r) => normalizeSubtask(r, roles));
  const ordering = topoOrder(subtasks); // also validates deps / rejects cycles
  const tpl = typeof input.workflow_template_id === "string" && input.workflow_template_id ? input.workflow_template_id : null;
  return {
    goal, scope: s(input.scope, 4000), subtasks,
    roles: Array.from(new Set(subtasks.map((t) => t.role).filter((r): r is string => !!r))),
    risks: strArr(input.risks, 30),
    workflow_template_id: tpl,
    ordering,
    test_strategy: s(input.test_strategy, 4000),
    create_github_issues: !!input.create_github_issues,
  };
}

/** A readable, redacted rendering for the approval preview (Decision Inbox + phone). */
export function renderDecomposition(p: DecompositionPlan): string {
  const highs = p.subtasks.filter((t) => isHigh(t.risk_level)).length;
  const lines = p.subtasks.map((t, i) => {
    const deps = t.depends_on.length ? ` ← ${t.depends_on.map((d) => `#${d + 1}`).join(", ")}` : "";
    return `${i + 1}. ${t.title} [${t.role ?? "unassigned"} · ${t.risk_level}]${deps}`;
  });
  return [
    `GOAL\n${p.goal || "—"}`,
    `SCOPE\n${p.scope || "—"}`,
    `SUBTASKS (${p.subtasks.length}${highs ? `, ${highs} high-risk → own plan` : ""})\n${lines.join("\n")}`,
    p.roles.length ? `ROLES\n${p.roles.join(", ")}` : "",
    p.risks.length ? `RISKS\n${p.risks.map((r) => `• ${r}`).join("\n")}` : "",
    p.workflow_template_id ? `WORKFLOW\n${p.workflow_template_id.replace(/^tpl_/, "").replace(/_/g, " ")}` : "",
    `TEST STRATEGY\n${p.test_strategy || "—"}`,
  ].filter(Boolean).join("\n\n");
}

// ── row mapping ──
function rowToPlan(r: Record<string, unknown>): ManagerPlan {
  let plan: DecompositionPlan;
  try { plan = JSON.parse(r.plan_json as string); } catch { plan = { goal: "", scope: "", subtasks: [], roles: [], risks: [], workflow_template_id: null, ordering: [], test_strategy: "", create_github_issues: false }; }
  return {
    id: r.id as string, work_item_id: r.work_item_id as string, source: (r.source as string) ?? null, source_ref: (r.source_ref as string) ?? null,
    status: r.status as ManagerPlan["status"], plan, depth: Number(r.depth), approval_id: (r.approval_id as string) ?? null,
    workflow_id: (r.workflow_id as string) ?? null, created_by: (r.created_by as string) ?? null, created_at: r.created_at as string, updated_at: r.updated_at as string,
  };
}
export function getManagerPlan(id: string): ManagerPlan | null {
  const r = db().prepare("SELECT * FROM manager_plans WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToPlan(r) : null;
}
function proposedPlanFor(workItemId: string): ManagerPlan | null {
  const r = db().prepare("SELECT * FROM manager_plans WHERE work_item_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1").get(workItemId) as Record<string, unknown> | undefined;
  return r ? rowToPlan(r) : null;
}
export interface ManagerPlanFilter { status?: ManagerPlan["status"]; work_item_id?: string; limit?: number }
export function listManagerPlans(f: ManagerPlanFilter = {}): ManagerPlan[] {
  const where: string[] = []; const args: unknown[] = [];
  if (f.status) { where.push("status = ?"); args.push(f.status); }
  if (f.work_item_id) { where.push("work_item_id = ?"); args.push(f.work_item_id); }
  const n = Number.isFinite(Math.trunc(Number(f.limit))) ? Math.min(500, Math.max(1, Math.trunc(Number(f.limit)))) : 200;
  const sql = `SELECT * FROM manager_plans ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToPlan);
}
function setPlanRow(id: string, patch: { status?: ManagerPlan["status"]; approval_id?: string | null; workflow_id?: string | null; plan?: DecompositionPlan }): void {
  const cur = getManagerPlan(id);
  if (!cur) throw new HttpError(404, "manager plan not found");
  const status = patch.status ?? cur.status;
  const approval_id = patch.approval_id !== undefined ? patch.approval_id : cur.approval_id;
  const workflow_id = patch.workflow_id !== undefined ? patch.workflow_id : cur.workflow_id;
  const plan_json = patch.plan ? JSON.stringify(patch.plan) : JSON.stringify(cur.plan);
  db().prepare("UPDATE manager_plans SET status=?, approval_id=?, workflow_id=?, plan_json=?, updated_at=? WHERE id=?").run(status, approval_id, workflow_id, plan_json, now(), id);
}

/** Seed a starter decomposition from a workflow template (each step → a subtask, chained). No LLM needed. */
export function seedFromTemplate(templateId: string, goal: string): Partial<DecompositionPlan> {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new HttpError(404, "template not found");
  const subtasks = tpl.steps.map((step, i) => ({
    title: step.name,
    description: step.output_expected ?? null,
    role: step.role,
    risk_level: (step.approval_required ? "high" : "medium") as WorkItemRisk,
    skills: step.required_skills,
    depends_on: i > 0 ? [i - 1] : [],
  }));
  return { goal, scope: `Deliver "${goal}" via the ${tpl.name} pipeline.`, subtasks, workflow_template_id: templateId, test_strategy: "Follow the QA / review steps in the pipeline.", risks: [] };
}

// ── propose ──
export interface ProposeInput {
  work_item_id?: string | null;   // decompose an existing work item …
  title?: string | null;          // … or create a new parent from a title
  description?: string | null;
  source?: string | null;
  source_ref?: string | null;
  plan?: Partial<DecompositionPlan>;
  seed_template_id?: string | null;
  created_by?: string | null;
}
/** Propose a decomposition: validate it, park the parent in plan_only/review, and raise a plan_signoff approval. */
export function proposeDecomposition(input: ProposeInput): { workItem: WorkItem; managerPlan: ManagerPlan; approval: Approval } {
  const cfg = getManagerConfig();
  // resolve or create the PARENT work item (a big task defaults to plan_only via the risk heuristic)
  let parent = input.work_item_id ? getWorkItem(String(input.work_item_id)) : null;
  if (input.work_item_id && !parent) throw new HttpError(404, "work item not found");
  if (!parent) {
    const title = s(input.title, 300);
    if (!title) throw new HttpError(400, "work_item_id or title required");
    parent = createWorkItem({ title, description: input.description ?? null, source_type: (input.source as WorkItem["source_type"]) ?? "manual", risk_level: "high", created_by: input.created_by ?? "manager" });
  }
  // depth guard (nested decomposition is bounded)
  const depth = workItemDepth(parent.id);
  if (depth >= cfg.max_depth) throw new HttpError(400, `max decomposition depth reached (${depth} ≥ ${cfg.max_depth})`);
  // idempotent: one open proposal per parent
  const open = proposedPlanFor(parent.id);
  if (open) { const a = open.approval_id ? getApproval(open.approval_id) : null; if (a) return { workItem: parent, managerPlan: open, approval: a }; }

  // build + validate the plan
  const raw = input.plan ?? (input.seed_template_id ? seedFromTemplate(String(input.seed_template_id), parent.title) : null);
  if (!raw) throw new HttpError(400, "a plan or a seed_template_id is required");
  const plan = normalizeDecomposition(raw, cfg);
  if (plan.workflow_template_id && !getTemplate(plan.workflow_template_id)) throw new HttpError(400, "unknown workflow_template_id");

  const id = crypto.randomUUID();
  db().prepare("INSERT INTO manager_plans (id,work_item_id,source,source_ref,status,plan_json,depth,approval_id,workflow_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?)")
    .run(id, parent.id, s(input.source, 40) || "dashboard", s(input.source_ref, 300) || null, "proposed", JSON.stringify(plan), depth, s(input.created_by, 120) || "manager", now(), now());

  // park the parent awaiting the decomposition decision (reuses plan-only semantics)
  updateWorkItem(parent.id, { mode: "plan_only", state: "review", actor: input.created_by ?? "manager" });

  const highs = plan.subtasks.filter((t) => isHigh(t.risk_level)).length;
  const { approval } = createApproval({
    kind: "plan_signoff",
    summary: `Manager plan: ${parent.title}`.slice(0, 300),
    work_item_id: parent.id,
    issue: parent.issue,
    risk: `${plan.subtasks.length} subtasks${highs ? ` · ${highs} high-risk` : ""}`,
    advice: plan.scope.slice(0, 300),
    diff_preview: renderDecomposition(plan),
    action: { type: "approve_decomposition", work_item_id: parent.id, manager_plan_id: id },
  });
  setPlanRow(id, { approval_id: approval.id });

  (async () => {
    try {
      const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
      if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
    } catch { /* swallow */ }
  })();
  recordAudit({ actor: input.created_by ?? "manager", via: "system", action: "manager.propose", approval_id: approval.id, issue: parent.issue, detail: redact(`${plan.subtasks.length} subtasks: ${plan.goal}`).slice(0, 200) });
  return { workItem: getWorkItem(parent.id)!, managerPlan: getManagerPlan(id)!, approval };
}

// ── approve → materialise ──
/** Approve a decomposition: create the child work_items (+ optional agent-ready issues) and start the workflow.
 *  Idempotent — a re-run never double-creates subtasks or spams issues. High-risk children are plan_only (their
 *  own plan approval is required before they build). */
export async function approveDecomposition(managerPlanId: string, actor?: string): Promise<{ workItem: WorkItem; managerPlan: ManagerPlan; children: WorkItem[] }> {
  const mp = getManagerPlan(managerPlanId);
  if (!mp) throw new HttpError(404, "manager plan not found");
  if (mp.status === "materialized") { // idempotent no-op (never re-spam subtasks/issues)
    return { workItem: getWorkItem(mp.work_item_id)!, managerPlan: mp, children: childWorkItems(mp.work_item_id) };
  }
  if (mp.status === "rejected") throw new HttpError(409, "plan was rejected");
  const parent = getWorkItem(mp.work_item_id);
  if (!parent) throw new HttpError(404, "parent work item not found");
  // the parent moved on out-of-band (cancelled/done/blocked) while the approval sat pending → materialising now
  // would resurrect it + create its subtasks. Mirror approvePlan/rejectPlan: a stale approval is a safe no-op.
  if (parent.state !== "review") {
    recordAudit({ actor: actor ?? "manager", via: "system", action: "manager.materialize_skipped", issue: parent.issue, detail: `stale decomposition ignored (state=${parent.state})` });
    return { workItem: parent, managerPlan: mp, children: childWorkItems(parent.id) };
  }
  const cfg = getManagerConfig();
  const plan = mp.plan;
  // re-assert the CURRENT limits (they may have been lowered since propose) — never materialise past them
  if (plan.subtasks.length > cfg.max_subtasks_per_plan) throw new HttpError(409, `plan has ${plan.subtasks.length} subtasks but the limit is now ${cfg.max_subtasks_per_plan} — re-propose`);
  if (workItemDepth(parent.id) >= cfg.max_depth) throw new HttpError(409, `parent now exceeds max decomposition depth (${cfg.max_depth}) — re-propose`);

  const childIds: (string | null)[] = new Array(plan.subtasks.length).fill(null);
  const childIssues: (number | null)[] = new Array(plan.subtasks.length).fill(null);
  const created: WorkItem[] = [];
  // create children in dependency order (so a child can reference its parents' ids if we extend later)
  for (const i of plan.ordering.length === plan.subtasks.length ? plan.ordering : plan.subtasks.map((_, i) => i)) {
    const t = plan.subtasks[i];
    const child = createWorkItem({
      title: t.title, description: t.description, parent_task_id: parent.id, assigned_role: t.role,
      risk_level: t.risk_level, team_id: parent.team_id, source_type: "workflow", created_by: actor ?? "manager",
      // high/critical risk children start plan_only via the createWorkItem heuristic ⇒ their own plan approval
    });
    childIds[i] = child.id;
    created.push(child);
    // OPTIONAL agent-ready GitHub issue — opt-in + globally allowed + NEVER for high-risk (those need their plan
    // approval first) + capped by the subtask count (which is already ≤ max_subtasks). No runaway issue creation.
    if (plan.create_github_issues && cfg.allow_github_issues && !isHigh(t.risk_level)) {
      try {
        const { createAgentTask } = await import("./github.ts");
        const r = await createAgentTask({ title: t.title, body: `${t.description ?? ""}\n\nSubtask of: ${parent.title}`.trim(), labels: t.role ? [t.role] : undefined, source: "manager decomposition" });
        childIssues[i] = r.number;
        updateWorkItem(child.id, { issue: r.number, actor: actor ?? "manager" });
      } catch { /* issue creation is best-effort; the work_item still exists */ }
    }
  }

  // start the proposed workflow (linked to the parent), if any
  let workflowId: string | null = mp.workflow_id;
  if (plan.workflow_template_id && !workflowId) {
    try { workflowId = createWorkflowFromTemplate({ template_id: plan.workflow_template_id, work_item_id: parent.id, title: parent.title, created_by: actor ?? "manager" }).workflow.id; } catch { workflowId = null; }
  }

  // the parent is now decomposed → it may proceed (its children carry the work)
  updateWorkItem(parent.id, { mode: "build_after_approval", state: "running", actor: actor ?? "manager" });
  setPlanRow(managerPlanId, { status: "materialized", workflow_id: workflowId, plan: { ...plan, child_ids: childIds, child_issues: childIssues } });

  const highs = plan.subtasks.filter((t) => isHigh(t.risk_level)).length;
  postAgentMessage({
    from_agent_id: "manager", to_agent_id: parent.assigned_agent_id, to_role: parent.assigned_role, work_item_id: parent.id,
    type: "instruction", payload: { note: `Decomposed into ${created.length} subtasks${highs ? ` (${highs} high-risk require their own plan)` : ""}.` },
  });
  recordAudit({ actor: actor ?? "manager", via: "system", action: "manager.materialize", issue: parent.issue, detail: redact(`${created.length} subtasks, ${childIssues.filter(Boolean).length} issues`).slice(0, 200) });
  return { workItem: getWorkItem(parent.id)!, managerPlan: getManagerPlan(managerPlanId)!, children: childWorkItems(parent.id) };
}

// ── reject ──
export function rejectDecomposition(managerPlanId: string, reason?: string, actor?: string): ManagerPlan {
  const mp = getManagerPlan(managerPlanId);
  if (!mp) throw new HttpError(404, "manager plan not found");
  if (mp.status === "materialized") throw new HttpError(409, "plan already materialized");
  setPlanRow(managerPlanId, { status: "rejected" });
  updateWorkItem(mp.work_item_id, { state: "blocked", actor: actor ?? "manager" });
  postAgentMessage({
    from_agent_id: "user", to_agent_id: null, to_role: null, work_item_id: mp.work_item_id,
    type: "blocker", payload: { note: reason || "Decomposition rejected — revise the plan." },
  });
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "manager.reject", detail: redact(reason || "").slice(0, 200) });
  return getManagerPlan(managerPlanId)!;
}

/** Called from the approval-decide paths on REJECT: block the parent + feedback, only for a decomposition plan. */
export function handleDecompositionRejection(approval: Pick<Approval, "kind" | "action_json" | "reason">, actor?: string): void {
  if (approval.kind !== "plan_signoff" || !approval.action_json) return;
  try {
    const a = JSON.parse(approval.action_json) as { type?: string; manager_plan_id?: string };
    if (a.type === "approve_decomposition" && a.manager_plan_id) rejectDecomposition(a.manager_plan_id, approval.reason ?? "Decomposition rejected", actor);
  } catch { /* never block the decide flow */ }
}

/** True when this plan_signoff approval is a Manager decomposition (so the plan-only handler must skip it). */
export function isDecompositionApproval(action_json: string | null | undefined): boolean {
  if (!action_json) return false;
  try { return (JSON.parse(action_json) as { type?: string }).type === "approve_decomposition"; } catch { return false; }
}
