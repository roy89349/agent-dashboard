"use client";
// SVG org-chart edges. One style per connection kind; a transparent wide "hit" path makes thin edges
// tappable; dangling edges (endpoint without a position) are skipped via edgePath() returning "".
import { edgePath, type NodePos } from "@/lib/team-layout";
import type { TeamEdge, EdgeKind } from "@/lib/types";

export const EDGE_STYLE: Record<EdgeKind, { stroke: string; dash: string; label: string; arrow: boolean }> = {
  reports_to: { stroke: "#94a3b8", dash: "", label: "reports to", arrow: true },
  reviews: { stroke: "#fbbf24", dash: "6 5", label: "reviews", arrow: false },
  hands_off_to: { stroke: "#2dd4bf", dash: "", label: "hands off", arrow: true },
  asks: { stroke: "#818cf8", dash: "2 5", label: "asks", arrow: false },
};
const KINDS = Object.keys(EDGE_STYLE) as EdgeKind[];

export function EdgeMarkers() {
  return (
    <defs>
      {KINDS.map((k) => (
        <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_STYLE[k].stroke} />
        </marker>
      ))}
    </defs>
  );
}

export function Edges({
  edges,
  pos,
  selected,
  onSelect,
}: {
  edges: TeamEdge[];
  pos: Map<string, NodePos>;
  selected?: number | null;
  onSelect?: (i: number) => void;
}) {
  return (
    <>
      {edges.map((e, i) => {
        const d = edgePath(pos.get(e.from), pos.get(e.to));
        if (!d) return null; // dangling → skip (no NaN paths)
        const s = EDGE_STYLE[e.kind];
        const isSel = selected === i;
        return (
          <g key={`${e.from}-${e.to}-${e.kind}-${i}`}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(i)} />
            <path
              d={d}
              fill="none"
              stroke={s.stroke}
              strokeWidth={isSel ? 3 : 1.75}
              strokeDasharray={s.dash}
              markerEnd={s.arrow ? `url(#arrow-${e.kind})` : undefined}
              opacity={isSel ? 1 : 0.85}
            />
          </g>
        );
      })}
    </>
  );
}

export function EdgeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
      {KINDS.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <svg width="20" height="8">
            <line x1="0" y1="4" x2="20" y2="4" stroke={EDGE_STYLE[k].stroke} strokeWidth="2" strokeDasharray={EDGE_STYLE[k].dash} />
          </svg>
          {EDGE_STYLE[k].label}
        </span>
      ))}
    </div>
  );
}
