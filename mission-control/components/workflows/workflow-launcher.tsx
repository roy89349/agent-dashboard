"use client";
// Start a workflow from a work item (a task, or an approved plan-only item — the plan lives on the work item).
// Self-contained: fetches templates, POSTs a workflow linked to this work item, then links to /workflows.
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GitBranch, Play, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowTemplate } from "@/lib/workflows";

export function WorkflowLauncher({ workItemId, title }: { workItemId: string; title?: string }) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [tpl, setTpl] = useState("");
  const [busy, setBusy] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workflow-templates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTemplates(j?.templates ?? [])).catch(() => {});
  }, []);

  async function start() {
    if (!tpl) return;
    setBusy(true);
    const r = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: tpl, work_item_id: workItemId, title }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && j?.workflow) { setStartedId(j.workflow.id); toast.success("Workflow started"); }
    else toast.error(j?.error ?? "Could not start");
  }

  return (
    <div className="glass-inset p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35"><GitBranch className="size-3.5" /> Run a workflow for this task</p>
      {startedId ? (
        <Link href="/workflows" className="inline-flex items-center gap-1 text-sm text-emerald-300 hover:text-emerald-200">
          Workflow started — open Workflows <ArrowRight className="size-3.5" />
        </Link>
      ) : (
        <div className="flex items-center gap-2">
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white outline-none focus:border-emerald-500/40">
            <option value="" className="bg-[#0d1322]">Choose a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}
          </select>
          <Button variant="accent" className="h-11 px-3 font-semibold" disabled={!tpl || busy} onClick={start}>
            <Play className="size-4" /> Start
          </Button>
        </div>
      )}
    </div>
  );
}
