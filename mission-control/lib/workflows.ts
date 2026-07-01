// Workflow engine: a template becomes a live WORKFLOW of ordered STEPS that walk through agent ROLES
// (product → architect → build → qa → security → reviewer → approval …). It's an orchestration + tracking
// layer over the existing work_items + durable approvals — it does NOT execute agent work (the runner does
// that later). Every transition is validated server-side, redacted, and recorded as a workflow_event + audit.
// No "server-only" import so this is testable under `node --test`.
import crypto from "node:crypto";
import { db, recordAudit } from "./db.ts";
import { redact } from "./redact.ts";
import { createApproval, getApproval, decideApproval } from "./approvals.ts";
import type { Approval } from "./approvals.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function httpStatusOf(e: unknown): number {
  return e instanceof HttpError ? e.status : 500;
}

// ── types ──
export type WorkflowStatus = "queued" | "running" | "blocked" | "waiting_user" | "failed" | "done" | "cancelled";
export type WorkflowStepStatus = "queued" | "running" | "blocked" | "waiting_user" | "review" | "failed" | "done" | "skipped";

export const WORKFLOW_STATUSES: WorkflowStatus[] = ["queued", "running", "blocked", "waiting_user", "failed", "done", "cancelled"];
export const WORKFLOW_STEP_STATUSES: WorkflowStepStatus[] = ["queued", "running", "blocked", "waiting_user", "review", "failed", "done", "skipped"];
const WORKFLOW_TERMINAL = new Set<WorkflowStatus>(["failed", "done", "cancelled"]);
const STEP_ACTIVE = new Set<WorkflowStepStatus>(["running", "review", "waiting_user"]);
const STEP_TERMINAL = new Set<WorkflowStepStatus>(["failed", "done", "skipped"]);

export interface TemplateStep {
  name: string;
  role: string | null;
  required_skills: string[];
  approval_required: boolean;
  output_expected: string | null;
  max_attempts: number;
}
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  steps: TemplateStep[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
export interface Workflow {
  id: string;
  template_id: string | null;
  work_item_id: string | null;
  team_id: string | null;
  title: string;
  status: WorkflowStatus;
  current_step_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  assigned_agent_id: string | null;
  assigned_role: string | null;
  required_skills: string[];
  approval_required: boolean;
  status: WorkflowStepStatus;
  max_attempts: number;
  attempt_count: number;
  output_expected: string | null;
  output: Record<string, unknown> | string | null;
  approval_id: string | null;
  started_at: string | null;
  completed_at: string | null;
}
export interface WorkflowEvent {
  id: number;
  workflow_id: string;
  step_id: string | null;
  type: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}
export interface WorkflowDetail {
  workflow: Workflow;
  steps: WorkflowStep[];
  events: WorkflowEvent[];
}

// ── helpers ──
const now = () => new Date().toISOString();
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const parseJson = (s: unknown): Record<string, unknown> | null => {
  if (typeof s !== "string" || !s) return null;
  try { const p = JSON.parse(s); return p && typeof p === "object" ? p : null; } catch { return null; }
};
// a step's stored output may be a JSON object OR a JSON-encoded string — surface either cleanly.
const parseOutput = (s: unknown): Record<string, unknown> | string | null => {
  if (typeof s !== "string" || !s) return null;
  try { const p = JSON.parse(s); return p && typeof p === "object" ? (p as Record<string, unknown>) : typeof p === "string" ? p : String(p); } catch { return s; }
};
const strArr = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => redact(x).slice(0, 120)).slice(0, max) : [];
const clampInt = (v: unknown, dflt: number, lo: number, hi: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function rowToTemplate(r: Record<string, unknown>): WorkflowTemplate {
  const steps = (parseJson(`{"s":${(r.steps_json as string) || "[]"}}`)?.s as unknown[]) ?? [];
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    category: (r.category as string) ?? null,
    steps: (Array.isArray(steps) ? steps : []).map(normalizeTemplateStep),
    enabled: !!r.enabled,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
function normalizeTemplateStep(s: unknown): TemplateStep {
  const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
  return {
    name: redact(typeof o.name === "string" ? o.name : "Step").slice(0, 120) || "Step",
    role: typeof o.role === "string" && o.role.trim() ? redact(o.role).slice(0, 64) : null,
    required_skills: strArr(o.required_skills ?? o.required_skills_json),
    approval_required: !!o.approval_required,
    output_expected: typeof o.output_expected === "string" ? redact(o.output_expected).slice(0, 500) : null,
    max_attempts: clampInt(o.max_attempts, 1, 1, 10),
  };
}
function rowToWorkflow(r: Record<string, unknown>): Workflow {
  return {
    id: r.id as string,
    template_id: (r.template_id as string) ?? null,
    work_item_id: (r.work_item_id as string) ?? null,
    team_id: (r.team_id as string) ?? null,
    title: r.title as string,
    status: r.status as WorkflowStatus,
    current_step_id: (r.current_step_id as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
function rowToStep(r: Record<string, unknown>): WorkflowStep {
  return {
    id: r.id as string,
    workflow_id: r.workflow_id as string,
    step_order: Number(r.step_order),
    name: r.name as string,
    assigned_agent_id: (r.assigned_agent_id as string) ?? null,
    assigned_role: (r.assigned_role as string) ?? null,
    required_skills: (parseJson(`{"s":${(r.required_skills_json as string) || "[]"}}`)?.s as string[]) ?? [],
    approval_required: !!r.approval_required,
    status: r.status as WorkflowStepStatus,
    max_attempts: Number(r.max_attempts),
    attempt_count: Number(r.attempt_count),
    output_expected: (r.output_expected as string) ?? null,
    output: parseOutput(r.output_json as string),
    approval_id: (r.approval_id as string) ?? null,
    started_at: (r.started_at as string) ?? null,
    completed_at: (r.completed_at as string) ?? null,
  };
}
function rowToEvent(r: Record<string, unknown>): WorkflowEvent {
  return {
    id: Number(r.id),
    workflow_id: r.workflow_id as string,
    step_id: (r.step_id as string) ?? null,
    type: r.type as string,
    message: (r.message as string) ?? null,
    payload: parseJson(r.payload_json as string),
    created_at: r.created_at as string,
  };
}

function emit(workflowId: string, type: string, opts: { stepId?: string | null; message?: string | null; payload?: object | null } = {}): void {
  db().prepare("INSERT INTO workflow_events (workflow_id,step_id,type,message,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(workflowId, opts.stepId ?? null, type, opts.message ? redact(opts.message).slice(0, 500) : null, opts.payload ? JSON.stringify(opts.payload) : null, now());
}

// ── default templates (generic role pipelines — NO project-specific names) ──
const DEFAULT_TEMPLATES: Array<Pick<WorkflowTemplate, "id" | "name" | "description" | "category"> & { steps: Array<Partial<TemplateStep> & { name: string }> }> = [
  {
    id: "tpl_build_feature", name: "Build feature", category: "build",
    description: "Full delivery pipeline from product intent to a reviewed PR.",
    steps: [
      { name: "Product Owner", role: "manager", output_expected: "Clear requirements + acceptance criteria" },
      { name: "Architect", role: "architect", output_expected: "Technical approach + affected areas" },
      { name: "Build (Frontend/Backend)", role: "frontend", required_skills: ["code"], output_expected: "Implementation on a feature branch", max_attempts: 3 },
      { name: "QA", role: "qa", required_skills: ["testing"], output_expected: "Test results" },
      { name: "Security", role: "security", output_expected: "Security verdict" },
      { name: "Reviewer", role: "qa", output_expected: "Review notes" },
      { name: "PR approval", role: null, approval_required: true, required_skills: ["github"], output_expected: "Human sign-off to open/merge the PR" },
    ],
  },
  {
    id: "tpl_fix_bug", name: "Fix bug", category: "bugfix",
    description: "Diagnose, fix, verify and review a bug through to a PR.",
    steps: [
      { name: "Debug & fix", role: "backend", required_skills: ["code"], output_expected: "Root cause + fix", max_attempts: 3 },
      { name: "QA", role: "qa", required_skills: ["testing"], output_expected: "Regression verified" },
      { name: "Reviewer", role: "qa", output_expected: "Review notes" },
      { name: "PR approval", role: null, approval_required: true, required_skills: ["github"], output_expected: "Human sign-off" },
    ],
  },
  {
    id: "tpl_improve_ui", name: "Improve UI", category: "ui",
    description: "Design-led UI improvement with a visual review gate.",
    steps: [
      { name: "Designer", role: "designer", output_expected: "Design direction / mockup" },
      { name: "Frontend", role: "frontend", required_skills: ["code"], output_expected: "Implemented UI", max_attempts: 3 },
      { name: "Screenshot Review", role: "qa", output_expected: "Visual diff notes" },
      { name: "QA", role: "qa", required_skills: ["testing"], output_expected: "Test results" },
    ],
  },
  {
    id: "tpl_audit_project", name: "Audit project", category: "audit",
    description: "Cross-role audit ending in a manager summary.",
    steps: [
      { name: "Architect", role: "architect", output_expected: "Architecture findings" },
      { name: "Security", role: "security", output_expected: "Security findings" },
      { name: "QA", role: "qa", output_expected: "Quality findings" },
      { name: "Docs", role: "documentation", output_expected: "Documentation gaps" },
      { name: "Manager summary", role: "manager", output_expected: "Consolidated report" },
    ],
  },
  {
    id: "tpl_excel_automation", name: "Excel automation", category: "automation",
    description: "Data/Excel pipeline validated before backend integration.",
    steps: [
      { name: "Excel / Data", role: "data", required_skills: ["data"], output_expected: "Parsed / transformed data" },
      { name: "Validator", role: "qa", output_expected: "Validation report" },
      { name: "Backend", role: "backend", required_skills: ["code"], output_expected: "Integration", max_attempts: 3 },
      { name: "QA", role: "qa", required_skills: ["testing"], output_expected: "Test results" },
    ],
  },
  {
    id: "tpl_launch_saas", name: "Launch SaaS", category: "launch",
    description: "End-to-end SaaS build with a payments placeholder and a deploy gate.",
    steps: [
      { name: "Product", role: "manager", output_expected: "Scope + acceptance criteria" },
      { name: "Frontend", role: "frontend", required_skills: ["code"], output_expected: "UI", max_attempts: 3 },
      { name: "Backend", role: "backend", required_skills: ["code"], output_expected: "API", max_attempts: 3 },
      { name: "Payments (placeholder)", role: "backend", output_expected: "Stubbed payments integration" },
      { name: "QA", role: "qa", required_skills: ["testing"], output_expected: "Test results" },
      { name: "Deploy approval", role: "devops", approval_required: true, required_skills: ["ops"], output_expected: "Human sign-off to deploy" },
    ],
  },
];

let _seeded = false;
/** Seed the default templates once (idempotent by fixed id; skips if any template already exists). */
export function ensureDefaultTemplates(): void {
  if (_seeded) return;
  const count = Number((db().prepare("SELECT COUNT(*) AS c FROM workflow_templates").get() as { c: number }).c);
  if (count === 0) {
    const ts = now();
    const ins = db().prepare("INSERT OR IGNORE INTO workflow_templates (id,name,description,category,steps_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)");
    for (const t of DEFAULT_TEMPLATES) {
      const steps = t.steps.map((s) => normalizeTemplateStep(s));
      ins.run(t.id, t.name, t.description ?? null, t.category ?? null, JSON.stringify(steps), ts, ts);
    }
  }
  _seeded = true;
}

// ── template reads ──
export function listTemplates(opts: { includeDisabled?: boolean } = {}): WorkflowTemplate[] {
  ensureDefaultTemplates();
  const sql = opts.includeDisabled
    ? "SELECT * FROM workflow_templates ORDER BY name ASC"
    : "SELECT * FROM workflow_templates WHERE enabled = 1 ORDER BY name ASC";
  return (db().prepare(sql).all() as Record<string, unknown>[]).map(rowToTemplate);
}
export function getTemplate(id: string): WorkflowTemplate | null {
  ensureDefaultTemplates();
  const r = db().prepare("SELECT * FROM workflow_templates WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToTemplate(r) : null;
}

// ── workflow reads ──
function workflowRow(id: string): Workflow | null {
  const r = db().prepare("SELECT * FROM workflows WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToWorkflow(r) : null;
}
function stepsOf(workflowId: string): WorkflowStep[] {
  return (db().prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC").all(workflowId) as Record<string, unknown>[]).map(rowToStep);
}
function stepRow(id: string): WorkflowStep | null {
  const r = db().prepare("SELECT * FROM workflow_steps WHERE id = ?").get(String(id)) as Record<string, unknown> | undefined;
  return r ? rowToStep(r) : null;
}

export interface WorkflowFilter { status?: WorkflowStatus; work_item_id?: string; team_id?: string; template_id?: string; limit?: number }
export function listWorkflows(f: WorkflowFilter = {}): Workflow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (col: string, val: unknown) => { if (val !== undefined && val !== null && val !== "") { where.push(`${col} = ?`); args.push(val); } };
  add("status", f.status); add("work_item_id", f.work_item_id); add("team_id", f.team_id); add("template_id", f.template_id);
  const raw = Math.trunc(Number(f.limit));
  const n = Number.isFinite(raw) ? Math.min(500, Math.max(1, raw)) : 200;
  const sql = `SELECT * FROM workflows ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, n) as Record<string, unknown>[]).map(rowToWorkflow);
}
export function getWorkflow(id: string): WorkflowDetail | null {
  const workflow = workflowRow(id);
  if (!workflow) return null;
  const events = (db().prepare("SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY id DESC LIMIT 200").all(id) as Record<string, unknown>[]).map(rowToEvent);
  return { workflow, steps: stepsOf(id), events };
}

// ── low-level setters (validated) ──
function setWorkflow(id: string, patch: { status?: WorkflowStatus; current_step_id?: string | null; title?: string }): void {
  const cur = workflowRow(id);
  if (!cur) throw new HttpError(404, "workflow not found");
  const status = patch.status !== undefined ? oneOf(patch.status, WORKFLOW_STATUSES, cur.status) : cur.status;
  const current = patch.current_step_id !== undefined ? patch.current_step_id : cur.current_step_id;
  const title = patch.title !== undefined ? (redact(patch.title).slice(0, 300) || cur.title) : cur.title;
  db().prepare("UPDATE workflows SET status=?, current_step_id=?, title=?, updated_at=? WHERE id=?").run(status, current, title, now(), id);
}
type StepPatch = { status?: WorkflowStepStatus; attempt_count?: number; output_json?: string | null; approval_id?: string | null; started_at?: string | null; completed_at?: string | null; assigned_agent_id?: string | null };
function setStep(id: string, patch: StepPatch): void {
  const cur = stepRow(id);
  if (!cur) throw new HttpError(404, "step not found");
  const next = {
    status: patch.status !== undefined ? oneOf(patch.status, WORKFLOW_STEP_STATUSES, cur.status) : cur.status,
    attempt_count: patch.attempt_count !== undefined ? Math.max(0, Math.trunc(patch.attempt_count)) : cur.attempt_count,
    output_json: patch.output_json !== undefined ? patch.output_json : (cur.output === null ? null : JSON.stringify(cur.output)),
    approval_id: patch.approval_id !== undefined ? patch.approval_id : cur.approval_id,
    started_at: patch.started_at !== undefined ? patch.started_at : cur.started_at,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : cur.completed_at,
    assigned_agent_id: patch.assigned_agent_id !== undefined ? patch.assigned_agent_id : cur.assigned_agent_id,
  };
  db().prepare("UPDATE workflow_steps SET status=?, attempt_count=?, output_json=?, approval_id=?, started_at=?, completed_at=?, assigned_agent_id=? WHERE id=?")
    .run(next.status, next.attempt_count, next.output_json, next.approval_id, next.started_at, next.completed_at, next.assigned_agent_id, id);
}

// ── create ──
export interface CreateWorkflowInput {
  template_id: string;
  work_item_id?: string | null;
  team_id?: string | null;
  title?: string | null;
  created_by?: string | null;
  assignments?: Record<string, { agent_id?: string | null }>; // optional per-step-order agent overrides
}
/** Instantiate a workflow from a template: create the ordered steps and activate the first one. */
export function createWorkflowFromTemplate(input: CreateWorkflowInput): WorkflowDetail {
  const tpl = getTemplate(String(input.template_id));
  if (!tpl) throw new HttpError(404, "template not found");
  if (!tpl.enabled) throw new HttpError(400, "template is disabled");
  if (tpl.steps.length === 0) throw new HttpError(400, "template has no steps");

  const id = crypto.randomUUID();
  const ts = now();
  const title = redact(input.title || tpl.name).slice(0, 300) || tpl.name;
  db().prepare("INSERT INTO workflows (id,template_id,work_item_id,team_id,title,status,current_step_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, tpl.id, input.work_item_id ? String(input.work_item_id) : null, input.team_id ? String(input.team_id) : null, title, "queued", null, input.created_by ? String(input.created_by).slice(0, 120) : null, ts, ts);

  const insStep = db().prepare(`INSERT INTO workflow_steps
    (id,workflow_id,step_order,name,assigned_agent_id,assigned_role,required_skills_json,approval_required,status,max_attempts,attempt_count,output_expected,output_json,approval_id,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)`);
  tpl.steps.forEach((s, i) => {
    const agent = input.assignments?.[String(i)]?.agent_id ?? null;
    insStep.run(crypto.randomUUID(), id, i, s.name, agent ? String(agent).slice(0, 120) : null, s.role, JSON.stringify(s.required_skills), s.approval_required ? 1 : 0, "queued", s.max_attempts, 0, s.output_expected);
  });

  emit(id, "workflow_created", { message: `Created from template "${tpl.name}"`, payload: { template_id: tpl.id, steps: tpl.steps.length } });
  recordAudit({ actor: input.created_by ?? "dashboard", via: "dashboard", action: "workflow.create", detail: redact(`${tpl.name}: ${title}`).slice(0, 200) });

  // activate the first step (running, or waiting_user + an approval if it gates)
  const first = stepsOf(id)[0];
  activateStep(id, first, input.created_by ?? "dashboard");
  return getWorkflow(id)!;
}

// ── the state machine ──
/** Make `step` the active step: running, or (if it gates) waiting_user + a durable approval. */
function activateStep(workflowId: string, step: WorkflowStep, actor: string): void {
  if (step.approval_required) {
    requestStepApproval(workflowId, step.id, actor);
    return;
  }
  setStep(step.id, { status: "running", started_at: step.started_at ?? now() });
  setWorkflow(workflowId, { status: "running", current_step_id: step.id });
  emit(workflowId, "step_started", { stepId: step.id, message: step.name });
}

/** Raise a durable approval that must be granted before the workflow proceeds past this step. */
export function requestStepApproval(workflowId: string, stepId: string, actor?: string): { step: WorkflowStep; approval: Approval } {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) throw new HttpError(409, `workflow is ${wf.status}`);
  const step = stepRow(stepId);
  if (!step || step.workflow_id !== workflowId) throw new HttpError(404, "step not found");
  if (STEP_TERMINAL.has(step.status)) throw new HttpError(409, `step is ${step.status}`); // never re-gate a finished step
  if (step.approval_id) { // idempotent: don't mint a second approval for an already-gated step
    const existing = getApproval(step.approval_id);
    if (existing && existing.status === "pending") return { step, approval: existing };
  }

  const { approval } = createApproval({
    kind: "workflow_step",
    summary: `Approve step "${step.name}" — ${wf.title}`,
    work_item_id: wf.work_item_id,
    agent_id: step.assigned_agent_id,
    risk: step.approval_required ? "gate" : null,
    advice: step.output_expected,
    diff_preview: `WORKFLOW\n${wf.title}\n\nSTEP ${step.step_order + 1}: ${step.name}${step.assigned_role ? `\nRole: ${step.assigned_role}` : ""}${step.output_expected ? `\n\nExpected: ${step.output_expected}` : ""}`,
    action: { type: "advance_workflow", workflow_id: workflowId, step_id: stepId },
  });
  setStep(stepId, { status: "waiting_user", started_at: step.started_at ?? now(), approval_id: approval.id });
  setWorkflow(workflowId, { status: "waiting_user", current_step_id: stepId });
  emit(workflowId, "approval_requested", { stepId, message: step.name, payload: { approval_id: approval.id } });
  recordAudit({ actor: actor ?? "system", via: "system", action: "workflow.step_approval", approval_id: approval.id, detail: redact(step.name).slice(0, 200) });

  // best-effort phone notify (the approval is durably pending regardless)
  (async () => {
    try {
      const { getProvider, isPhoneConfigured } = await import("./phone/index.ts");
      if (isPhoneConfigured()) await getProvider()?.sendApprovalRequest(approval);
    } catch { /* swallow */ }
  })();
  return { step: stepRow(stepId)!, approval };
}

/** Activate the earliest still-queued step, or mark the workflow done when none remain. */
function activateNext(workflowId: string, actor: string): void {
  const next = stepsOf(workflowId).filter((s) => s.status === "queued").sort((a, b) => a.step_order - b.step_order)[0];
  if (next) {
    activateStep(workflowId, next, actor);
  } else {
    setWorkflow(workflowId, { status: "done", current_step_id: null });
    emit(workflowId, "workflow_completed", { message: "All steps complete" });
    recordAudit({ actor, via: "system", action: "workflow.done", detail: redact(workflowRow(workflowId)?.title ?? "").slice(0, 200) });
  }
}

/** Advance the workflow: finish the current running/review step and start the next (or complete the run).
 *  A step still WAITING on an approval decision cannot be advanced this way — it must go through the approval. */
export function advanceWorkflow(workflowId: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) return getWorkflow(workflowId)!; // idempotent no-op on a finished run
  if (wf.current_step_id) {
    const cur = stepRow(wf.current_step_id);
    if (cur) {
      // an approval gate can only be passed by granting its approval — never by a bare advance (else the gate
      // is bypassed and its durable approval is orphaned → a later approval would double-advance).
      if (cur.status === "waiting_user") throw new HttpError(409, "current step is awaiting an approval decision");
      if (cur.status === "running" || cur.status === "review") {
        setStep(cur.id, { status: "done", completed_at: now() });
        emit(workflowId, "step_completed", { stepId: cur.id, message: cur.name });
      }
    }
  }
  activateNext(workflowId, actor ?? "system");
  return getWorkflow(workflowId)!;
}

/** The approval-driven advance: grant a specific gated step and move on. Coupled to the step + its approval so
 *  a STALE approval (the workflow already moved past this step) is a safe no-op — never a double-advance. */
export function advanceWorkflowStep(workflowId: string, stepId: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) return getWorkflow(workflowId)!;
  const step = stepId ? stepRow(stepId) : null;
  // stale / mismatched: the gate no longer applies (workflow moved on, or this isn't the waiting step) → no-op
  if (!step || step.workflow_id !== workflowId || wf.current_step_id !== stepId || step.status !== "waiting_user") {
    emit(workflowId, "approval_stale", { stepId: stepId || null, message: "approval no longer applies" });
    return getWorkflow(workflowId)!;
  }
  // only advance if this step's gate approval was actually GRANTED (defense-in-depth beyond the decide flow)
  const appr = step.approval_id ? getApproval(step.approval_id) : null;
  if (!appr || appr.status !== "approved") {
    emit(workflowId, "approval_stale", { stepId, message: "approval not granted" });
    return getWorkflow(workflowId)!;
  }
  setStep(stepId, { status: "done", completed_at: now() });
  emit(workflowId, "step_completed", { stepId, message: step.name });
  activateNext(workflowId, actor ?? "approval");
  return getWorkflow(workflowId)!;
}

/** Mark the current step done with its output, then advance. */
export function completeStep(workflowId: string, stepId: string, output?: unknown, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) throw new HttpError(409, `workflow is ${wf.status}`);
  const step = stepRow(stepId);
  if (!step || step.workflow_id !== workflowId) throw new HttpError(404, "step not found");
  if (step.status !== "running" && step.status !== "review") throw new HttpError(409, `step is ${step.status} (only a running/review step can be completed)`);
  if (wf.current_step_id !== stepId) throw new HttpError(409, "not the current step");

  const outJson = output === undefined || output === null ? null : JSON.stringify(redactOutput(output));
  setStep(stepId, { status: "done", output_json: outJson, completed_at: now() });
  emit(workflowId, "step_completed", { stepId, message: step.name, payload: outJson ? { has_output: true } : null });
  activateNext(workflowId, actor ?? "system");
  return getWorkflow(workflowId)!;
}

/** Record a failed attempt: retry while attempts remain, else fail the step + the workflow. */
export function failStep(workflowId: string, stepId: string, reason?: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) throw new HttpError(409, `workflow is ${wf.status}`);
  const step = stepRow(stepId);
  if (!step || step.workflow_id !== workflowId) throw new HttpError(404, "step not found");
  // only the genuinely-active CURRENT step can record a failed attempt (else a queued step hijacks current_step_id)
  if (wf.current_step_id !== stepId) throw new HttpError(409, "not the current step");
  if (step.status !== "running" && step.status !== "review") throw new HttpError(409, `step is ${step.status} (only a running/review step can be failed)`);

  const attempt = step.attempt_count + 1;
  if (attempt >= step.max_attempts) {
    setStep(stepId, { status: "failed", attempt_count: attempt, completed_at: now() });
    setWorkflow(workflowId, { status: "failed" });
    emit(workflowId, "step_failed", { stepId, message: reason ?? "Step failed", payload: { attempt, max_attempts: step.max_attempts } });
    emit(workflowId, "workflow_failed", { stepId });
    recordAudit({ actor: actor ?? "system", via: "system", action: "workflow.step_failed", detail: redact(`${step.name}: ${reason ?? ""}`).slice(0, 200) });
  } else {
    setStep(stepId, { status: "running", attempt_count: attempt, started_at: step.started_at ?? now() });
    setWorkflow(workflowId, { status: "running", current_step_id: stepId });
    emit(workflowId, "step_retry", { stepId, message: reason ?? "Retrying", payload: { attempt, max_attempts: step.max_attempts } });
  }
  return getWorkflow(workflowId)!;
}

/** If a step is departing a waiting_user gate, decide its outstanding approval so it can never drive the
 *  machine later (a stale approve becomes a decided-not-pending no-op; idempotent if already decided). */
function voidStepApproval(step: WorkflowStep, actor: string, reason: string): void {
  if (step.status === "waiting_user" && step.approval_id) {
    try { decideApproval(step.approval_id, "reject", { trusted: true, by: actor, via: "api", reason }); } catch { /* already decided/expired */ }
  }
}

/** Block the current step (needs human intervention) and the workflow with it. */
export function blockStep(workflowId: string, stepId: string, reason?: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) throw new HttpError(409, `workflow is ${wf.status}`);
  const step = stepRow(stepId);
  if (!step || step.workflow_id !== workflowId) throw new HttpError(404, "step not found");
  if (STEP_TERMINAL.has(step.status)) throw new HttpError(409, `step is ${step.status}`);
  // only the current active step can be blocked (else a queued step hijacks current_step_id)
  if (wf.current_step_id !== stepId) throw new HttpError(409, "not the current step");
  voidStepApproval(step, actor ?? "system", reason ?? "step blocked"); // detach an orphaned gate approval
  setStep(stepId, { status: "blocked" });
  setWorkflow(workflowId, { status: "blocked", current_step_id: stepId });
  emit(workflowId, "step_blocked", { stepId, message: reason ?? "Blocked" });
  recordAudit({ actor: actor ?? "system", via: "system", action: "workflow.step_blocked", detail: redact(`${step.name}: ${reason ?? ""}`).slice(0, 200) });
  return getWorkflow(workflowId)!;
}

/** Skip a step; if it was the current one, advance to the next. */
export function skipStep(workflowId: string, stepId: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) throw new HttpError(409, `workflow is ${wf.status}`);
  const step = stepRow(stepId);
  if (!step || step.workflow_id !== workflowId) throw new HttpError(404, "step not found");
  if (STEP_TERMINAL.has(step.status)) throw new HttpError(409, `step is ${step.status}`);
  const wasCurrent = wf.current_step_id === stepId;
  voidStepApproval(step, actor ?? "system", "step skipped"); // detach an orphaned gate approval
  setStep(stepId, { status: "skipped", completed_at: now() });
  emit(workflowId, "step_skipped", { stepId, message: step.name });
  return wasCurrent ? advanceWorkflow(workflowId, actor) : getWorkflow(workflowId)!;
}

/** Cancel the whole workflow (terminal). */
export function cancelWorkflow(workflowId: string, actor?: string): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (WORKFLOW_TERMINAL.has(wf.status)) return getWorkflow(workflowId)!;
  if (wf.current_step_id) { const cur = stepRow(wf.current_step_id); if (cur) voidStepApproval(cur, actor ?? "dashboard", "workflow cancelled"); }
  setWorkflow(workflowId, { status: "cancelled", current_step_id: null });
  emit(workflowId, "workflow_cancelled", {});
  recordAudit({ actor: actor ?? "dashboard", via: "dashboard", action: "workflow.cancel", detail: redact(wf.title).slice(0, 200) });
  return getWorkflow(workflowId)!;
}

/** PATCH surface: rename, cancel, or reassign the current step's agent. Never a raw status jump. */
export function updateWorkflow(workflowId: string, patch: { title?: string; status?: string; actor?: string }): WorkflowDetail {
  const wf = workflowRow(workflowId);
  if (!wf) throw new HttpError(404, "workflow not found");
  if (patch.status === "cancelled") return cancelWorkflow(workflowId, patch.actor);
  if (patch.status !== undefined && patch.status !== wf.status)
    throw new HttpError(400, "status can only be changed to 'cancelled' (use the step operations to advance)");
  if (patch.title !== undefined) {
    setWorkflow(workflowId, { title: patch.title });
    emit(workflowId, "workflow_updated", { message: "renamed" });
  }
  return getWorkflow(workflowId)!;
}

/** Called from the approval-decide paths on REJECT: a rejected workflow-step approval blocks that step. */
export function handleWorkflowRejection(approval: Pick<Approval, "kind" | "action_json" | "reason">, actor?: string): void {
  if (approval.kind !== "workflow_step" || !approval.action_json) return;
  try {
    const a = JSON.parse(approval.action_json) as { type?: string; workflow_id?: string; step_id?: string };
    if (a.type === "advance_workflow" && a.workflow_id && a.step_id)
      blockStep(a.workflow_id, a.step_id, approval.reason ?? "Step approval rejected", actor);
  } catch { /* never block the decide flow */ }
}

function redactOutput(output: unknown): unknown {
  if (typeof output === "string") return redact(output).slice(0, 4000);
  if (output && typeof output === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(output as Record<string, unknown>).slice(0, 40))
      out[redact(k).slice(0, 80)] = typeof v === "string" ? redact(v).slice(0, 2000) : v;
    return out;
  }
  return output;
}
