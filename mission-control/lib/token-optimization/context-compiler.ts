// Context Compiler — builds a MINIMAL BUT SUFFICIENT context bundle per agent run. Selects only
// relevant sources, compresses the noisy ones, dedupes overlap, sorts by relevance, and fits a hard
// token budget. Every candidate block is reported (included OR explicitly excluded with a reason)
// so the Context Inspector can show exactly what an agent would receive and why.
// Redaction-first; high-risk work keeps security-relevant blocks (never compressed away).
import { getWorkItem } from "../work-items.ts";
import { getWorkflow } from "../workflows.ts";
import { listApprovalsRO } from "../approvals.ts";
import { searchKnowledge } from "../knowledge-index.ts";
import { memoryForAgent } from "../agent-memory.ts";
import { redact } from "../redact.ts";
import { compressLog, compressDiff, compressWorkflowState, compressKnowledge, storeSummary } from "./compressor.ts";
import { cached, sourceHash } from "./context-cache.ts";
import { checkRunBudget } from "./budget-manager.ts";
import { estimateTokens, type ContextBlock, type ContextBlockKind, type ContextPackage, type OptimizationMode } from "./types.ts";

const safe = <T>(fn: () => T, dflt: T): T => {
  try {
    return fn();
  } catch {
    return dflt;
  }
};

export interface CompileInput {
  goal: string;
  agent_id?: string | null;
  role?: string | null;
  team_id?: string | null;
  work_item_id?: string | null;
  workflow_id?: string | null;
  issue?: number | null;
  risk?: "low" | "medium" | "high" | "critical";
  system_instructions?: string;
  constraints?: string[];
  // caller-supplied raw material (the compiler never shells out / reads the repo itself)
  raw_log_tail?: string | null;
  raw_diff?: string | null;
  relevant_files?: { path: string; content: string }[];
  mode_override?: OptimizationMode; // testing / explicit calls
  retry_count?: number;
}

const block = (kind: ContextBlockKind, title: string, content: string, relevance: number, reason: string, extra?: Partial<ContextBlock>): ContextBlock => ({
  kind,
  title,
  content,
  tokens: estimateTokens(content),
  relevance,
  included: false,
  reason,
  compressed: false,
  cache_hit: false,
  ...extra,
});

/** Assemble + budget-fit the context package. Pure data in/out apart from SQLite reads + cache/summary writes. */
export function compileContext(input: CompileInput): ContextPackage {
  const risk = input.risk ?? "low";
  const highRisk = risk === "high" || risk === "critical";
  const candidates: ContextBlock[] = [];
  let needsRaw = false; // set when any important compression falls below the confidence floor

  // 1. task brief (always in, never compressed)
  const wi = input.work_item_id ? safe(() => getWorkItem(input.work_item_id!), null) : null;
  const briefBits = [
    `Goal: ${input.goal}`,
    wi && `Task: ${wi.title} [state=${wi.state}, priority=${wi.priority}, risk=${wi.risk_level ?? "?"}, mode=${wi.mode}]`,
    input.issue != null && `GitHub issue: #${input.issue}`,
    input.role && `Your role: ${input.role}`,
  ].filter(Boolean) as string[];
  const taskBrief = redact(briefBits.join("\n"));

  // 2. workflow state (compressed, lossless-ish)
  if (input.workflow_id) {
    const wf = safe(() => getWorkflow(input.workflow_id!), null);
    if (wf) {
      const stateRaw = [
        `Workflow: ${wf.workflow.title} [${wf.workflow.status}]`,
        ...wf.steps.map((s) => {
          const out = typeof s.output === "string" ? s.output : s.output ? JSON.stringify(s.output) : "";
          return `- step ${s.step_order + 1} ${s.name} (${s.assigned_role ?? "unassigned"}): ${s.status}${out ? ` — ${out.slice(0, 160)}` : ""}`;
        }),
      ].join("\n");
      const c = compressWorkflowState(stateRaw);
      candidates.push(block("workflow_state", "Workflow state", c.summary, 0.9, "current pipeline position + step outcomes", { compressed: c.compression_ratio < 1 }));
    }
  }

  // 3. previous decisions relevant to this work item / agent (summaries only, newest first)
  const decisions = safe(() => listApprovalsRO(60), []).filter(
    (a) => (input.work_item_id && a.work_item_id === input.work_item_id) || (input.issue != null && a.issue === input.issue),
  );
  if (decisions.length) {
    const txt = decisions
      .slice(0, 6)
      .map((a) => `- [${a.status}] ${a.kind}: ${a.summary.slice(0, 140)}`)
      .join("\n");
    candidates.push(block("previous_decisions", "Previous decisions", redact(txt), 0.85, `${decisions.length} decisions linked to this task`));
  }

  // 4. agent memory (rules/warnings first — they steer behaviour)
  if (input.agent_id) {
    const mem = safe(() => memoryForAgent(input.agent_id!, input.team_id ?? null), []);
    const important = mem.filter((m) => m.type === "rule" || m.type === "warning").slice(0, 8);
    const rest = mem.filter((m) => m.type !== "rule" && m.type !== "warning").slice(0, 4);
    if (important.length || rest.length) {
      const txt = [...important, ...rest].map((m) => `- (${m.type}) ${(m.content ?? m.title).slice(0, 160)}`).join("\n");
      candidates.push(block("agent_memory", "Agent memory", redact(txt), 0.8, "rules/warnings + top preferences for this agent"));
    }
  }

  // 5. knowledge snippets (access-scoped search on the goal; compressed + cached per item)
  const hits = safe(() => searchKnowledge(input.goal, { agent_id: input.agent_id ?? null, role: input.role ?? null, team_id: input.team_id ?? null, limit: 4 }), []);
  for (const h of hits) {
    const raw = `${h.item.title}\n${h.item.summary ?? ""}\n${h.item.content_preview ?? ""}`;
    const res = safe(
      () => cached("knowledge_summary", h.item.id, raw, (src) => compressKnowledge(src).summary),
      { content: redact(raw).slice(0, 1200), token_estimate: estimateTokens(raw.slice(0, 1200)), hit: false },
    );
    candidates.push(
      block("knowledge_snippets", `Knowledge: ${h.item.title.slice(0, 60)}`, res.content, 0.7, `matched the goal (score ${Math.round(h.score * 10) / 10})`, {
        compressed: true,
        cache_hit: res.hit,
      }),
    );
  }

  // 6. diff (compressed; on high risk kept closer to raw — security must see the change)
  if (input.raw_diff) {
    const c = compressDiff(input.raw_diff, highRisk ? 6000 : 1500);
    needsRaw = needsRaw || c.needs_raw_context;
    safe(() => storeSummary({ source_kind: "diff", source_ref: input.work_item_id ?? String(input.issue ?? ""), raw: input.raw_diff!, result: c }), "");
    candidates.push(
      block("relevant_diffs", "Change diff", c.summary, highRisk ? 0.95 : 0.75, highRisk ? "high-risk change — diff kept near-raw" : "compressed diff (headers + changed lines)", {
        compressed: c.compression_ratio < 1,
      }),
    );
  }

  // 7. log tail (always summarized — errors/decisions survive, noise dropped)
  if (input.raw_log_tail) {
    const c = compressLog(input.raw_log_tail, 500);
    needsRaw = needsRaw || c.needs_raw_context;
    safe(() => storeSummary({ source_kind: "log", source_ref: input.work_item_id ?? String(input.issue ?? ""), raw: input.raw_log_tail!, result: c }), "");
    candidates.push(block("logs_summary", "Recent agent log (summary)", c.summary, 0.6, "compressed log tail — errors/decisions kept", { compressed: true }));
  }

  // 8. caller-supplied files (summarized + cached by content hash)
  for (const f of (input.relevant_files ?? []).slice(0, 8)) {
    const res = safe(
      () => cached("file_summary", f.path, f.content, (src) => compressLog(src, 350).summary),
      { content: redact(f.content).slice(0, 1400), token_estimate: 350, hit: false },
    );
    candidates.push(block("relevant_files", `File: ${f.path.slice(0, 80)}`, res.content, 0.65, "caller marked as relevant; summarized", { compressed: true, cache_hit: res.hit }));
  }

  // dedupe: drop blocks whose content hash repeats (overlapping sources)
  const seen = new Set<string>();
  const deduped: ContextBlock[] = [];
  for (const c of candidates.sort((a, b) => b.relevance - a.relevance)) {
    const h = sourceHash(c.content);
    if (seen.has(h)) {
      deduped.push({ ...c, included: false, reason: "duplicate of an earlier block (deduped)" });
      continue;
    }
    seen.add(h);
    deduped.push(c);
  }

  // budget fit
  const sys = redact(input.system_instructions ?? "");
  const constraints = (input.constraints ?? []).map((c) => redact(c).slice(0, 300));
  const baseTokens = estimateTokens(sys) + estimateTokens(taskBrief) + estimateTokens(constraints.join("\n"));
  const budget = checkRunBudget({
    agent_id: input.agent_id,
    team_id: input.team_id,
    workflow_id: input.workflow_id,
    work_item_id: input.work_item_id,
    estimated_tokens: baseTokens,
    risk,
    retry_count: input.retry_count,
  });
  const mode = input.mode_override ?? budget.mode;
  const tokenBudget = budget.max_context_tokens;

  let used = baseTokens;
  for (const b of deduped) {
    if (b.reason.startsWith("duplicate")) continue; // already excluded
    // safety: on high risk, diffs/decisions always fit (they're why the policy floor exists)
    const mustInclude = highRisk && (b.kind === "relevant_diffs" || b.kind === "previous_decisions");
    if (used + b.tokens <= tokenBudget || mustInclude) {
      b.included = true;
      used += b.tokens;
      if (mustInclude && used > tokenBudget) b.reason += " (over budget but required at this risk level)";
    } else {
      b.included = false;
      b.reason = `excluded: over the ${tokenBudget.toLocaleString()}-token ${mode} context budget (${b.tokens} tokens)`;
    }
  }

  // fallback: base alone doesn't fit → summarize first / ask approval
  const fallback: ContextPackage["fallback"] =
    baseTokens > tokenBudget ? (budget.needs_approval ? "needs_approval" : "summarize_first") : budget.needs_approval ? "needs_approval" : "ok";

  return {
    system_instructions: sys,
    task_brief: taskBrief,
    constraints,
    blocks: deduped,
    explicit_exclusions: deduped.filter((b) => !b.included).map((b) => ({ kind: b.kind, title: b.title, reason: b.reason, tokens: b.tokens })),
    token_budget: tokenBudget,
    estimated_tokens: used,
    mode,
    needs_raw_context: needsRaw,
    fallback,
  };
}

/** Render the package to a single prompt-ready string (included blocks only, relevance order). */
export function renderContext(pkg: ContextPackage): string {
  const parts = [pkg.system_instructions, pkg.task_brief];
  if (pkg.constraints.length) parts.push("Constraints:\n" + pkg.constraints.map((c) => `- ${c}`).join("\n"));
  for (const b of pkg.blocks.filter((x) => x.included)) parts.push(`## ${b.title}\n${b.content}`);
  return parts.filter(Boolean).join("\n\n");
}
