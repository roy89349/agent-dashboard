# Token Optimization Plan — Mission Control

Principle: **maximum output per token** — cheap where possible, expensive where valuable. Never
trade quality silently; escalate context/model when quality signals demand it.

## 1. Analysis — where tokens are spent today

Model invocation points (all `claude -p`):
1. **Build agent** (`worker.sh` → sandbox `pipeline.sh`, VPS) — the big spender. Context = full
   issue text + whatever the agent reads in the repo (its own tool calls). Model via `route_model`
   (haiku classifier → sonnet/opus), effort via `route_effort`. **No token/cost capture** (plain
   text output).
2. **Security agent** (`worker.sh`) — full staged diff in the prompt, opus by default via registry.
3. **Reviewer / QA agent** (`worker.sh`) — full PR diff in the prompt.
4. **Classifier** (`lib.sh route_model`) — haiku, title+body, cheap (already optimized).
5. **Orchestrator / task chats** (`lib/agent.ts runClaude` ← `/api/chats/[id]/message`) — the ONLY
   place with **real cost data** (`total_cost_usd`, `num_turns` from the result event) — currently
   stored only in message meta, not aggregated.

Context assembly points: `taskSystem()` (issue state + raw 1800-char log tail), `orchestratorSystem()`
(fleet status), reviewer/security prompts (full diffs, unbounded), knowledge (`knowledgeForAgent` —
exposed but not injected), agent memory (`memoryForAgent` — exposed but not injected).

**Current waste:** full log tails instead of error-focused summaries; unbounded diffs to
reviewer/security; no caching of repeated summaries; no per-run accounting (only activity
estimates in `costs.ts`); retries resend everything; no budget gate before a run.

## 2. Quick wins
- Log the chat runs' REAL cost into a ledger (data already flows through `runClaude`).
- Compress the task-chat log tail (errors/decisions kept, noise dropped) before prompting.
- Budget gate + model routing advice at the `/api/agent/act` gateway.
- Deterministic (non-LLM) compression: fast, free, testable, no extra tokens spent to save tokens.

## 3. Architecture

A **framework layer** `lib/token-optimization/` (server-side, SQLite-backed, mirrors existing
idioms: `getSetting`, `recordAudit`, `redact`, `createApproval`). Nothing existing is rewritten;
integration points call into it.

```
context-compiler ──> uses estimate + compressor + context-cache + knowledge/memory/approvals/workflows
budget-manager   ──> modes + policies + caps; escalates via approvals; validates server-side
model-router     ──> pure decision (model/effort/depth + reason); audited by callers
compressor       ──> deterministic, redaction-first, confidence-scored summaries (stored)
context-cache    ──> SQLite cache keyed by source hash; hit/miss metrics
ledger           ──> token_usage_events (actual where available, estimate otherwise)
quality-guard    ──> quality score per run; escalation ladder (more context → stronger model → plan-only → human)
recommendations  ──> rule-based advice from ledger + cache stats; apply/dismiss
```

## 4. Data model (SQLite, additive)
- `token_usage_events` — per run: ids (agent/team/work item/workflow/step), model/effort/depth,
  estimated & actual input/output tokens, estimated & actual cost, cache_hit, compression_used,
  context_blocks_json, optimization_mode, result_status. Estimate vs actual ALWAYS explicit.
- `context_cache` — key, kind, source_hash, content (redacted), token_estimate, hits/misses meta.
- `context_summaries` — source ref+hash, mode (lossy/lossless-ish), tokens before/after, ratio,
  confidence, invalidation rule.
- `token_budget_policies` — scope (agent/team/workflow/task/day/model), scope_id, mode, caps,
  retry limit, approval threshold.
- `optimization_recommendations` — rule id, title, detail, impact estimate, status (open/applied/dismissed).

## 5. Services — see §3; all in `lib/token-optimization/`, each unit-tested, no shell-out.
Estimator: chars/4 heuristic, always labeled estimate. Compression is deterministic (keeps
errors/decisions/constraints/open questions; drops repetition/noise); low confidence ⇒
`needs_raw_context`. Redaction BEFORE compression, cache writes, phone, and logging.

## 6. Integrations (this build)
- `/api/chats/[id]/message`: compressed log tail in task context; ledger records each run with
  **actual** cost.
- `/api/agent/act`: budget check (block → 402-style deny or approval), router advice, ledger event.
- Budget escalations + expensive-model approvals → existing Decision Inbox (`createApproval`) +
  phone notify; audited.
- Phone: `/tokens /budget /savings /expensive /optimize /setmode /token_report /approve_cost` (+
  `/costs` alias).
- UI: `/token-optimization` (Overview · Agents · Workflows · Context Inspector · Budget Policies ·
  Recommendations) in liquid-glass style; links from Costs.
- Shell fleet (worker.sh) actual token capture = **follow-up** (needs `--output-format json` in the
  sandbox pipeline; listed as TODO — until then worker runs are estimates).

## 7. Safety / quality
- High-risk paths (auth/security/env/payment/deploy — reuse `detectRisk` patterns) force
  high_quality context policy; security-relevant blocks are never compressed away.
- Redaction first, everywhere; no secrets in cache/summaries/phone.
- Policies validated server-side (enum clamps, numeric floors/ceilings); recommendations never
  self-apply policy — apply is an authenticated action; project-file content can't write policies.
- Budget bypass/emergency mode requires an approval.
- Quality-guard: repeated failure after optimization ⇒ escalate (context → model → plan-only → human).

## 8. Implementation order
1. db tables + types + estimator + ledger.
2. budget-manager + model-router (pure cores).
3. compressor + context-cache + context-compiler + quality-guard + recommendations.
4. Integrations (chats route, act gateway, costs link).
5. Phone commands. 6. UI. 7. Tests + docs (`docs/token-optimization.md`). 8. build/tests/deploy.
