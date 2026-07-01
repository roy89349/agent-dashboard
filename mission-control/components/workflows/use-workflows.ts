"use client";
// Data hook for the workflows view. Loads workflows + templates + agents/teams (name lookups) and exposes
// the state-machine ops through the session-gated, server-validated API routes.
import { useCallback, useEffect, useState } from "react";
import type { Workflow, WorkflowTemplate, WorkflowDetail } from "@/lib/workflows";
import type { Agent, Team } from "@/lib/types";

type Body = Record<string, unknown>;

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/workflows", { cache: "no-store" }); if (r.ok) setWorkflows(((await r.json()).workflows ?? []) as Workflow[]); } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/workflow-templates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTemplates(j?.templates ?? [])).catch(() => {}),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {}),
      fetch("/api/teams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTeams(j?.teams ?? [])).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, [load]);

  const agentName = useCallback((id?: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? id : null), [agents]);
  const teamName = useCallback((id?: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? id : null), [teams]);

  const create = useCallback(async (body: Body): Promise<WorkflowDetail | null> => {
    const r = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { await load(); return j as WorkflowDetail; }
    return null;
  }, [load]);

  const getDetail = useCallback(async (id: string): Promise<WorkflowDetail | null> => {
    const r = await fetch(`/api/workflows/${id}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as WorkflowDetail) : null;
  }, []);

  // one entry point for every state-machine op (advance | complete | fail | block | skip | request_approval)
  const op = useCallback(async (id: string, body: Body): Promise<boolean> => {
    const r = await fetch(`/api/workflows/${id}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await load();
    return r.ok;
  }, [load]);

  const patch = useCallback(async (id: string, body: Body): Promise<boolean> => {
    const r = await fetch(`/api/workflows/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await load();
    return r.ok;
  }, [load]);

  return { workflows, templates, agents, teams, loaded, load, agentName, teamName, create, getDetail, op, patch };
}
