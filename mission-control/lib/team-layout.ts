// PURE deterministic org-chart layout for the Team Composer canvas (no DOM, no server imports → shared
// by canvas + mobile tree + tests). Layered top-down by reports_to (lead/roots on top), cycle-safe,
// ALL members positioned (including ghosts whose agent was deleted), persisted drag coords override the
// auto layout, and edgePath() returns "" for any NaN so the SVG renderer can skip dangling edges.
import type { Team } from "./types";

export const NODE_W = 232;
export const NODE_H = 128;
const GAP_X = 40;
const GAP_Y = 76;

export interface NodePos {
  x: number;
  y: number;
  depth: number;
}

/** Map every member id → {x, y, depth}. reports_to points child→parent; we BFS down from the roots. */
export function computeLayout(team: Team): Map<string, NodePos> {
  const members = team.members;
  const memberSet = new Set(members);
  const reportsTo = team.edges.filter((e) => e.kind === "reports_to" && memberSet.has(e.from) && memberSet.has(e.to));

  const parentsOf = new Map<string, string[]>(); // child → parents
  const childrenOf = new Map<string, string[]>(); // parent → children
  for (const e of reportsTo) {
    if (!parentsOf.has(e.from)) parentsOf.set(e.from, []);
    parentsOf.get(e.from)!.push(e.to);
    if (!childrenOf.has(e.to)) childrenOf.set(e.to, []);
    childrenOf.get(e.to)!.push(e.from);
  }

  // roots = members with no parent (the lead naturally lands here)
  const roots = members.filter((m) => !(parentsOf.get(m)?.length));
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r, 0);
    queue.push(r);
  }
  // BFS; only enqueue a child on FIRST visit → cycle-safe (no infinite loop), later paths just lower depth
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    const d = depth.get(n)!;
    for (const c of childrenOf.get(n) ?? []) {
      if (depth.get(c) === undefined) {
        depth.set(c, d + 1);
        queue.push(c);
      } else {
        depth.set(c, Math.min(depth.get(c)!, d + 1));
      }
    }
  }
  // orphans / pure cycles never reached from a root → drop to a bottom tier
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const m of members) if (depth.get(m) === undefined) depth.set(m, maxDepth + 1);

  // group by tier, lay out left→right
  const tiers = new Map<number, string[]>();
  for (const m of members) {
    const d = depth.get(m)!;
    if (!tiers.has(d)) tiers.set(d, []);
    tiers.get(d)!.push(m);
  }
  const pos = new Map<string, NodePos>();
  for (const [d, ids] of tiers) {
    ids.forEach((id, i) => pos.set(id, { x: i * (NODE_W + GAP_X), y: d * (NODE_H + GAP_Y), depth: d }));
  }
  // persisted drag positions win
  for (const m of members) {
    const o = team.layout[m];
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      pos.set(m, { x: o.x, y: o.y, depth: depth.get(m) ?? 0 });
    }
  }
  return pos;
}

/** Bounding box of the laid-out nodes (for Fit / canvas sizing). */
export function layoutBounds(pos: Map<string, NodePos>): { w: number; h: number } {
  let w = 0, h = 0;
  for (const p of pos.values()) {
    w = Math.max(w, p.x + NODE_W);
    h = Math.max(h, p.y + NODE_H);
  }
  return { w: Math.max(w, NODE_W), h: Math.max(h, NODE_H) };
}

/** Cubic-bezier path between two node top-left coords. Returns "" if any coord is NaN (dangling edge). */
export function edgePath(a: NodePos | undefined, b: NodePos | undefined): string {
  if (!a || !b) return "";
  const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
  const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
  if (![ax, ay, bx, by].every(Number.isFinite)) return "";
  const dy = by - ay;
  return `M ${ax} ${ay} C ${ax} ${ay + dy * 0.4}, ${bx} ${by - dy * 0.4}, ${bx} ${by}`;
}
