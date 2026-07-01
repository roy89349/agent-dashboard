"use client";
// Decision Inbox — the dashboard half of the durable-approvals system. The phone is fast; this is the
// full context. Every decision goes through POST /api/approvals/decide → the SAME server-side
// decideApproval() the phone uses (decided_via="dashboard"). No window.confirm/prompt; a dark drawer
// holds the full redacted context, diff, agent advice, phone-notification status and audit trail.
import { useCallback, useEffect, useState } from "react";
import {
  Inbox, ShieldAlert, ShieldCheck, ShieldQuestion, GitPullRequest, Bug, Bot, Clock,
  Check, X, PauseCircle, UserCog, ExternalLink, RefreshCw, Smartphone, History,
} from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { PageHeader, SectionLabel } from "@/components/ui/glass";
import { EmptyState as GlassEmptyState } from "@/components/ui/empty-state";
import {
  approvalView, type ApprovalView, type PublicApproval, type Tone, type DashboardAction,
} from "@/lib/approvals-view";

type AuditRow = {
  id: number; ts: string; actor: string | null; via: string | null;
  action: string; kind: string | null; issue: number | null; detail: string | null;
};
type Detail = {
  approval: PublicApproval;
  audit: AuditRow[];
  notification: { provider: string; phoneConfigured: boolean; delivered: boolean; messageIds: string[] };
};

const TONE: Record<Tone, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  red: "border-red-500/30 bg-red-500/15 text-red-300",
  amber: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  indigo: "border-indigo-500/30 bg-indigo-500/15 text-indigo-300",
  slate: "border-white/10 bg-white/5 text-white/50",
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

function RiskBadge({ v }: { v: ApprovalView }) {
  if (v.risk === "none") return null;
  const Icon = v.risk === "high" ? ShieldAlert : v.risk === "low" ? ShieldCheck : ShieldQuestion;
  return (
    <Badge tone={v.riskTone}>
      <Icon className="size-3" /> {v.risk} risk
    </Badge>
  );
}

function Chip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-white/45">
      <Icon className="size-3" /> {children}
    </span>
  );
}

// ── action buttons (large, dark; no light ui/button here) ──
const BTN: Record<string, string> = {
  approve: "bg-emerald-500 text-black hover:bg-emerald-400",
  reject: "bg-red-500/90 text-white hover:bg-red-500",
  pause: "bg-amber-500/90 text-black hover:bg-amber-400",
  manager: "bg-white/10 text-white/80 hover:bg-white/15",
  ghost: "border border-white/15 text-white/70 hover:bg-white/5",
};
function ActionButton({
  kind, icon: Icon, label, onClick, busy, disabled,
}: {
  kind: keyof typeof BTN; icon: React.ComponentType<{ className?: string }>; label: string;
  onClick: () => void; busy?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${BTN[kind]}`}
    >
      {busy ? <RefreshCw className="size-4 animate-spin" /> : <Icon className="size-4" />} {label}
    </button>
  );
}

export default function ApprovalsPage() {
  const [list, setList] = useState<PublicApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // `${id}:${action}`
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [repo, setRepo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/approvals", { cache: "no-store" });
      if (r.ok) setList(((await r.json()).approvals ?? []) as PublicApproval[]);
    } catch {
      /* offline */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setRepo(c?.repo ?? null))
      .catch(() => {});
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id);
    setDetail(null);
    setReason("");
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/approvals/${id}`, { cache: "no-store" });
      if (r.ok) setDetail((await r.json()) as Detail);
    } catch {
      /* ignore */
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function decide(id: string, action: DashboardAction) {
    setBusy(`${id}:${action}`);
    try {
      const r = await fetch("/api/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason: reason.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setToast({ ok: false, msg: j.error ?? `Failed (${r.status})` });
      } else {
        const verb =
          action === "approve" ? "Approved" : action === "reject" ? "Rejected" :
          action === "pause" ? "Paused" : "Deferred to manager";
        setToast({ ok: true, msg: j.action?.detail ? `${verb} — ${j.action.detail}` : verb });
        // manager keeps it pending; the rest leave pending → close the drawer
        if (action !== "manager") setSelected(null);
        else if (selected === id) openDetail(id);
      }
    } catch {
      setToast({ ok: false, msg: "Network error" });
    } finally {
      setBusy(null);
      load();
    }
  }

  const views = list.map((a) => approvalView(a));
  const pending = views.filter((v) => v.pending);
  const history = views.filter((v) => !v.pending);
  const shown = tab === "pending" ? pending : history;

  const ghLink = (v: ApprovalView): string | null => {
    if (!repo) return null;
    if (v.pr) return `https://github.com/${repo}/pull/${v.pr}`;
    if (v.issue) return `https://github.com/${repo}/issues/${v.issue}`;
    return null;
  };

  const selView = detail ? approvalView(detail.approval) : views.find((v) => v.id === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      {/* ── header + tabs ── */}
      <PageHeader
        className="mb-4"
        title={
          <span className="flex items-center gap-3">
            <span className="glass-card grid size-9 place-items-center text-emerald-300">
              <Inbox className="size-4.5" />
            </span>
            Decision Inbox
          </span>
        }
        subtitle={
          pending.length > 0
            ? `${pending.length} decision${pending.length === 1 ? "" : "s"} waiting for you — phone & dashboard share one store.`
            : "Nothing waiting — approvals from your fleet land here and on your phone."
        }
        actions={
          <button
            onClick={load}
            className="glass-card glass-hover inline-flex h-11 items-center gap-1.5 px-3.5 text-xs text-white/60 hover:text-white/90"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <div className="glass-card mb-4 inline-flex p-1 text-sm">
        {(["pending", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors ${
              tab === t ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {t === "pending" ? <Inbox className="size-3.5" /> : <History className="size-3.5" />}
            {t === "pending" ? "Pending" : "History"}
            <span className={`ml-1 rounded-full px-1.5 text-[11px] tabular-nums ${tab === t ? "bg-white/15 text-white" : "bg-white/5 text-white/40"}`}>
              {t === "pending" ? pending.length : history.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── list ── */}
      {loading && list.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card h-28 animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-3">
          {shown.map((v) => (
            <Card
              key={v.id}
              v={v}
              busy={busy}
              onOpen={() => openDetail(v.id)}
              onApprove={() => decide(v.id, "approve")}
              onReject={() => decide(v.id, "reject")}
            />
          ))}
        </div>
      )}

      {/* ── detail drawer ── */}
      <Drawer open={selected != null} onOpenChange={(o) => !o && setSelected(null)}>
        {selected != null && (
          <DrawerContent title="Decision detail">
            {detailLoading && !detail ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-5 animate-pulse rounded bg-white/5" />
                ))}
              </div>
            ) : selView ? (
              <DetailBody
                v={selView}
                detail={detail}
                reason={reason}
                setReason={setReason}
                busy={busy}
                ghLink={ghLink(selView)}
                onAction={(a) => decide(selView.id, a)}
              />
            ) : (
              <p className="p-5 text-sm text-white/50">Not found.</p>
            )}
          </DrawerContent>
        )}
      </Drawer>

      {/* ── toast ── */}
      {toast && (
        <div className="fixed inset-x-0 bottom-5 z-[60] mx-auto w-fit max-w-[90vw] px-4">
          <div className={`glass-overlay rounded-xl px-4 py-2.5 text-sm ${toast.ok ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}>
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: "pending" | "history" }) {
  return (
    <GlassEmptyState
      icon={tab === "pending" ? ShieldCheck : History}
      tone={tab === "pending" ? "emerald" : "slate"}
      title={tab === "pending" ? "No decisions waiting" : "No past decisions yet"}
      hint={tab === "pending" ? "You're all clear — agents will ping you here and on your phone." : "Approved, rejected and expired items will show up here."}
    />
  );
}

function Card({
  v, busy, onOpen, onApprove, onReject,
}: {
  v: ApprovalView; busy: string | null; onOpen: () => void; onApprove: () => void; onReject: () => void;
}) {
  return (
    <article className="glass-card glass-hover overflow-hidden">
      <button onClick={onOpen} className="block w-full p-4 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="indigo">{v.kindLabel}</Badge>
          <RiskBadge v={v} />
          <div className="ml-auto flex items-center gap-2">
            {!v.pending && <Badge tone={v.statusTone}>{v.statusLabel}</Badge>}
            <span className="text-[11px] text-white/35">{v.createdLabel}</span>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-[15px] font-medium leading-snug text-white/90">{v.summary}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {v.hasTarget && <Chip icon={v.pr ? GitPullRequest : Bug}>{v.target}</Chip>}
          {v.agent && <Chip icon={Bot}>{v.agent}</Chip>}
          {v.pending ? (
            <Chip icon={Clock}>{v.expiresLabel}</Chip>
          ) : (
            <Chip icon={Check}>{v.decidedViaLabel}{v.decidedBy && v.decidedBy !== "dashboard" ? ` · ${v.decidedBy}` : ""}</Chip>
          )}
        </div>
      </button>
      {v.pending && (
        <div className="flex gap-2 border-t border-white/5 px-4 py-3">
          <ActionButton kind="approve" icon={Check} label="Approve" onClick={onApprove} busy={busy === `${v.id}:approve`} disabled={!!busy} />
          <ActionButton kind="reject" icon={X} label="Reject" onClick={onReject} busy={busy === `${v.id}:reject`} disabled={!!busy} />
          <button
            onClick={onOpen}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/15 px-4 text-sm font-medium text-white/70 hover:bg-white/5"
          >
            Details
          </button>
        </div>
      )}
    </article>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-right text-xs text-white/80">{value}</span>
    </div>
  );
}

function DetailBody({
  v, detail, reason, setReason, busy, ghLink, onAction,
}: {
  v: ApprovalView;
  detail: Detail | null;
  reason: string;
  setReason: (s: string) => void;
  busy: string | null;
  ghLink: string | null;
  onAction: (a: DashboardAction) => void;
}) {
  const notif = detail?.notification;
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-5">
        {/* badges + summary */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="indigo">{v.kindLabel}</Badge>
          <RiskBadge v={v} />
          <Badge tone={v.statusTone}>{v.statusLabel}</Badge>
        </div>
        <p className="text-[15px] font-medium leading-snug text-white">{v.summary}</p>

        {/* risk + advice callouts */}
        {(v.riskText || v.advice) && (
          <div className="space-y-2">
            <SectionLabel>Why am I being asked?</SectionLabel>
            {v.riskText && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
                <span className="font-semibold">Risk:</span> {v.riskText}
              </div>
            )}
            {v.advice && (
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-xs text-indigo-200/90">
                <span className="font-semibold">Agent advice:</span> {v.advice}
              </div>
            )}
          </div>
        )}

        {/* meta */}
        <div className="glass-inset px-3.5">
          <MetaRow label="Target" value={v.target} />
          <MetaRow label="Agent" value={v.agent ?? "—"} />
          <MetaRow label="Status" value={<Badge tone={v.statusTone}>{v.statusLabel}</Badge>} />
          <MetaRow label="Created" value={v.createdLabel} />
          {v.pending && <MetaRow label="Expires" value={v.expiresLabel} />}
          {!v.pending && (
            <>
              <MetaRow label="Decided via" value={v.decidedViaLabel} />
              {v.decidedBy && <MetaRow label="Decided by" value={v.decidedBy} />}
              {v.reason && <MetaRow label="Reason" value={v.reason} />}
            </>
          )}
        </div>

        {/* phone notification status */}
        {notif && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Smartphone className="size-3.5 text-white/40" />
            {notif.delivered
              ? `Sent to your phone (${notif.provider})`
              : notif.phoneConfigured
                ? `Deliverable — ${notif.provider} connected`
                : "Phone not configured"}
          </div>
        )}

        {/* diff preview */}
        {v.diffPreview && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-white/50">Context (redacted)</p>
            <pre className="glass-inset max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-white/70">
              {v.diffPreview}
            </pre>
          </div>
        )}

        {/* audit trail */}
        {detail && detail.audit.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-white/50">Audit trail</p>
            <ol className="space-y-2">
              {detail.audit.map((a) => (
                <li key={a.id} className="flex gap-2.5 text-[11px]">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                  <div className="min-w-0">
                    <p className="text-white/70">
                      <span className="font-medium text-white/85">{a.action.replace(/^approval\./, "")}</span>
                      {a.via ? ` · ${a.via}` : ""}{a.actor ? ` · ${a.actor}` : ""}
                    </p>
                    {a.detail && <p className="truncate text-white/40">{a.detail}</p>}
                    <p className="text-white/30">{new Date(a.ts).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* reason input for reject/pause (no window.prompt) */}
        {v.pending && (
          <div>
            <label className="mb-1.5 block text-xs text-white/40">Reason (optional — recorded with reject / pause)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. needs a test first"
              className="glass-inset w-full resize-none px-3 py-2 text-sm text-white/90 placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
            />
          </div>
        )}

        {/* open external */}
        {ghLink && (
          <a
            href={ghLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white/90"
          >
            <ExternalLink className="size-3.5" /> Open {v.pr ? `PR #${v.pr}` : `issue #${v.issue}`} on GitHub
          </a>
        )}
      </div>

      {/* sticky action bar */}
      {v.pending && (
        <div className="glass-overlay sticky bottom-0 mt-auto rounded-none border-x-0 border-b-0 p-4">
          <div className="flex gap-2">
            <ActionButton kind="approve" icon={Check} label="Approve" onClick={() => onAction("approve")} busy={busy === `${v.id}:approve`} disabled={!!busy} />
            <ActionButton kind="reject" icon={X} label="Reject" onClick={() => onAction("reject")} busy={busy === `${v.id}:reject`} disabled={!!busy} />
          </div>
          <div className="mt-2 flex gap-2">
            {v.hasTarget && (
              <ActionButton kind="pause" icon={PauseCircle} label="Pause task" onClick={() => onAction("pause")} busy={busy === `${v.id}:pause`} disabled={!!busy} />
            )}
            <ActionButton kind="manager" icon={UserCog} label="Let manager decide" onClick={() => onAction("manager")} busy={busy === `${v.id}:manager`} disabled={!!busy} />
          </div>
        </div>
      )}
    </div>
  );
}
