"use client";
// Manager plan detail: the decomposition (goal · scope · subtasks with role/risk/skills/dependencies · workflow
// proposal · test strategy), the Approve / Adjust / Reject decision, and — once materialised — the parent/child
// overview. Approve/Reject go through the same durable-approval decide route as the Decision Inbox / phone.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, PencilLine, GitBranch, ArrowRight } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { RoleChip } from "@/components/fleet/agent-meta";
import { RiskBadge } from "@/components/skills/risk-badge";
import { StateBadge } from "@/components/work-items/badges";
import { ManagerStatusBadge } from "./manager-badges";
import type { ManagerDetail } from "./use-manager";

export function ManagerDetailDrawer({
  open, onClose, id, getDetail, decide, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  id: string | null;
  getDetail: (id: string) => Promise<ManagerDetail | null>;
  decide: (approvalId: string, action: "approve" | "reject", reason?: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ManagerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"none" | "adjust" | "reject">("none");

  const refresh = useCallback(async () => { if (!id) return; setLoading(true); setDetail(await getDetail(id)); setLoading(false); }, [id, getDetail]);
  useEffect(() => { if (open && id) { setMode("none"); setReason(""); refresh(); } }, [open, id, refresh]);

  const mp = detail?.managerPlan ?? null;
  const plan = mp?.plan ?? null;
  const wi = detail?.workItem ?? null;

  async function act(action: "approve" | "reject", why?: string) {
    if (!mp?.approval_id) return toast.error("no approval attached");
    setBusy(true);
    const ok = await decide(mp.approval_id, action, why);
    setBusy(false);
    if (ok) { toast.success(action === "approve" ? "Approved — subtasks created" : "Sent back"); setMode("none"); setReason(""); refresh(); onChanged(); }
    else toast.error("Could not decide");
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DrawerContent title="Manager plan">
          {loading && !detail ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-white/5" />)}</div>
          ) : !mp || !plan ? (
            <p className="p-5 text-sm text-white/50">Not found.</p>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ManagerStatusBadge status={mp.status} />
                {plan.workflow_template_id && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/45">{plan.workflow_template_id.replace(/^tpl_/, "").replace(/_/g, " ")}</span>}
                <span className="text-[11px] text-white/40">depth {mp.depth}</span>
              </div>
              <p className="text-[15px] font-medium leading-snug text-white">{wi?.title ?? plan.goal}</p>

              <Section title="Goal">{plan.goal}</Section>
              {plan.scope && <Section title="Scope">{plan.scope}</Section>}

              {/* subtasks + dependencies */}
              <div className="glass-inset rounded-xl p-2.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Subtasks ({plan.subtasks.length})</p>
                <ol className="space-y-1.5">
                  {plan.subtasks.map((t, i) => {
                    const childId = plan.child_ids?.[i] ?? null;
                    const child = childId ? detail!.children.find((c) => c.id === childId) : null;
                    return (
                      <li key={i} className="glass-card px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="grid size-5 place-items-center rounded-full bg-white/5 text-[10px] font-semibold text-white/60">{i + 1}</span>
                          <span className="text-sm text-white/90">{t.title}</span>
                          {t.role && <RoleChip role={t.role} />}
                          <RiskBadge risk={t.risk_level} />
                          {child && <StateBadge state={child.state} />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-[11px] text-white/45">
                          {t.depends_on.length > 0 && <span className="text-white/50">depends on {t.depends_on.map((d) => `#${d + 1}`).join(", ")}</span>}
                          {t.skills.map((sk) => <span key={sk} className="rounded bg-white/5 px-1.5 text-[10px]">{sk}</span>)}
                          {child?.issue != null && <span className="text-emerald-300/70">issue #{child.issue}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {plan.risks.length > 0 && <Section title="Risks"><ul className="list-disc pl-4">{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></Section>}
              {plan.test_strategy && <Section title="Test strategy">{plan.test_strategy}</Section>}

              {/* decision */}
              {mp.status === "proposed" && (
                <div className="glow-warn space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
                  {mode === "none" ? (
                    <div className="flex flex-wrap gap-1.5">
                      <button disabled={busy} onClick={() => act("approve")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"><CheckCircle2 className="size-3.5" /> Approve plan</button>
                      <button disabled={busy} onClick={() => setMode("adjust")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/15 px-3.5 text-xs text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50"><PencilLine className="size-3.5" /> Adjust</button>
                      <button disabled={busy} onClick={() => setMode("reject")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-500/30 px-3.5 text-xs text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-50"><XCircle className="size-3.5" /> Reject</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-white/60">{mode === "adjust" ? "Send back with adjustments — describe what to change:" : "Reject — why?"}</p>
                      <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={mode === "adjust" ? "e.g. split subtask 3, drop the deploy step" : "reason (optional)"} className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-500/40" />
                      <div className="flex gap-1.5">
                        <button disabled={busy} onClick={() => act("reject", (mode === "adjust" ? "Adjust: " : "") + reason.trim())} className="inline-flex items-center gap-1 rounded-lg bg-rose-500/80 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">{mode === "adjust" ? "Send back" : "Reject plan"}</button>
                        <button disabled={busy} onClick={() => { setMode("none"); setReason(""); }} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/5">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* materialised → parent/child + workflow */}
              {mp.status === "materialized" && (
                <div className="glow-ok rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-200"><GitBranch className="size-3.5" /> {detail!.children.length} subtasks created{mp.workflow_id ? " · workflow started" : ""}</p>
                  {mp.workflow_id && <a href="/workflows" className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200">open the workflow <ArrowRight className="size-3" /></a>}
                </div>
              )}
              {mp.status === "rejected" && <p className="text-xs text-rose-300/80">Rejected — the parent task is blocked. Propose a revised plan to continue.</p>}
            </div>
          )}
        </DrawerContent>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</p><div className="mt-0.5 whitespace-pre-wrap text-sm text-white/75">{children}</div></div>;
}
