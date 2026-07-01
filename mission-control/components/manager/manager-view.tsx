"use client";
// Manager / Decomposer root: browse proposed/decided decomposition plans, compose a new one (subtasks with
// roles/risks/dependencies, optionally seeded from a workflow template), and open the plan detail to Approve /
// Adjust / Reject. Materialised plans show their child work_items. Reuses work_items + workflows + approvals.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Boxes, Plus, RefreshCw, Trash2, Sparkles, Settings2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManagerStatusBadge, STATUS_LABEL } from "./manager-badges";
import { ManagerDetailDrawer } from "./manager-detail";
import { useManager } from "./use-manager";
import type { ManagerPlan } from "@/lib/manager";

type Status = ManagerPlan["status"];
const ORDER: Status[] = ["proposed", "materialized", "approved", "rejected"];
const RISKS = ["low", "medium", "high", "critical"] as const;
type Row = { title: string; role: string; risk: (typeof RISKS)[number]; deps: string };

export function ManagerView() {
  const M = useManager();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState<Row[]>([{ title: "", role: "", risk: "medium", deps: "" }]);

  const groups = useMemo(() => {
    const by = new Map<Status, ManagerPlan[]>();
    for (const p of M.plans) { if (!by.has(p.status)) by.set(p.status, []); by.get(p.status)!.push(p); }
    return ORDER.filter((s) => by.has(s)).map((s) => ({ status: s, items: by.get(s)! }));
  }, [M.plans]);

  const max = M.config?.max_subtasks_per_plan ?? 12;

  function seed() {
    const tpl = M.templates.find((t) => t.id === templateId);
    if (!tpl) return toast.error("Pick a template to seed from");
    setRows(tpl.steps.slice(0, max).map((s, i) => ({ title: s.name, role: s.role ?? "", risk: s.approval_required ? "high" : "medium", deps: i > 0 ? String(i) : "" })));
    if (!goal.trim()) setGoal(title.trim() || tpl.name);
  }

  async function create() {
    const g = goal.trim() || title.trim();
    if (!g) return toast.error("Add a goal");
    // dropping empty-title rows shifts positions — remap the user's visible 1-based deps to the kept indices,
    // so a dependency on a removed/blank row is dropped instead of silently pointing at the wrong subtask.
    const remap = new Map<number, number>();
    rows.forEach((r, oldIdx) => { if (r.title.trim()) remap.set(oldIdx, remap.size); });
    const subtasks = rows.filter((r) => r.title.trim()).map((r) => ({
      title: r.title.trim(), role: r.role || null, risk_level: r.risk,
      depends_on: r.deps.split(",").map((x) => remap.get(Number(x.trim()) - 1)).filter((n): n is number => n !== undefined),
    }));
    if (subtasks.length === 0) return toast.error("Add at least one subtask");
    const { managerPlan, error } = await M.propose({ title: title.trim() || g, plan: { goal: g, workflow_template_id: templateId || null, subtasks } });
    if (managerPlan) { toast.success("Plan proposed — decide it below"); setCreating(false); setTitle(""); setGoal(""); setTemplateId(""); setRows([{ title: "", role: "", risk: "medium", deps: "" }]); setSelected(managerPlan.id); }
    else toast.error(error ?? "Could not propose");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><Boxes className="size-[18px]" /></div>
        <div>
          <h2 className="text-base font-semibold text-white">Manager</h2>
          <p className="text-xs text-white/40">{M.loaded ? `${M.plans.length} decomposition plans — split big tasks safely` : "Loading…"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setCfgOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><Settings2 className="size-3.5" /> <span className="hidden sm:inline">Limits</span></button>
          <button onClick={() => M.load()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"><RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span></button>
          <button onClick={() => setCreating(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400"><Plus className="size-4" /> New</button>
        </div>
      </div>

      {!M.loaded ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />)}</div>
      ) : M.plans.length === 0 ? (
        <EmptyState icon={Boxes} title="No decomposition plans yet" hint="Give the Manager a big task — it proposes subtasks, roles and a workflow; you approve before anything is created." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.status}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">{STATUS_LABEL[g.status]}</h3>
                <span className="rounded-full bg-white/5 px-1.5 text-[11px] text-white/40">{g.items.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.items.map((p) => {
                  const highs = p.plan.subtasks.filter((t) => t.risk_level === "high" || t.risk_level === "critical").length;
                  return (
                    <article key={p.id} onClick={() => setSelected(p.id)} className={`cursor-pointer rounded-2xl border p-4 transition-colors ${selected === p.id ? "border-emerald-400/60 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-medium leading-snug text-white/90">{p.plan.goal}</p>
                        <ManagerStatusBadge status={p.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                        <span>{p.plan.subtasks.length} subtasks</span>
                        {highs > 0 && <span className="text-amber-300/80">{highs} high-risk</span>}
                        {p.plan.roles.length > 0 && <span className="capitalize">{p.plan.roles.join(" · ")}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ManagerDetailDrawer open={selected != null} onClose={() => setSelected(null)} id={selected} getDetail={M.getDetail} decide={M.decide} onChanged={M.load} />

      {/* new decomposition */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Propose a decomposition</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-0.5">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title of the big task" className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="Goal — what should the whole thing achieve?" className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
            <div className="flex items-center gap-2">
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none focus:border-emerald-500/40">
                <option value="" className="bg-[#0d1322]">Workflow (optional)…</option>
                {M.templates.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}
              </select>
              <button onClick={seed} disabled={!templateId} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-40"><Sparkles className="size-3.5" /> Seed subtasks</button>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-white/50">Subtasks <span className="text-white/30">({rows.length}/{max})</span></p>
                <button onClick={() => rows.length < max && setRows([...rows, { title: "", role: "", risk: "medium", deps: "" }])} disabled={rows.length >= max} className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-40">+ add</button>
              </div>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-5 text-center text-[11px] text-white/35">{i + 1}</span>
                    <input value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="subtask" className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
                    <select value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} className="h-8 rounded-lg border border-white/10 bg-white/5 px-1 text-xs text-white outline-none">
                      <option value="" className="bg-[#0d1322]">role</option>
                      {M.roles.map((role) => <option key={role} value={role} className="bg-[#0d1322]">{role}</option>)}
                    </select>
                    <select value={r.risk} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, risk: e.target.value as Row["risk"] } : x)))} className="h-8 rounded-lg border border-white/10 bg-white/5 px-1 text-xs text-white outline-none">
                      {RISKS.map((rk) => <option key={rk} value={rk} className="bg-[#0d1322]">{rk}</option>)}
                    </select>
                    <input value={r.deps} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, deps: e.target.value } : x)))} placeholder="deps" title="depends on subtask #s, comma-separated" className="h-8 w-14 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
                    <button onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)} className="text-white/30 hover:text-rose-300"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-white/30">High/critical subtasks become plan-only work items — they need their own plan approval before building.</p>
            </div>

            <button onClick={create} className="h-10 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400">Propose for approval</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* limits */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decomposition limits</DialogTitle></DialogHeader>
          {M.config && <ConfigForm config={M.config} onSave={async (p) => { await M.saveConfig(p); toast.success("Limits saved"); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigForm({ config, onSave }: { config: NonNullable<ReturnType<typeof useManager>["config"]>; onSave: (p: Record<string, unknown>) => Promise<void> }) {
  const [subs, setSubs] = useState(config.max_subtasks_per_plan);
  const [depth, setDepth] = useState(config.max_depth);
  const [issues, setIssues] = useState(config.allow_github_issues);
  return (
    <div className="space-y-3">
      <label className="block text-sm text-white/70">Max subtasks per plan
        <input type="number" min={1} max={50} value={subs} onChange={(e) => setSubs(Number(e.target.value))} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40" />
      </label>
      <label className="block text-sm text-white/70">Max decomposition depth
        <input type="number" min={0} max={6} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40" />
      </label>
      <label className="flex items-center gap-2 text-sm text-white/70">
        <input type="checkbox" checked={issues} onChange={(e) => setIssues(e.target.checked)} /> Allow creating agent-ready GitHub issues (off = work items only)
      </label>
      <button onClick={() => onSave({ max_subtasks_per_plan: subs, max_depth: depth, allow_github_issues: issues })} className="h-10 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400">Save limits</button>
    </div>
  );
}
