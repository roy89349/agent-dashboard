// PURE normalize + filter + group helpers for the "who-does-what" board/worker views. Turns a slot or
// a board card into a common AgentMeta, then filters/facets/groups on role · agent · team · status.
// No server imports → unit-testable and client-safe. Everything tolerates missing metadata (old data).
import type { SlotStatus, BoardCard } from "./types";

export interface AgentMeta {
  role: string | null;
  agentId: string | null;
  agentName: string | null;
  teamId: string | null;
  teamName: string | null;
  status: string; // for the status facet + grouping
  risk: string | null;
}

/** Live worker → meta. status: waiting (approval) > stalled > current phase > "active". */
export function slotMeta(s: SlotStatus): AgentMeta {
  const status = s.awaiting_approval ? "waiting" : s.stale ? "stalled" : s.phase ?? "active";
  return {
    role: s.role ?? null,
    agentId: s.agent_id ?? null,
    agentName: s.agent_name ?? null,
    teamId: s.team_id ?? null,
    teamName: s.team_name ?? null,
    status,
    risk: s.risk_level ?? null,
  };
}

/** Board card → meta. status: waiting (approval) > live state > column. */
export function cardMeta(c: BoardCard): AgentMeta {
  return {
    role: c.role ?? null,
    agentId: c.agentId ?? null,
    agentName: c.agentName ?? null,
    teamId: c.teamId ?? null,
    teamName: c.teamName ?? null,
    status: c.awaitingApproval ? "waiting" : c.state ?? c.column,
    risk: c.riskLevel ?? null,
  };
}

export interface FilterState {
  role?: string | null;
  agentId?: string | null;
  teamId?: string | null;
  status?: string | null;
}

export function isFiltered(f: FilterState): boolean {
  return !!(f.role || f.agentId || f.teamId || f.status);
}

/** A meta passes when it matches every SET dimension (empty dimensions are ignored). */
export function matches(m: AgentMeta, f: FilterState): boolean {
  if (f.role && m.role !== f.role) return false;
  if (f.agentId && m.agentId !== f.agentId) return false;
  if (f.teamId && m.teamId !== f.teamId) return false;
  if (f.status && m.status !== f.status) return false;
  return true;
}

export interface Facets {
  roles: string[];
  agents: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  statuses: string[];
}

/** Distinct values present in the data — drives the filter dropdowns (only show what exists). */
export function facets(metas: AgentMeta[]): Facets {
  const roles = new Set<string>();
  const agents = new Map<string, string>();
  const teams = new Map<string, string>();
  const statuses = new Set<string>();
  for (const m of metas) {
    if (m.role) roles.add(m.role);
    if (m.agentId) agents.set(m.agentId, m.agentName ?? m.agentId);
    if (m.teamId) teams.set(m.teamId, m.teamName ?? m.teamId);
    if (m.status) statuses.add(m.status);
  }
  return {
    roles: [...roles].sort(),
    agents: [...agents].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    teams: [...teams].map(([id, name]) => ({ id, name })),
    statuses: [...statuses].sort(),
  };
}

export type GroupDim = "role" | "team" | "status";

/** The group a meta belongs to for a given dimension (unassigned items land in "_none"). */
export function groupKey(m: AgentMeta, dim: GroupDim): { key: string; label: string } {
  if (dim === "role") return { key: m.role ?? "_none", label: m.role ?? "Unassigned" };
  if (dim === "team") return { key: m.teamId ?? "_none", label: m.teamName ?? "Unassigned" };
  return { key: m.status ?? "_none", label: m.status ?? "—" };
}
