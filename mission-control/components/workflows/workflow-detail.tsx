"use client";
// Workflow detail: the visual stepper + per-step actions, whole-workflow controls (advance / cancel), and a
// compact event log. All ops go through the session-gated API and re-fetch the detail after each change.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, XCircle, Layers } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { WorkflowStatusBadge } from "./workflow-badges";
import { WorkflowStepper } from "./workflow-stepper";
import type { WorkflowDetail } from "@/lib/workflows";

export function WorkflowDetailDrawer({
  open, onClose, id, agentName, teamName, getDetail, op, patch,
}: {
  open: boolean;
  onClose: () => void;
  id: string | null;
  agentName: (id?: string | null) => string | null;
  teamName: (id?: string | null) => string | null;
  getDetail: (id: string) => Promise<WorkflowDetail | null>;
  op: (id: string, body: Record<string, unknown>) => Promise<boolean>;
  patch: (id: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setDetail(await getDetail(id));
    setLoading(false);
  }, [id, getDetail]);
  useEffect(() => { if (open && id) refresh(); }, [open, id, refresh]);

  const wf = detail?.workflow ?? null;
  const terminal = wf ? ["done", "failed", "cancelled"].includes(wf.status) : true;

  const runOp = useCallback(async (o: string, stepId: string, extra: Record<string, unknown> = {}) => {
    if (!id) return;
    setBusy(true);
    const ok = await op(id, { op: o, stepId, ...extra });
    setBusy(false);
    if (ok) { toast.success(o.replace("_", " ")); refresh(); } else toast.error(`Could not ${o}`);
  }, [id, op, refresh]);

  async function advance() {
    if (!id) return;
    setBusy(true);
    const ok = await op(id, { op: "advance" });
    setBusy(false);
    if (ok) { toast.success("Advanced"); refresh(); } else toast.error("Could not advance");
  }
  async function cancel() {
    if (!id) return;
    const ok = await patch(id, { status: "cancelled" });
    if (ok) { toast.success("Workflow cancelled"); refresh(); } else toast.error("Could not cancel");
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DrawerContent title="Workflow">
          {loading && !detail ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-white/5" />)}</div>
          ) : !wf ? (
            <p className="p-5 text-sm text-white/50">Not found.</p>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <WorkflowStatusBadge status={wf.status} />
                {wf.template_id && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/45">{wf.template_id.replace(/^tpl_/, "").replace(/_/g, " ")}</span>}
              </div>
              <p className="text-[15px] font-medium leading-snug text-white">{wf.title}</p>

              <div className="rounded-xl border border-white/10 bg-black/20 px-3.5">
                {wf.work_item_id && <Row label="Work item"><a href="/work-items" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><Layers className="size-3" /> linked</a></Row>}
                {wf.team_id && <Row label="Team">{teamName(wf.team_id)}</Row>}
                <Row label="Created">{new Date(wf.created_at).toLocaleString()}{wf.created_by ? ` · ${wf.created_by}` : ""}</Row>
              </div>

              {/* whole-workflow controls */}
              {!terminal && (
                <div className="flex flex-wrap gap-1.5">
                  {wf.status !== "waiting_user" && (
                    <button disabled={busy} onClick={advance} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"><ChevronRight className="size-3.5" /> Advance</button>
                  )}
                  <button disabled={busy} onClick={cancel} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"><XCircle className="size-3.5" /> Cancel workflow</button>
                </div>
              )}

              {/* the visual pipeline */}
              <WorkflowStepper steps={detail!.steps} currentStepId={wf.current_step_id} terminal={terminal} agentName={agentName} onOp={runOp} busy={busy} />

              {/* event log */}
              {detail!.events.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-white/50">Activity</p>
                  <ol className="space-y-1">
                    {detail!.events.map((e) => (
                      <li key={e.id} className="flex items-start gap-2 text-[11px] text-white/50">
                        <span className="shrink-0 tabular-nums text-white/30">{new Date(e.created_at).toLocaleTimeString()}</span>
                        <span className="font-medium text-white/70">{e.type.replace(/_/g, " ")}</span>
                        {e.message && <span className="truncate text-white/45">— {e.message}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-right text-xs text-white/80">{children}</span>
    </div>
  );
}
