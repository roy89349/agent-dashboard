"use client";
// Hand-built plain-SVG org-chart (no graph lib). An <svg> edge layer sits under absolutely-positioned
// AgentCard divs, both inside ONE pan/zoom transform. Background-drag pans; wheel zooms; a card drags to
// reposition (persisted to team.layout); connect-mode wires two nodes. Desktop only — phones get OrgTree.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, RotateCcw, LayoutGrid, Link2 } from "lucide-react";
import { computeLayout, layoutBounds, NODE_W, type NodePos } from "@/lib/team-layout";
import { AgentCard } from "./agent-card";
import { Edges, EdgeMarkers, EdgeLegend } from "./edges";
import type { Team, Agent } from "@/lib/types";

interface Props {
  team: Team;
  agentById: (id: string) => Agent | null;
  selectedAgent: string | null;
  onSelectAgent: (id: string) => void;
  selectedEdge: number | null;
  onSelectEdge: (i: number) => void;
  connectMode: boolean;
  onToggleConnect: () => void;
  onConnect: (from: string, to: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onAutoLayout: () => void;
}

export function OrgCanvas(p: Props) {
  const pos = useMemo(() => computeLayout(p.team), [p.team]);
  const bounds = useMemo(() => layoutBounds(pos), [pos]);
  const [t, setT] = useState({ x: 24, y: 24, k: 1 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { mode: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }>(null);

  // exiting connect mode must clear a half-picked source (and its lingering ring)
  useEffect(() => { if (!p.connectMode) setConnectFrom(null); }, [p.connectMode]);

  const posOf = useCallback((id: string): NodePos | undefined => (live && live.id === id ? { ...pos.get(id)!, x: live.x, y: live.y } : pos.get(id)), [pos, live]);
  const livePos = useMemo(() => {
    if (!live) return pos;
    const m = new Map(pos);
    const cur = m.get(live.id);
    if (cur) m.set(live.id, { ...cur, x: live.x, y: live.y });
    return m;
  }, [pos, live]);

  function onCardDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const cur = pos.get(id);
    drag.current = { mode: "node", id, sx: e.clientX, sy: e.clientY, ox: cur?.x ?? 0, oy: cur?.y ?? 0, moved: false };
  }
  function onBgDown(e: React.MouseEvent) {
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
  }
  function onMove(e: React.MouseEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (d.mode === "pan") setT((s) => ({ ...s, x: d.ox + dx, y: d.oy + dy }));
    else if (d.id) setLive({ id: d.id, x: d.ox + dx / t.k, y: d.oy + dy / t.k });
  }
  function onUp(e: React.MouseEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "node" && d.id) {
      if (d.moved && live) p.onMoveNode(d.id, live.x, live.y);
      else handleCardClick(d.id); // a click, not a drag
      setLive(null);
    }
    void e;
  }
  function handleCardClick(id: string) {
    if (p.connectMode) {
      if (!connectFrom) setConnectFrom(id);
      else { if (connectFrom !== id) p.onConnect(connectFrom, id); setConnectFrom(null); }
    } else {
      p.onSelectAgent(id);
    }
  }
  function onWheel(e: React.WheelEvent) {
    const k = Math.min(1.6, Math.max(0.3, t.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setT((s) => ({ ...s, k }));
  }
  function fit() {
    const el = wrapRef.current;
    if (!el) return;
    const k = Math.min(1.4, (el.clientWidth - 48) / bounds.w, (el.clientHeight - 48) / bounds.h);
    setT({ x: 24, y: 24, k: Math.max(0.15, k) }); // Fit may go below the wheel floor for very wide charts
  }
  function reset() { setT({ x: 24, y: 24, k: 1 }); }

  return (
    <div className="glass-inset relative h-full overflow-hidden">
      {/* toolbar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <button onClick={p.onToggleConnect} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur-md transition-colors ${p.connectMode ? "glow-ok border-emerald-400/50 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-black/30 text-white/60 hover:bg-white/10 hover:text-white"}`}>
          <Link2 className="size-3.5" /> {p.connectMode ? (connectFrom ? "pick target…" : "pick source…") : "Connect"}
        </button>
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <CanvasBtn onClick={fit} title="Fit"><Maximize2 className="size-3.5" /></CanvasBtn>
        <CanvasBtn onClick={reset} title="Reset zoom"><RotateCcw className="size-3.5" /></CanvasBtn>
        <CanvasBtn onClick={p.onAutoLayout} title="Auto-layout"><LayoutGrid className="size-3.5" /></CanvasBtn>
      </div>
      <div className="glass-card absolute bottom-3 left-3 z-10 bg-black/40 px-2.5 py-1.5">
        <EdgeLegend />
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        onMouseDown={onBgDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.mode === "node" && d.id && d.moved && live) p.onMoveNode(d.id, live.x, live.y); // commit, don't lose the move
          setLive(null);
        }}
        onWheel={onWheel}
        className="h-full w-full cursor-grab bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing"
      >
        <div style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, transformOrigin: "0 0" }} className="relative">
          <svg width={bounds.w} height={bounds.h} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            <EdgeMarkers />
            <g className="pointer-events-auto">
              <Edges edges={p.team.edges} pos={livePos} selected={p.selectedEdge} onSelect={p.onSelectEdge} />
            </g>
          </svg>
          {p.team.members.map((id) => {
            const pp = posOf(id);
            if (!pp) return null;
            return (
              <div key={id} style={{ position: "absolute", left: pp.x, top: pp.y, width: NODE_W }} onMouseDown={(e) => onCardDown(e, id)}>
                <AgentCard
                  agent={p.agentById(id)}
                  ghostId={id}
                  isLead={p.team.lead === id}
                  selected={p.selectedAgent === id || connectFrom === id}
                  onClick={() => {}}
                />
              </div>
            );
          })}
          {p.team.members.length === 0 && (
            <div className="absolute left-0 top-0 w-72 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-center text-sm text-white/40 backdrop-blur-sm">
              Empty team — add agents or build a recommended team.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="grid size-8 place-items-center rounded-lg border border-white/10 bg-black/30 text-white/60 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}
