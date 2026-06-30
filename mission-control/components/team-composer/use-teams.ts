"use client";
// Data backbone for the Team Composer. Loads teams + agents + config and exposes SERIALIZED CAS writes:
// each resource (teams / agents) has its own promise-chain so only one POST is ever in flight and every
// queued patch is re-based on the rev returned by the previous one — no self-inflicted 409 storms. 409
// reloads the stale resource; 412 (fleet-affecting agent change) surfaces needsConfirm to the caller.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Team, TeamInput, Agent, AgentInput } from "@/lib/types";

export type SaveResult = { ok: boolean; rev?: number; conflict?: boolean; needsConfirm?: boolean; error?: string };

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teamsRev, setTeamsRev] = useState(0);
  const [agentsRev, setAgentsRev] = useState(0);
  const [allowAutoMerge, setAllowAutoMerge] = useState(false);
  const [allowGlobalOpus, setAllowGlobalOpus] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const tRev = useRef(0);
  const aRev = useRef(0);
  const tChain = useRef<Promise<unknown>>(Promise.resolve());
  const aChain = useRef<Promise<unknown>>(Promise.resolve());

  const loadTeams = useCallback(async () => {
    try {
      const r = await fetch("/api/teams", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setTeams(j.teams ?? []); tRev.current = j.rev ?? 0; setTeamsRev(j.rev ?? 0); }
    } catch { /* offline */ }
  }, []);
  const loadAgents = useCallback(async () => {
    try {
      const r = await fetch("/api/agents", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setAgents(j.agents ?? []); aRev.current = j.rev ?? 0; setAgentsRev(j.rev ?? 0); }
    } catch { /* offline */ }
  }, []);
  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setAllowAutoMerge(!!j.allowAutoMerge); setAllowGlobalOpus(!!j.allowGlobalOpus); }
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([loadTeams(), loadAgents(), loadConfig()]).finally(() => setLoaded(true));
  }, [loadTeams, loadAgents, loadConfig]);

  const saveTeam = useCallback(
    (patch: { upsert?: TeamInput; remove?: string; teams?: TeamInput[] }, confirm?: boolean): Promise<SaveResult> => {
      const run = tChain.current.then(async (): Promise<SaveResult> => {
        try {
          const res = await fetch("/api/teams", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ patch, baseRev: tRev.current, confirm }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok) { tRev.current = j.rev; setTeamsRev(j.rev); await loadTeams(); return { ok: true, rev: j.rev }; }
          if (res.status === 409) { await loadTeams(); return { ok: false, conflict: true, error: "Teams changed elsewhere — reloaded." }; }
          return { ok: false, error: j.error ?? `Failed (${res.status})` };
        } catch {
          return { ok: false, error: "Network error" };
        }
      });
      tChain.current = run.catch(() => {});
      return run;
    },
    [loadTeams],
  );

  const saveAgent = useCallback(
    (patch: { upsert?: AgentInput; remove?: string }, confirm?: boolean): Promise<SaveResult> => {
      const run = aChain.current.then(async (): Promise<SaveResult> => {
        try {
          const res = await fetch("/api/agents", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ patch, baseRev: aRev.current, confirm }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok) { aRev.current = j.rev; setAgentsRev(j.rev); await loadAgents(); return { ok: true, rev: j.rev }; }
          if (res.status === 409) { await loadAgents(); return { ok: false, conflict: true, error: "Agents changed elsewhere — reloaded." }; }
          if (res.status === 412 && j.needsConfirm) return { ok: false, needsConfirm: true, error: j.error };
          return { ok: false, error: j.error ?? `Failed (${res.status})` };
        } catch {
          return { ok: false, error: "Network error" };
        }
      });
      aChain.current = run.catch(() => {});
      return run;
    },
    [loadAgents],
  );

  return {
    teams, agents, teamsRev, agentsRev, allowAutoMerge, allowGlobalOpus, loaded,
    loadTeams, loadAgents, saveTeam, saveAgent,
    agentById: useCallback((id: string) => agents.find((a) => a.id === id) ?? null, [agents]),
  };
}
