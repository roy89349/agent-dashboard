"use client";
// Data backbone for the Skill Library. Loads skills + agents + config and exposes SERIALIZED CAS writes
// (one in-flight POST per resource, re-based on the latest rev) so there are no self-inflicted 409 storms.
// saveAgent is here too — linking a skill to an agent writes Agent.skill_ids via POST /api/agents.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Skill, SkillInput, Agent, AgentInput } from "@/lib/types";

export type SaveResult = { ok: boolean; rev?: number; conflict?: boolean; needsConfirm?: boolean; error?: string };

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skillsRev, setSkillsRev] = useState(0);
  const [agentsRev, setAgentsRev] = useState(0);
  const [allowAutoMerge, setAllowAutoMerge] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sRev = useRef(0);
  const aRev = useRef(0);
  const sChain = useRef<Promise<unknown>>(Promise.resolve());
  const aChain = useRef<Promise<unknown>>(Promise.resolve());

  const loadSkills = useCallback(async () => {
    try {
      const r = await fetch("/api/skills", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setSkills(j.skills ?? []); sRev.current = j.rev ?? 0; setSkillsRev(j.rev ?? 0); }
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
      if (r.ok) { const j = await r.json(); setAllowAutoMerge(!!j.allowAutoMerge); }
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([loadSkills(), loadAgents(), loadConfig()]).finally(() => setLoaded(true));
  }, [loadSkills, loadAgents, loadConfig]);

  const saveSkill = useCallback(
    (patch: { upsert?: SkillInput; remove?: string }, confirm?: boolean): Promise<SaveResult> => {
      const run = sChain.current.then(async (): Promise<SaveResult> => {
        try {
          const res = await fetch("/api/skills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch, baseRev: sRev.current, confirm }) });
          const j = await res.json().catch(() => ({}));
          if (res.ok) { sRev.current = j.rev; setSkillsRev(j.rev); await loadSkills(); return { ok: true, rev: j.rev }; }
          if (res.status === 409) { await loadSkills(); return { ok: false, conflict: true, error: "Skills changed elsewhere — reloaded." }; }
          return { ok: false, error: j.error ?? `Failed (${res.status})` };
        } catch { return { ok: false, error: "Network error" }; }
      });
      sChain.current = run.catch(() => {});
      return run;
    },
    [loadSkills],
  );

  const saveAgent = useCallback(
    (patch: { upsert?: AgentInput; remove?: string }, confirm?: boolean): Promise<SaveResult> => {
      const run = aChain.current.then(async (): Promise<SaveResult> => {
        try {
          const res = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch, baseRev: aRev.current, confirm }) });
          const j = await res.json().catch(() => ({}));
          if (res.ok) { aRev.current = j.rev; setAgentsRev(j.rev); await loadAgents(); return { ok: true, rev: j.rev }; }
          if (res.status === 409) { await loadAgents(); return { ok: false, conflict: true, error: "Agents changed elsewhere — reloaded." }; }
          if (res.status === 412 && j.needsConfirm) return { ok: false, needsConfirm: true, error: j.error };
          return { ok: false, error: j.error ?? `Failed (${res.status})` };
        } catch { return { ok: false, error: "Network error" }; }
      });
      aChain.current = run.catch(() => {});
      return run;
    },
    [loadAgents],
  );

  return { skills, agents, skillsRev, agentsRev, allowAutoMerge, loaded, loadSkills, loadAgents, saveSkill, saveAgent };
}
