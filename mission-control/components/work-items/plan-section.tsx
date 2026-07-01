"use client";
// The plan surface on a work item: in plan_only mode with no plan yet → a compose form that submits a plan
// for approval (no changes are made); once a plan exists → a read-only view. Approval flows through the
// Decision Inbox / phone; on approve the work item flips to build_after_approval.
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkItem } from "@/lib/work-items";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function PlanSection({
  wi, submitPlan, onDone,
}: {
  wi: WorkItem;
  submitPlan: (id: string, plan: Record<string, unknown>) => Promise<boolean>;
  onDone: () => void;
}) {
  const plan = wi.plan as Record<string, unknown> | null;
  if (plan && typeof plan.goal === "string" && plan.goal) return <PlanView plan={plan} />;
  if (wi.mode !== "plan_only") return null;
  return <PlanForm id={wi.id} submitPlan={submitPlan} onDone={onDone} />;
}

function PlanView({ plan }: { plan: Record<string, unknown> }) {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) =>
    children ? <div className="border-b border-white/5 pb-2.5 last:border-0 last:pb-0"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/60">{title}</p><div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/75">{children}</div></div> : null;
  const ul = (xs: string[]) => (xs.length ? <ul className="list-disc pl-4">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
  const steps = list(plan.workflow_steps);
  return (
    <div className="glow-warn space-y-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3.5 backdrop-blur-[10px]">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200"><ClipboardList className="size-3.5" /> Plan</p>
      <Section title="Goal">{str(plan.goal)}</Section>
      <Section title="Approach">{str(plan.approach)}</Section>
      <Section title="Expected files">{ul(list(plan.expected_files))}</Section>
      <Section title="Needed agents / roles">{ul(list(plan.needed_agents))}</Section>
      <Section title="Workflow">{steps.length ? <ol className="list-decimal pl-4">{steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : null}</Section>
      <Section title="Risks">{ul(list(plan.risks))}</Section>
      <Section title="Test plan">{str(plan.test_plan)}</Section>
      <Section title="Cost / time">{str(plan.cost_estimate)}</Section>
      <p className="text-[11px] text-white/40">→ Awaiting your decision in the Decision Inbox.</p>
    </div>
  );
}

type F = { goal: string; approach: string; expected_files: string; needed_agents: string; workflow_steps: string; risks: string; test_plan: string; cost_estimate: string; approval_question: string };

function PlanForm({ id, submitPlan, onDone }: { id: string; submitPlan: (id: string, plan: Record<string, unknown>) => Promise<boolean>; onDone: () => void }) {
  const [f, setF] = useState<F>({ goal: "", approach: "", expected_files: "", needed_agents: "", workflow_steps: "", risks: "", test_plan: "", cost_estimate: "", approval_question: "" });
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!f.goal.trim()) return toast.error("Goal is required");
    setBusy(true);
    const ok = await submitPlan(id, {
      goal: f.goal, approach: f.approach, test_plan: f.test_plan, cost_estimate: f.cost_estimate, approval_question: f.approval_question,
      expected_files: lines(f.expected_files), needed_agents: lines(f.needed_agents), workflow_steps: lines(f.workflow_steps), risks: lines(f.risks),
    });
    setBusy(false);
    if (ok) { toast.success("Plan submitted — decision sent to your inbox"); onDone(); } else toast.error("Could not submit");
  }
  const T = (k: keyof F, ph: string, rows = 2) => (
    <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={rows} placeholder={ph} className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
  );
  return (
    <div className="glow-warn space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3.5 backdrop-blur-[10px]">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200"><ClipboardList className="size-3.5" /> Plan-only — compose a plan for approval (nothing is changed yet)</p>
      {T("goal", "Goal — what are we achieving?")}
      {T("approach", "Approach — summary")}
      {T("expected_files", "Expected files (one per line)")}
      {T("needed_agents", "Needed agents / roles (one per line)")}
      {T("workflow_steps", "Workflow steps (one per line)")}
      {T("risks", "Risks (one per line)")}
      {T("test_plan", "Test plan")}
      {T("cost_estimate", "Estimated cost / time", 1)}
      {T("approval_question", "Approval question (what you're asking Roy)", 1)}
      <Button variant="accent" className="h-11 w-full rounded-xl font-semibold" onClick={go} disabled={busy}>
        <Send className="size-4" /> {busy ? "Submitting…" : "Submit plan for approval"}
      </Button>
    </div>
  );
}
