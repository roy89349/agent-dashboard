# Token Optimization Framework

Mission Control's token-optimization layer makes agent runs cheaper **without silently making them
worse**. It compiles a minimal-but-sufficient context per run, routes each task to the cheapest
adequate model, enforces budgets with human approvals for expensive work, and accounts for every
run in a ledger that is scrupulously honest about *estimates vs. actuals*.

All server logic lives in `lib/token-optimization/` and is covered by
`lib/token-optimization.test.ts` (run with `node --test lib/*.test.ts`).

---

## Architecture

```
                        ┌──────────────────────────────────────────────┐
   task / chat / worker │            per-run pipeline                  │
  ──────────────────────▶  context-compiler ──▶ budget-manager ──▶ model-router
                        │      │    │                │                  │
                        │      │    └─ context-cache │                  │
                        │      └─ compressor         └─ approvals       │
                        └──────────┬───────────────────────┬───────────┘
                                   ▼                       ▼
                               ledger  ◀──── run result (chat runner actuals)
                                   │
                    quality-guard ─┴─ recommendations ──▶ UI + phone
```

| Service (`lib/token-optimization/`) | Responsibility |
| --- | --- |
| `types.ts` | Shared pure types + the `estimateTokens` (chars/4) heuristic. No imports — safe everywhere. |
| `compressor.ts` | Deterministic (non-LLM) compression of logs, diffs, conversations, knowledge, workflow state. |
| `context-cache.ts` | Semantic cache for computed summaries, keyed by kind+scope, invalidated by source hash. |
| `ledger.ts` | Per-run usage accounting (`token_usage_events`), summaries, efficiency metrics. |
| `budget-manager.ts` | Modes, per-scope budget policies, the pre-run gate (`checkRunBudget`), approvals. |
| `model-router.ts` | Pure model/effort/depth decision from task signals + mode + risk. |
| `context-compiler.ts` | Builds the actual context package per run: select → compress → dedupe → budget-fit. |
| `quality-guard.ts` | Quality score per run + the escalation ladder when optimization causes failures. |
| `recommendations.ts` | Deterministic rules over ledger/cache/compression stats → apply/dismiss suggestions. |

Everything is deterministic and unit-testable; nothing in this layer ever calls an LLM (compressing
context must never itself cost tokens).

---

## Context Compiler (`context-compiler.ts`)

`compileContext(input)` assembles a **minimal but sufficient** context bundle for one agent run.

**Inputs** (`CompileInput`): `goal` (required), plus optional `agent_id`, `role`, `team_id`,
`work_item_id`, `workflow_id`, `issue`, `risk`, `system_instructions`, `constraints`, and
caller-supplied raw material: `raw_log_tail`, `raw_diff`, `relevant_files[]`. The compiler never
shells out or reads the repo itself — callers hand it raw material.

**Block kinds** (`ContextBlockKind`): `system_instructions`, `task_brief`, `constraints`,
`relevant_files`, `relevant_diffs`, `knowledge_snippets`, `previous_decisions`, `agent_memory`,
`recent_events_summary`, `workflow_state`, `logs_summary`.

Selection per source:

1. **Task brief** — always included, never compressed (goal, work-item state, issue, role).
2. **Workflow state** — compressed lossless-ish (step names, statuses, truncated outputs).
3. **Previous decisions** — approval summaries linked to this work item/issue (newest 6).
4. **Agent memory** — rules/warnings first, then top preferences.
5. **Knowledge snippets** — access-scoped search on the goal; compressed + cached per item.
6. **Diff** — compressed; on high/critical risk kept near-raw (6000-token target vs. 1500).
7. **Log tail** — always summarized (errors/decisions survive, noise dropped).
8. **Relevant files** — summarized and cached by content hash (max 8).

**Dedupe**: blocks whose (redacted) content hash repeats are excluded with reason
`"duplicate of an earlier block (deduped)"`.

**Budget fit**: blocks are sorted by relevance and greedily included until the mode's
`max_context_tokens` budget (from `checkRunBudget`) is reached. Every candidate is reported —
included, or listed in `explicit_exclusions` with a human-readable reason and its token cost — so a
Context Inspector UI can show exactly what an agent would receive and why.

**Risk override**: on `risk: "high" | "critical"`, `relevant_diffs` and `previous_decisions` are
**always included**, even over budget (reason gets `"(over budget but required at this risk
level)"`). Security review must see the change.

**Fallback**: if even the base (instructions + brief + constraints) doesn't fit, the package is
flagged `summarize_first`; if the budget gate demanded an approval, `needs_approval`; otherwise `ok`.

`renderContext(pkg)` renders included blocks only, in relevance order, to a single prompt-ready
string.

---

## Budget Manager (`budget-manager.ts`)

### Modes and MODE_DEFAULTS

The global mode lives in the `tokens.mode` setting (default `balanced`). Numbers are
**estimate-space ceilings**, not promises:

| Mode | max_context_tokens | max_run_tokens | max_retries | approval_threshold_tokens |
| --- | ---: | ---: | ---: | ---: |
| `economy` | 6,000 | 25,000 | 1 | 60,000 |
| `balanced` | 12,000 | 80,000 | 2 | 150,000 |
| `high_quality` | 30,000 | 250,000 | 3 | 500,000 |
| `emergency` | 60,000 | 1,000,000 | 4 | 2,000,000 |

`setGlobalMode("emergency", …)` **never switches directly** — it creates a Decision-Inbox approval
(action `{type:"set_setting", key:"tokens.mode", value:"emergency"}`) and returns
`needs_approval: true` while `getGlobalMode()` stays unchanged. Other modes switch directly and are
audited.

### Policy precedence

`checkRunBudget` resolves the effective policy in this order (first match wins):

```
agent  >  team  >  workflow  >  task  >  model  >  global mode defaults
```

Within a scope, an exact `scope_id` match beats the `'*'` scope default. A separate `day` scope
supplies `max_day_tokens` per agent (or `'*'`).

### Hard clamps

`upsertPolicy` validates and clamps **every** number server-side — client values are never
trusted: context ≤ 120,000; run ≤ 2,000,000; day ≤ 10,000,000; retries ≤ 6; approval threshold ≤
5,000,000. Non-positive/non-numeric values become `null` (fall through to mode defaults). An
invalid scope or mode throws. Every write is audited.

### The pre-run gate (`checkRunBudget`)

1. **Risk floor** — `high`/`critical` risk on `economy`/`balanced` raises the context policy to
   `high_quality` (with a warning). Risky work never runs on starved context.
2. **Retry ceiling** — `retry_count > max_retries` → blocked, *no* approval (retrying more is a
   quality-guard problem, not a spend decision).
3. **Day budget** — if today's best-known spend + this estimate exceeds `max_day_tokens`, the run
   is blocked and a real approval row is created (phone-notified). >80% adds a warning.
4. **Per-run approval threshold** — an estimate above the mode's threshold blocks the run and
   creates an approval ("Expensive run…"). Approving is the *only* way past the gate — there is no
   silent bypass.
5. Otherwise: allowed, with a warning if the estimate exceeds `max_run_tokens`.

---

## Model Router (`model-router.ts`)

`routeModel(input)` is a **pure function** — no I/O, fully unit-testable, and it only *decides*;
callers audit the decision and enforce the opus approval.

**Signals** → a deterministic 0–10 complexity score: simple keywords (typo/docs/readme/… −2),
complex keywords (refactor/security/auth/migration/schema/… +3), file count (+1/+2), diff size
(+2 above 40k chars), past failure rate (+2 above 40%), risk (+2 high, +3 critical), many required
skills (+1).

**Ladder**:

- score ≤ 2 and low risk → `haiku` (docs/status/formatting)
- score ≥ 7 **or** critical risk → `opus`
- otherwise → `sonnet`

**Mode bends, risk floors**:

- `economy` caps `opus → sonnet` — **but never on high/critical risk**.
- `high_quality` floors `haiku → sonnet` (and effort `low → medium`).
- high/critical risk always floors `haiku → sonnet`.
- Effort follows the same shape; `emergency` pushes effort to `high`/`xhigh`.
- `orchestrate` depth only for score ≥ 9 in `high_quality`/`emergency`; else `solo`.

**Opus gate**: when the routed model is `opus` and the caller's `allow_opus` policy (the
`ALLOW_GLOBAL_OPUS`-style gate) is off, the decision returns `needs_approval: true`. The router
never spends — enforcement is the caller's job via budget-manager/permissions.

`estimated_cost` is qualitative (`low`/`medium`/`high`) — no invented dollar figures.

---

## Compression (`compressor.ts`)

**Deterministic, non-LLM.** Line-based: redact first, then keep a head window, a tail window
(recent state matters most), and every line matching the importance regex (errors, failures,
exceptions, security, decisions, constraints, TODO/FIXME, verdicts, breaking/migration/deprecation
…). Exact repeated lines are deduped; noise lines (`ok`/`done`/`debug`/…) are dropped; over-budget
output trims the *middle*, never the tail.

- `compressLog` (500-token target), `compressConversation` (800), `compressKnowledge` (400),
  `compressWorkflowState` (300, lossless-ish), `compressFileSummary` (350).
- `compressDiff` (1500 default / 6000 on high risk) keeps `diff --git` / `---` / `+++` / `@@`
  headers plus up to 40 changed lines per file.
- Input already under budget is returned unchanged (`compression_ratio: 1`, confidence 1) — but
  **still redacted**.

**Redaction-first**: `redact()` runs *before* any line selection, so a secret can never be "kept"
by the importance heuristic; `storeSummary` double-redacts defensively before persisting to
`context_summaries` (with source hash, ratios, confidence — savings and quality stay auditable).

**Confidence + `needs_raw_context`**: each result carries a 0–1 confidence (lower when squeezed
below ~5–15% of the original). Below `LOW_CONFIDENCE` (0.5) the result is flagged
`needs_raw_context: true` — the caller should prefer raw material over a risky summary.
`compressionStats()` reports count / tokens saved / average ratio / low-confidence share.

---

## Semantic Context Cache (`context-cache.ts`)

Avoids recomputing expensive summaries/analyses.

- **Keying**: `kind:scopeId` (e.g. `file_summary:src/db.ts`, `knowledge_summary:<item-id>`). Kinds:
  `file_summary`, `task_summary`, `knowledge_summary`, `dependency_map`, `analysis`, `log_summary`.
- **Hash invalidation**: each row stores a SHA-256 (24 hex chars) of its *source*. A lookup with a
  different current source hash is a miss **and deletes the stale row**. `cached(kind, scope,
  source, compute)` is the standard get-or-compute helper (returns `{content, token_estimate, hit}`).
- **Explicit invalidation**: `invalidateCache({kind?, scopePrefix?})` for knowledge/task/decision
  updates or git changes.
- **No secrets in the cache**: content is redacted *before* write, and the fresh compute result
  returned to the caller is redacted too.
- `cacheStats()` reports entries, hits, misses, hit-rate and a per-kind breakdown. (Note: because
  hash invalidation deletes the row, hit counters on superseded rows are wiped with them — stats
  are a health signal, not a precise history.)

---

## Ledger (`ledger.ts`) — estimates vs. ACTUALS

**Honesty rule**: `actual_*` columns are filled **only** when the runtime really reported them.
Everything else stays an estimate (chars/4 via `estimateTokens`) and is labeled as such wherever it
surfaces. Money appears only when a real cost exists — never fabricated.

- **Today, actuals come ONLY from the chat runner's result event**
  (`app/api/chats/[id]/message/route.ts` records `actual_cost_usd: res.costUsd` from the CLI's
  result JSON). **Worker-pipeline capture of the CLI result JSON is a TODO** — the
  `ledger.no_actuals` recommendation fires when everything is estimated.
- `recordUsage(input)` writes a `token_usage_events` row (agent/team/work-item/workflow refs,
  model/effort/depth, estimated + actual tokens/cost, cache_hit, compression_used, redacted
  context-block breakdown, mode, result status, source: `chat`/`gateway`/`worker`/`manual`).
- `eventTokens(e)` returns the best-known figure: actuals when any actual token field is present
  (`is_actual: true`), else the estimate.
- `usageSummary(since?)` (default: today) aggregates runs, estimated vs. actual tokens,
  `actual_cost_usd` (**null when no event carries a real cost**), failed runs and
  `wasted_tokens_failed`, cache/compression counts, and per-agent/workflow/model breakdowns.
- `efficiencyMetrics()` gives tokens-per-successful-run vs. tokens-per-failed-run — failures
  burning more than successes is the strongest "fail fast, escalate model" signal.

---

## Quality Guardrails (`quality-guard.ts`)

Optimization must never silently degrade output.

- **Quality score** (0–100): tests passed (30), review verdict (25; caution = half), security
  verdict (25; caution = half), PR merged (15), user feedback (5). Missing signals don't count
  against — no signals at all scores 100 with `signals: 0`.
- **`contextTooAggressive(pkg)`**: flags a package when a compression fell below the confidence
  floor, when important blocks (diffs/decisions) were excluded, or when everything was compressed
  despite budget headroom.
- **Escalation ladder** (`escalationFor`, deterministic from the ledger over a 24h window,
  counting *failed runs that used compression or economy mode* for the scope):

  | failed optimized runs | escalation |
  | ---: | --- |
  | 0 | `none` |
  | 1 | `more_context` |
  | 2 | `stronger_model` |
  | 3 | `plan_only` |
  | ≥ 4 | `human_approval` |

- `escalateToHuman` raises an audited Decision-Inbox approval for the top rung; the lower rungs are
  hints the caller applies (bigger budget, sonnet→opus route, plan-only mode).

---

## Recommendations (`recommendations.ts`)

Deterministic rules over the last 7 days of ledger + cache + compression stats — idempotent per
rule, and **never self-applying**: apply/dismiss are explicit authenticated actions, and even
"apply" only writes policy through the validated budget-manager. Rules: token waste on failed runs,
top-spender agents without a policy, low cache hit rate, frequent low-confidence compression,
retry-dominated workflows, "no actuals captured", failed runs heavier than successes.

---

## UI — `/token-optimization`

Server API (all session-authenticated under `app/api/token-optimization/`):

- `GET /api/token-optimization` — overview payload: global mode, today + 7-day usage summaries,
  efficiency metrics, cache stats, compression stats, policies, `MODE_DEFAULTS`. Each section is
  independently guarded so one broken subsystem can't 500 the page.
- `POST /api/token-optimization/mode` — switch the global mode (`emergency` returns an approval
  instead of switching).
- `GET/POST /api/token-optimization/policies` — list / upsert (server-clamped) budget policies.
- `GET/POST /api/token-optimization/recommendations` — list (or `?generate=1` regenerate) and
  apply/dismiss.
- `POST /api/token-optimization/context-preview` — the **Context Inspector**: runs
  `compileContext` on supplied inputs and returns the full package (every block included *or*
  excluded with its reason, token counts, budget, fallback) without spending anything.

The dashboard page presents these as tabs — **Overview** (mode, today/week spend, estimates vs.
actuals clearly labeled), **Budgets & Policies** (mode defaults table + per-scope policies),
**Context Inspector** (preview what an agent would receive and why), **Savings** (compression +
cache stats, wasted tokens on failed runs), and **Recommendations**.

## Phone commands

Telegram-side controls (thin wrappers over the same server functions — the phone can never bypass
validation):

| Command | Effect |
| --- | --- |
| `/tokens` | Today's usage summary (runs, est. tokens, actuals where captured, waste, cache/compression counts, top agents). |
| `/costs` | `/tokens` plus the cost line — real `actual_cost_usd` only; shows "no real cost data — estimates only" instead of inventing numbers. |
| `/budget` | Current mode + effective ceilings; warns when a day budget is >80% consumed. |
| `/savings` | Compression + cache savings (tokens saved, hit rate, avg ratio). |
| `/expensive` | Top spenders (agents/workflows/models by best-known tokens). |
| `/optimize` | Generate + list open recommendations. |
| `/setmode <mode>` | Switch global mode. `emergency` always answers with an approval request, never switches directly. |
| `/approve_cost <id>` | Decide a pending budget approval (single-use hashed token, same rules as every Decision-Inbox approval). |
| `/token_report` | Currently an alias of `/tokens` (same usage report). |

---

## Security model

- **Redaction-first, everywhere**: raw material is redacted *before* compression/selection; stored
  summaries are double-redacted; **no secrets in the cache** (redacted before write and on the
  fresh-compute return path); ledger context-block metadata is redacted.
- **Strict `set_setting` allowlist**: an approval's `set_setting` action may *only* flip
  `tokens.mode` to a known mode (`lib/phone/actions.ts`) — a crafted approval can never write
  arbitrary or security-relevant settings.
- **Server-validated policies**: `upsertPolicy` validates scope/mode and hard-clamps every number;
  API routes and "apply recommendation" go through it — project files and clients can't write
  policy directly.
- **Budget bypass needs approval**: over-threshold runs, day-budget overruns and emergency mode all
  block and raise a real Decision-Inbox approval; there is no code path that spends past the gate
  silently. Everything is audited.
- **High-risk context floor**: high/critical risk raises the context policy to `high_quality`, the
  router never drops below sonnet, and the compiler force-includes diffs/decisions — savings never
  starve a security review.
- **Opus gate**: routing to opus outside an allow policy is marked `needs_approval` and enforced by
  the caller (mirroring the agents registry's `ALLOW_GLOBAL_OPUS` write-gate).

---

## How to set policies

Via the UI (Budgets & Policies tab) or the API:

```bash
curl -X POST /api/token-optimization/policies \
  -H 'content-type: application/json' \
  -d '{"scope":"agent","scope_id":"backend","mode":"economy",
       "max_context_tokens":8000,"max_run_tokens":40000,"max_retries":1}'
```

- `scope`: `agent` | `team` | `workflow` | `task` | `day` | `model`; `scope_id`: the id, or `'*'`
  for the scope default. Precedence: agent > team > workflow > task > model > global mode.
- Omitted/invalid numbers fall back to the mode's defaults; all values are clamped server-side.
- Day budgets: a `day`-scope policy with `max_day_tokens` (per agent id, or `'*'`).
- Global mode: `POST /api/token-optimization/mode` or `/setmode`.

## How savings are measured

Honestly, and in layers:

1. **Compression savings** — every `storeSummary` records `tokens_before` vs. `tokens_after`
   (chars/4 estimates); `compressionStats()` sums the saved tokens and tracks the low-confidence
   share so "savings" that endanger quality are visible.
2. **Cache savings** — `cacheStats()` hit rate: every hit is a summary *not* recomputed and a
   source *not* re-sent.
3. **Waste** — `usageSummary().wasted_tokens_failed` (best-known tokens on failed runs) and
   `efficiencyMetrics()` (tokens per ok vs. failed run) measure the biggest real cost: failures.
4. **Estimates vs. actuals** — summaries always separate `est_tokens` from `actual_tokens` and
   report `actual_cost_usd` as **null** unless a real cost was captured. Until the worker pipeline
   captures the CLI result JSON (TODO), real numbers exist only for chat runs; every other figure
   is an estimate and is labeled as one.
