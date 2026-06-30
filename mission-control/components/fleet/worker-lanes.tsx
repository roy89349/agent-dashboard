"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Clock, AlertTriangle, Skull, Ban, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useFleet, fmtDur } from "./use-fleet";
import type { SlotStatus, FleetState } from "@/lib/types";

const PHASE: Record<FleetState, { label: string; cls: string }> = {
  claimed: { label: "Claimed", cls: "bg-white/15 text-white/70" },
  building: { label: "Building", cls: "bg-indigo-500/80 text-white" },
  security: { label: "Security", cls: "bg-rose-500/80 text-white" },
  gating: { label: "Green gate", cls: "bg-amber-500/80 text-black" },
  "pr-open": { label: "PR open", cls: "bg-emerald-500/80 text-white" },
  reviewed: { label: "Reviewed", cls: "bg-teal-500/80 text-black" },
  failed: { label: "Failed", cls: "bg-red-500 text-white" },
};

export function WorkerLanes() {
  const { status, command, loaded } = useFleet();
  const online = status?.online ?? false;

  if (!status || status.slots.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-12 text-center">
        <Bot className="mx-auto size-8 text-white/20" />
        <p className="mt-3 text-sm text-white/40">
          {!loaded ? "Loading…" : online ? "No active workers" : "Fleet offline — start the supervisor"}
        </p>
        {online && <p className="mt-1 text-xs text-white/25">As soon as the fleet claims a task it appears here live.</p>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {status.slots.map((s) => (
        <WorkerLane key={s.slot ?? s.issue} slot={s} onCmd={command} />
      ))}
    </div>
  );
}

function WorkerLane({ slot, onCmd }: { slot: SlotStatus; onCmd: (cmd: string, issue?: number, confirm?: boolean) => void }) {
  const [showLog, setShowLog] = useState(true);
  const confirm = useConfirm();
  const ph = slot.phase ? PHASE[slot.phase] : null;
  return (
    <article className={`rounded-2xl border p-3 ${slot.stale ? "border-amber-500/50 bg-amber-500/[0.04]" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white" title={slot.title ?? ""}>
            <span className="text-white/40">#{slot.issue}</span> {slot.title ?? "…"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {ph && <span className={`rounded px-1.5 py-0.5 ${ph.cls}`}>{ph.label}</span>}
            {slot.model && (
              <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                <Bot className="size-3" /> {slot.model}{slot.effort ? ` · ${slot.effort}` : ""}
              </span>
            )}
            {slot.depth === "orchestrate" && (
              <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-indigo-200">orchestrate</span>
            )}
            <span className="inline-flex items-center gap-1 text-white/40">
              <Clock className="size-3" /> {fmtDur(slot.elapsed_s)}
            </span>
            {slot.stale && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertTriangle className="size-3" /> stalled
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">slot {slot.slot}</span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 text-white/60 hover:bg-white/10" onClick={() => setShowLog((v) => !v)}>
          <Terminal className="size-3.5" /> {showLog ? "Hide log" : "Live log"}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-amber-300 hover:bg-amber-500/10"
            onClick={async () => {
              if (slot.issue && (await confirm({ title: `Cancel #${slot.issue}?`, body: "The task will NOT be resumed.", tone: "danger", confirmLabel: "Cancel task" })))
                onCmd("cancel", slot.issue, true);
            }}>
            <Ban className="size-3.5" /> Cancel
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:bg-red-500/10"
            onClick={async () => {
              if (slot.issue && (await confirm({ title: `Kill #${slot.issue}?`, body: "The task returns to agent-ready and can be retried.", tone: "danger", confirmLabel: "Kill" })))
                onCmd("kill", slot.issue, true);
            }}>
            <Skull className="size-3.5" /> Kill
          </Button>
        </div>
      </div>

      {showLog && slot.issue != null && <LogTail issue={slot.issue} />}
    </article>
  );
}

function LogTail({ issue }: { issue: number }) {
  const [text, setText] = useState("");
  const fromRef = useRef(0);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    fromRef.current = 0;
    setText("");
    async function poll() {
      try {
        const res = await fetch(`/api/fleet/log?issue=${issue}&from=${fromRef.current}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const j = await res.json();
        if (typeof j.next === "number") fromRef.current = j.next;
        if (j.data) {
          setText((t) => (t + j.data).slice(-20000));
          requestAnimationFrame(() => {
            if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
          });
        }
      } catch {
        /* ignore */
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [issue]);

  return (
    <pre ref={boxRef} className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/50 p-2.5 text-[11px] leading-snug text-emerald-300/90">
      {text || "waiting for output…"}
    </pre>
  );
}
