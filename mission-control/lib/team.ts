// PURE role → team derivation + display helpers (avatar initials, chip tones). No server imports, so it
// is shared by readStatus/getBoard (server) AND the board/worker UI (client), and unit-testable.
// Teams are a presentation grouping over the config-driven roles — the registry needs no `team` field.

export interface Team {
  id: string;
  name: string;
}

const BUILD: Team = { id: "build", name: "Build" };
const PLATFORM: Team = { id: "platform", name: "Platform" };
const COMMAND: Team = { id: "command", name: "Command" };

const ROLE_TEAM: Record<string, Team> = {
  frontend: BUILD, backend: BUILD, qa: BUILD, designer: BUILD, architect: BUILD, data: BUILD,
  security: PLATFORM, devops: PLATFORM,
  manager: COMMAND, kpi: COMMAND, communication: COMMAND, documentation: COMMAND,
};

export const TEAMS: Team[] = [BUILD, PLATFORM, COMMAND];

/** The team a role belongs to, or null for an unknown/empty role (caller renders nothing). */
export function teamForRole(role?: string | null): Team | null {
  if (!role) return null;
  return ROLE_TEAM[role.toLowerCase()] ?? null;
}

export type RoleTone = "emerald" | "red" | "amber" | "indigo" | "slate" | "teal" | "rose";

const ROLE_TONE: Record<string, RoleTone> = {
  frontend: "indigo", backend: "teal", qa: "emerald", security: "rose", devops: "amber",
  manager: "slate", designer: "indigo", architect: "teal", data: "emerald",
  documentation: "slate", kpi: "amber", communication: "rose",
};
const PALETTE: RoleTone[] = ["indigo", "teal", "emerald", "amber", "rose", "slate"];

/** Stable colour for a role chip/avatar — known roles fixed, unknown roles hashed (consistent). */
export function roleTone(role?: string | null): RoleTone {
  if (!role) return "slate";
  const k = role.toLowerCase();
  if (ROLE_TONE[k]) return ROLE_TONE[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function teamTone(teamId?: string | null): RoleTone {
  return teamId === "build" ? "indigo" : teamId === "platform" ? "rose" : teamId === "command" ? "amber" : "slate";
}

/** Up to two initials from an agent/role name (e.g. "Frontend-agent" → "FA", "qa" → "QA"). */
export function initials(name?: string | null, fallback = "·"): string {
  const s = (name ?? "").trim();
  if (!s) return fallback;
  const parts = s.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
