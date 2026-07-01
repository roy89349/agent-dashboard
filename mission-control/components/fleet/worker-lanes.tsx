"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Clock, AlertTriangle, Skull, Ban, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentIdentity, RiskBadge, WaitingBadge } from "@/components/fleet/agent-meta";
import { FilterBar } from "@/components/fleet/filter-bar";
import { slotMeta, matches, facets, groupKey, type FilterState, type GroupDim } from "@/lib/agent-view";
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

const GROUP_OPTIONS = [
  { key: "none", label: "Flat" },
  { key: "role", label: "Role" },
  { key: "team", label: "Team" },
  { key: "status", label: "Status" },
];

export function WorkerLanes() {
  const { status, command, loaded } = useFleet();
  const online = status?.online ?? false;
  const [filters, setFilters] = useState<FilterState>({});
  const [group, setGroup] = useState("none");

  const slots = useMemo(() => status?.slots ?? [], [status]);
  const fac = useMemo(() => facets(slots.map(slotMeta)), [slots]);
  const filtered = useMemo(() => slots.filter((s) => matches(slotMeta(s), filters)), [slots, filters]);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "all", label: "", slots: filtered }];
    const dim = group as GroupDim;
    const m = new Map<string, { label: string; slots: SlotStatus[] }>();
    for (const s of filtered) {
      const g = groupKey(slotMeta(s), dim);
      if (!m.has(g.key)) m.set(g.key, { label: g.label, slots: [] });
      m.get(g.key)!.slots.push(s);
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] === "_none" ? 1 : b[0] === "_none" ? -1 : a[1].label.localeCompare(b[1].label)))
      .map(([key, v]) => ({ key, label: v.label, slots: v.slots }));
  }, [filtered, group]);

  if (!status || slots.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        tone="slate"
        title={!loaded ? "Loading…" : online ? "No active workers" : "Fleet offline — start the supervisor"}
        hint={online ? "As soon as the fleet claims a task it appears here live." : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar
        facets={fac}
        filters={filters}
        onFilter={setFilters}
        group={group}
        onGroup={setGroup}
        groupOptions={GROUP_OPTIONS}
      />
      {filtered.length === 0 ? (
        <p className="glass-inset border-dashed py-10 text-center text-sm text-white/40">
          No workers match this filter.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-3">
            {g.label && (
              <div className="flex items-center gap-2 px-0.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 capitalize">{g.label}</h3>
                <span className="rounded-full bg-white/5 px-1.5 text-[11px] text-white/40">{g.slots.length}</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {g.slots.map((s) => (
                <WorkerLane key={s.slot ?? s.issue} slot={s} onCmd={command} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function WorkerLane({ slot, onCmd }: { slot: SlotStatus; onCmd: (cmd: string, issue?: number, confirm?: boolean) => void }) {
  const [showLog, setShowLog] = useState(true);
  const confirm = useConfirm();
  const ph = slot.phase ? PHASE[slot.phase] : null;
  const waiting = !!slot.awaiting_approval;
  return (
    <article
      className={`glass-card p-3 ${
        waiting ? "glow-warn border-amber-500/40 bg-amber-500/[0.05]" : slot.stale ? "border-amber-500/40 bg-amber-500/[0.04]" : ""
      }`}
    >
      {/* identity: agent · role · team */}
      {(slot.role || slot.agent_name) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <AgentIdentity role={slot.role} agentName={slot.agent_name} teamId={slot.team_id} teamName={slot.team_name} />
          <RiskBadge level={slot.risk_level} />
        </div>
      )}

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
            {waiting && <WaitingBadge />}
            {slot.stale && !waiting && (
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
    <pre ref={boxRef} className="glass-inset mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2.5 font-mono text-[11px] leading-snug text-emerald-300/90">
      {text || "waiting for output…"}
    </pre>
  );
}
