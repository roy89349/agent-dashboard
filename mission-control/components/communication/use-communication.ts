"use client";
// Data hook for the Updates page. Loads the summaries feed + per-team communicators + agents, and exposes
// generate / ask / escalate / set-communicator — all through the session-gated communication API.
import { useCallback, useEffect, useState } from "react";
import type { Summary, CommunicatorRow, AskResult, SummaryType } from "@/lib/communication";
import type { Agent } from "@/lib/types";

type Body = Record<string, unknown>;

export function useCommunication() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [communicators, setCommunicators] = useState<CommunicatorRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/communication/summaries", { cache: "no-store" }); if (r.ok) setSummaries(((await r.json()).summaries ?? []) as Summary[]); } catch { /* offline */ }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/communication/communicators", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setCommunicators(j?.communicators ?? [])).catch(() => {}),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setAgents(j?.agents ?? [])).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, [load]);

  const generate = useCallback(async (type: SummaryType, notify = false): Promise<Summary | null> => {
    const r = await fetch("/api/communication/summaries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, notify }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { await load(); return j.summary; }
    return null;
  }, [load]);

  const ask = useCallback(async (question: string): Promise<AskResult | null> => {
    const r = await fetch("/api/communication/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
    return r.ok ? ((await r.json()) as AskResult) : null;
  }, []);

  const escalate = useCallback(async (body: Body): Promise<boolean> => {
    const r = await fetch("/api/communication/escalate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) await load();
    return r.ok;
  }, [load]);

  const setCommunicator = useCallback(async (team_id: string, agent_id: string | null): Promise<void> => {
    const r = await fetch("/api/communication/communicators", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team_id, agent_id }) });
    if (r.ok) setCommunicators((await r.json()).communicators ?? []);
  }, []);

  return { summaries, communicators, agents, loaded, load, generate, ask, escalate, setCommunicator };
}
