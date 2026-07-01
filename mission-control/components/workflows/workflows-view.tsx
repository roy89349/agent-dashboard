"use client";
// Workflows root: browse pipelines grouped by status, start one from a template (with a live step preview),
// and open the visual detail/stepper. Additive over work items + approvals — a workflow tracks multi-role work.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { GitBranch, Plus, RefreshCw, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RoleChip } from "@/components/fleet/agent-meta";
import { WorkflowStatusBadge, WF_LABEL } from "./workflow-badges";
import { WorkflowDetailDrawer } from "./workflow-detail";
import { useWorkflows } from "./use-workflows";
import type { WorkflowStatus } from "@/lib/workflows";

const STATUS_ORDER: WorkflowStatus[] = ["waiting_user", "blocked", "running", "queued", "failed", "done", "cancelled"];

export function WorkflowsView({ initialWorkItemId }: { initialWorkItemId?: string } = {}) {
  const W = useWorkflows();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tpl, setTpl] = useState("");
  const [title, setTitle] = useState("");
  const [wiId, setWiId] = useState(initialWorkItemId ?? "");

  const groups = useMemo(() => {
    const by = new Map<WorkflowStatus, typeof W.workflows>();
    for (const w of W.workflows) { if (!by.has(w.status)) by.set(w.status, []); by.get(w.status)!.push(w); }
    return STATUS_ORDER.filter((s) => by.has(s)).map((s) => ({ status: s, items: by.get(s)! }));
  }, [W.workflows]);

  const preview = W.templates.find((t) => t.id === tpl);

  async function create() {
    if (!tpl) return toast.error("Pick a template");
    const d = await W.create({ template_id: tpl, title: title.trim() || undefined, work_item_id: wiId.trim() || undefined });
    if (d?.workflow) { toast.success("Workflow started"); setCreating(false); setTitle(""); setTpl(""); setSelected(d.workflow.id); }
    else toast.error("Could not start");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><GitBranch className="size-[18px]" /></div>
        <div>
          <h2 className="text-base font-semibold text-white">Workflows</h2>
          <p className="text-xs text-white/40">{W.loaded ? `${W.workflows.length} pipelines — multi-role, traceable, gated` : "Loading…"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => W.load()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span></button>
          <button onClick={() => setCreating(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400"><Plus className="size-4" /> New</button>
        </div>
      </div>

      {!W.loaded ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />)}</div>
      ) : W.workflows.length === 0 ? (
        <EmptyState icon={GitBranch} title="No workflows yet" hint="Start one from a template — Build feature, Fix bug, Improve UI, Audit project, Excel automation, Launch SaaS." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.status}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">{WF_LABEL[g.status]}</h3>
                <span className="rounded-full bg-white/5 px-1.5 text-[11px] text-white/40">{g.items.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.items.map((w) => (
                  <article key={w.id} onClick={() => setSelected(w.id)} className={`cursor-pointer rounded-2xl border p-4 transition-colors ${selected === w.id ? "border-emerald-400/60 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium leading-snug text-white/90">{w.title}</p>
                      <WorkflowStatusBadge status={w.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                      {w.template_id && <span className="capitalize">{w.template_id.replace(/^tpl_/, "").replace(/_/g, " ")}</span>}
                      {w.work_item_id && <span className="inline-flex items-center gap-1"><GitBranch className="size-3" /> linked task</span>}
                      <span>{new Date(w.updated_at).toLocaleDateString()}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <WorkflowDetailDrawer
        open={selected != null} onClose={() => setSelected(null)} id={selected}
        agentName={W.agentName} teamName={W.teamName} getDetail={W.getDetail} op={W.op} patch={W.patch}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start a workflow</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <select autoFocus value={tpl} onChange={(e) => setTpl(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40">
              <option value="" className="bg-[#0d1322]">Choose a template…</option>
              {W.templates.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}
            </select>
            {preview && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                {preview.description && <p className="mb-2 text-xs text-white/50">{preview.description}</p>}
                <div className="flex flex-wrap items-center gap-1">
                  {preview.steps.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/70">
                        {s.name}{s.role ? <RoleChip role={s.role} /> : null}{s.approval_required ? <span className="text-amber-300">🔓</span> : null}
                      </span>
                      {i < preview.steps.length - 1 && <ArrowRight className="size-3 text-white/25" />}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title (optional — defaults to the template name)" className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
            <input value={wiId} onChange={(e) => setWiId(e.target.value)} placeholder="link a work item id (optional)" className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
            <button onClick={create} disabled={!tpl} className="h-10 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">Start workflow</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
