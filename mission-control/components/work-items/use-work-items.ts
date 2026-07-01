"use client";
// Data hook for the work-items view. Loads the list + agents/teams (for name lookups) and exposes the
// mutations, all through the session-gated API routes (server-side validated + audited).
import { useCallback, useEffect, useState } from "react";
import type { WorkItem } from "@/lib/work-items";
import type { AgentMessage, PostAgentMessageInput } from "@/lib/agent-messages";
import type { Agent, Team } from "@/lib/types";

export interface WorkItemDetail {
  workItem: WorkItem;
  children: WorkItem[];
  messages: AgentMessage[];
}

export function useWorkItems() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (query = "") => {
    try {
      const r = await fetch(`/api/work-items${query}`, { cache: "no-store" });
      if (r.ok) setItems(((await r.json()).workItems ?? []) as WorkItem[]);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {}),
      fetch("/api/teams", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTeams(j?.teams ?? [])).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, [load]);

  const agentName = useCallback((id?: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? id : null), [agents]);
  const teamName = useCallback((id?: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? id : null), [teams]);

  const createItem = useCallback(async (body: Partial<WorkItem>): Promise<WorkItem | null> => {
    const r = await fetch("/api/work-items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { await load(); return j.workItem; }
    return null;
  }, [load]);

  const patchItem = useCallback(async (id: string, patch: Partial<WorkItem>): Promise<WorkItem | null> => {
    const r = await fetch(`/api/work-items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { await load(); return j.workItem; }
    return null;
  }, [load]);

  const getDetail = useCallback(async (id: string): Promise<WorkItemDetail | null> => {
    const r = await fetch(`/api/work-items/${id}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as WorkItemDetail) : null;
  }, []);

  const postMessage = useCallback(async (input: Partial<PostAgentMessageInput>): Promise<AgentMessage | null> => {
    const r = await fetch("/api/agent-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j.message : null;
  }, []);

  const resolveMessage = useCallback(async (id: string, resolve: string): Promise<boolean> => {
    const r = await fetch("/api/agent-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, resolve }) });
    return r.ok;
  }, []);

  return { items, agents, teams, loaded, load, agentName, teamName, createItem, patchItem, getDetail, postMessage, resolveMessage };
}
