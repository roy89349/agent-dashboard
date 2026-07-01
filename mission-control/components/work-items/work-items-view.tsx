"use client";
// Work items root: browse every task as a traceable unit, grouped by state, and open the detail/handoff
// view. Additive over the board — a GitHub issue can be promoted to a work item and tracked here.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, Plus, RefreshCw, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/glass";
import { WorkItemCard } from "./work-item-card";
import { WorkItemDetailDrawer } from "./work-item-detail";
import { STATE_LABEL } from "./badges";
import { useWorkItems } from "./use-work-items";
import type { WorkItemState, WorkItemPriority } from "@/lib/work-items";

// local (client-safe) copies — importing the values from lib/work-items would pull node:sqlite into the bundle
const WORK_ITEM_STATES: WorkItemState[] = ["queued", "running", "blocked", "waiting_user", "review", "failed", "done", "cancelled"];
const WORK_ITEM_PRIORITIES: WorkItemPriority[] = ["low", "normal", "high", "urgent"];
const STATE_ORDER: WorkItemState[] = ["waiting_user", "blocked", "review", "running", "queued", "failed", "done", "cancelled"];

export function WorkItemsView() {
  const W = useWorkItems();
  const [stateFilter, setStateFilter] = useState<WorkItemState | "all">("all");
  const [prioFilter, setPrioFilter] = useState<WorkItemPriority | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nt, setNt] = useState({ title: "", priority: "normal" as WorkItemPriority, issue: "" });

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => setRepo(c?.repo ?? null)).catch(() => {});
  }, []);

  const shown = useMemo(
    () => W.items.filter((i) => (stateFilter === "all" || i.state === stateFilter) && (prioFilter === "all" || i.priority === prioFilter)),
    [W.items, stateFilter, prioFilter],
  );
  const groups = useMemo(() => {
    const by = new Map<WorkItemState, typeof shown>();
    for (const i of shown) { if (!by.has(i.state)) by.set(i.state, []); by.get(i.state)!.push(i); }
    return STATE_ORDER.filter((s) => by.has(s)).map((s) => ({ state: s, items: by.get(s)! }));
  }, [shown]);

  async function create() {
    if (!nt.title.trim()) return;
    const wi = await W.createItem({ title: nt.title, priority: nt.priority, source_type: "manual", issue: nt.issue ? Number(nt.issue) : undefined });
    if (wi) { toast.success("Work item created"); setCreating(false); setNt({ title: "", priority: "normal", issue: "" }); setSelected(wi.id); }
    else toast.error("Could not create");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <PageHeader
        className="mb-4"
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="glass-card grid size-9 place-items-center text-emerald-300"><Layers className="size-[18px]" /></span>
            Work Items
          </span>
        }
        subtitle={W.loaded ? `${W.items.length} tracked tasks — handoffs, reviews, blockers` : "Loading…"}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => W.load()}>
              <RefreshCw className="size-3.5" /> <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="accent" className="h-11 sm:h-9 px-3" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New
            </Button>
          </>
        }
      />

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as WorkItemState | "all")} className="glass-card glass-hover h-9 rounded-lg px-2 text-xs text-white outline-none">
          <option value="all" className="bg-[#0d1322]">All states</option>
          {WORK_ITEM_STATES.map((s) => <option key={s} value={s} className="bg-[#0d1322]">{STATE_LABEL[s]}</option>)}
        </select>
        <select value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as WorkItemPriority | "all")} className="glass-card glass-hover h-9 rounded-lg px-2 text-xs text-white outline-none capitalize">
          <option value="all" className="bg-[#0d1322]">All priorities</option>
          {WORK_ITEM_PRIORITIES.map((p) => <option key={p} value={p} className="bg-[#0d1322] capitalize">{p}</option>)}
        </select>
      </div>

      {!W.loaded ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="glass-card h-28 animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Layers} title={W.items.length === 0 ? "No work items yet" : "Nothing matches this filter"} hint={W.items.length === 0 ? "Create one, or promote a GitHub issue to a tracked task." : "Adjust the filters above."} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.state}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">{STATE_LABEL[g.state]}</h3>
                <span className="rounded-full bg-white/5 px-1.5 text-[11px] text-white/40">{g.items.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.items.map((i) => <WorkItemCard key={i.id} item={i} agentName={W.agentName} selected={selected === i.id} onClick={() => setSelected(i.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <WorkItemDetailDrawer
        open={selected != null} onClose={() => setSelected(null)} id={selected}
        agents={W.agents} agentName={W.agentName} teamName={W.teamName} repo={repo}
        getDetail={W.getDetail} patchItem={W.patchItem} postMessage={W.postMessage} submitPlan={W.submitPlan} onSelectItem={(id) => setSelected(id)}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New work item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input autoFocus value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} placeholder="What needs to happen?" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={nt.priority} onChange={(e) => setNt({ ...nt, priority: e.target.value as WorkItemPriority })} className="h-10 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none capitalize focus:border-emerald-500/40">
                {WORK_ITEM_PRIORITIES.map((p) => <option key={p} value={p} className="bg-[#0d1322] capitalize">{p}</option>)}
              </select>
              <Input value={nt.issue} onChange={(e) => setNt({ ...nt, issue: e.target.value.replace(/\D/g, "") })} placeholder="link issue # (optional)" />
            </div>
            <Button variant="accent" className="h-11 w-full rounded-xl font-semibold" onClick={create} disabled={!nt.title.trim()}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
