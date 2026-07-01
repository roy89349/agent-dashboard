"use client";
// Data hook for the Manager view. Loads decomposition plans + workflow templates + agents + the limits, and
// exposes propose / detail / decide (approve|reject via the durable-approval decide route) / save-config.
import { useCallback, useEffect, useState } from "react";
import type { ManagerPlan, ManagerConfig } from "@/lib/manager";
import type { WorkItem } from "@/lib/work-items";
import type { WorkflowTemplate } from "@/lib/workflows";
import type { Agent } from "@/lib/types";

export interface ManagerDetail { managerPlan: ManagerPlan; workItem: WorkItem | null; children: WorkItem[] }
type Body = Record<string, unknown>;

export function useManager() {
  const [plans, setPlans] = useState<ManagerPlan[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [config, setConfig] = useState<ManagerConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/manager/plans", { cache: "no-store" }); if (r.ok) setPlans(((await r.json()).plans ?? []) as ManagerPlan[]); } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/workflow-templates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTemplates(j?.templates ?? [])).catch(() => {}),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {}),
      fetch("/api/manager/config", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setConfig(j?.config ?? null)).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, [load]);

  const agentName = useCallback((id?: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? id : null), [agents]);
  const roles = Array.from(new Set(agents.map((a) => a.role).filter(Boolean)));

  const propose = useCallback(async (body: Body): Promise<{ managerPlan?: ManagerPlan; error?: string }> => {
    const r = await fetch("/api/manager/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { await load(); return { managerPlan: j.managerPlan }; }
    return { error: j?.error ?? "could not propose" };
  }, [load]);

  const getDetail = useCallback(async (id: string): Promise<ManagerDetail | null> => {
    const r = await fetch(`/api/manager/plans/${id}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as ManagerDetail) : null;
  }, []);

  const decide = useCallback(async (approvalId: string, action: "approve" | "reject", reason?: string): Promise<boolean> => {
    const r = await fetch("/api/approvals/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: approvalId, action, reason }) });
    if (r.ok) await load();
    return r.ok;
  }, [load]);

  const saveConfig = useCallback(async (patch: Partial<ManagerConfig>): Promise<void> => {
    const r = await fetch("/api/manager/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) setConfig((await r.json()).config);
  }, []);

  return { plans, templates, agents, roles, config, loaded, load, agentName, propose, getDetail, decide, saveConfig };
}
