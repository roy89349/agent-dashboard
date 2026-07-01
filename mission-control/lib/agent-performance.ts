// Agent performance service: per-agent success/failure, recent tasks, avg duration, common blockers, best
// collaborators, granted skills, feedback (if any) + a leaderboard. All DERIVED from the existing tables
// (work_items, agent_messages, agents/teams/skills). Bounded; every rate is labelled. No shell-out.
import { readAgents } from "./agents.ts";
import { readTeams } from "./teams.ts";
import { skillById } from "./skills.ts";
import { gatherAnalytics } from "./kpis.ts";
import { type Metric, metric, hoursBetween, avg, pct } from "./analytics-shared.ts";

const safe = <T>(fn: () => T, dflt: T): T => { try { return fn(); } catch { return dflt; } };

export interface AgentPerf {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  tasks_total: number;
  tasks_done: number;
  tasks_failed: number;
  success_rate: Metric;
  failure_rate: Metric;
  avg_duration: Metric;
  last_10: { title: string; state: string; updated_at: string; work_item_id: string }[];
  common_blockers: { text: string; count: number }[];
  best_collaborators: { agent_id: string; name: string; count: number }[];
  top_skills: { name: string; category: string }[];
  feedback_score: number | null;
}
export interface PerformanceReport { agents: AgentPerf[]; generated_at: string }

function teamByAgentMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of safe(() => readTeams().teams.filter((x) => x.enabled && !x.is_template), [] as ReturnType<typeof readTeams>["teams"]))
    for (const m of t.members) if (!out.has(m)) out.set(m, t.name);
  return out;
}

export function buildAgentPerformance(agentId?: string | null): PerformanceReport {
  const agents = safe(() => readAgents().agents, [] as ReturnType<typeof readAgents>["agents"]);
  const nameOf = new Map(agents.map((a) => [a.id, a.name] as const));
  const teamByAgent = teamByAgentMap();
  const d = gatherAnalytics();
  const roster = agentId ? agents.filter((a) => a.id === agentId) : agents;

  const perf: AgentPerf[] = roster.map((a) => {
    const mine = d.workItems.filter((w) => w.assigned_agent_id === a.id).sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1));
    const done = mine.filter((w) => w.state === "done");
    const failed = mine.filter((w) => w.state === "failed");
    const finished = done.length + failed.length;

    // common blockers: this agent's blocker messages (redacted at write) grouped by note
    const blockers = new Map<string, number>();
    for (const m of d.messages.filter((mm) => mm.type === "blocker" && mm.from_agent_id === a.id)) {
      const t = String(m.payload?.note ?? "blocked").slice(0, 80);
      blockers.set(t, (blockers.get(t) ?? 0) + 1);
    }
    // best collaborators: agents this one exchanges the most messages with (either direction)
    const collab = new Map<string, number>();
    for (const m of d.messages) {
      let other: string | null = null;
      if (m.from_agent_id === a.id && m.to_agent_id && m.to_agent_id !== a.id) other = m.to_agent_id;
      else if (m.to_agent_id === a.id && m.from_agent_id && m.from_agent_id !== a.id) other = m.from_agent_id;
      if (other && nameOf.has(other)) collab.set(other, (collab.get(other) ?? 0) + 1);
    }
    const topSkills = (a.skill_ids ?? []).map((id) => safe(() => skillById(id), null)).filter(Boolean).slice(0, 6)
      .map((s) => ({ name: s!.name, category: s!.category }));

    return {
      id: a.id, name: a.name, role: a.role ?? null, team: teamByAgent.get(a.id) ?? null,
      tasks_total: mine.length, tasks_done: done.length, tasks_failed: failed.length,
      success_rate: metric("success_rate", "Success rate", pct(done.length, finished), "derived", { unit: "%", note: `${done.length}/${finished} finished` }),
      failure_rate: metric("failure_rate", "Failure rate", pct(failed.length, finished), "derived", { unit: "%" }),
      avg_duration: metric("avg_duration", "Avg duration", avg(done.map((w) => hoursBetween(w.created_at, w.updated_at))), "derived", { unit: "h", note: "created → done" }),
      last_10: mine.slice(0, 10).map((w) => ({ title: w.title, state: w.state, updated_at: w.updated_at, work_item_id: w.id })),
      common_blockers: Array.from(blockers.entries()).map(([text, count]) => ({ text, count })).sort((x, y) => y.count - x.count).slice(0, 5),
      best_collaborators: Array.from(collab.entries()).map(([id, count]) => ({ agent_id: id, name: nameOf.get(id) ?? id, count })).sort((x, y) => y.count - x.count).slice(0, 3),
      top_skills: topSkills,
      feedback_score: null, // no feedback signal is tracked yet
    };
  });

  // leaderboard order: most finished work first, then success rate
  perf.sort((a, b) => (b.tasks_done - a.tasks_done) || (Number(b.success_rate.value) - Number(a.success_rate.value)));
  return { agents: perf, generated_at: new Date().toISOString() };
}
