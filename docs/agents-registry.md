# Agents Registry — config-driven team identities

A worker is no longer an anonymous slot. The **agents registry** gives each agent a configurable
identity: a **role**, skills, default model/effort/depth, allowed tools, a token budget, and review
behaviour. It is built on the same file-based control-plane as `control/fleet.json` — same lock + CAS
+ atomic 0600 write + opus gate.

> **Additive & safe.** Nothing in the build flow consumes the registry yet (this is the data layer).
> A missing/invalid `control/agents.json` falls back to the committed default team and never throws,
> so the existing **issue → worker → Claude → PR** flow is unchanged. Roles/agents are **not**
> hardcoded in the UI or shell — everything is read from config.

---

## Where it lives

| File | Tracked? | Role |
|---|---|---|
| `control/agents.json` | no (gitignored, runtime) | the **live** registry, edited via `writeAgents()` (CAS) |
| `deploy/agents.default.json` | **yes** (committed) | the **default team** (12 roles); the fallback when the live file is absent |

Resolution order (both TS and shell): `control/agents.json` → `deploy/agents.default.json`
(override with `AGENTS_DEFAULT_FILE`) → empty registry → callers keep current behaviour.

## Schema

`control/agents.json` = `{ schema, rev, updated_at, agents[] }`. Each **agent**:

| field | type | notes |
|---|---|---|
| `id` | string | stable slug, unique |
| `name` | string | display name |
| `role` | string | **open** (not an enum) — config-driven |
| `skills` | string[] | |
| `enabled` | bool | default `true` |
| `model_default` | `haiku\|sonnet\|opus` | `opus` only when `ALLOW_GLOBAL_OPUS=1` (write-gated + downstream) |
| `effort_default` | `low\|medium\|high\|xhigh\|max` | |
| `depth_default` | `solo\|orchestrate` | |
| `system_prompt_ref` | string | path to a role prompt file (not inline) |
| `allowed_tools` | string[] | e.g. `Read, Grep, Glob, Edit, Write, Bash` |
| `green_cmd` | string\|null | per-role override of `GREEN_CMD` |
| `review_of_roles` | string[] | roles this agent reviews |
| `blocking` | bool | `true` = a reject blocks the PR; `false` = advisory |
| `label_scope` | string[] | issue labels this agent claims |
| `max_concurrency` | number | clamped to `HARD_MAX_WORKERS` |
| `daily_token_budget` | number\|null | `null` = fall back to the fleet cap |
| `credential_ref` | string\|null | future: a scoped credential **name**, never a secret |

The default team (`deploy/agents.default.json`): **manager, frontend, backend, qa, security, devops,
documentation, kpi, communication, data, designer, architect**.

## TypeScript API — `mission-control/lib/agents.ts`

- `readAgents(): AgentsFile` — live file → default team → empty (never throws).
- `defaultAgents(): AgentsFile` — the committed default team.
- `normalizeAgent(input): Agent` — fill defaults, clamp, validate (no opus-gate; read-safe).
- `sanitizeAgentPatch(patch, current): Agent[]` — validate `{upsert|remove|agents}`; **opus write-gate** (403 unless `ALLOW_GLOBAL_OPUS=1`).
- `writeAgents(patch, baseRev): number` — `withLock` + **CAS on `rev`** (409 if stale) + atomic 0600 write; returns the new rev.
- `agentByRole(role)`, `agentById(id)` — convenience reads.

Same `HttpError` status convention as `fleet.ts` (`httpStatusOf(e)` → 400/403/409/503).

## Shell helpers — `lib.sh`

- `role_field <role> <field>` — field of the first **enabled** agent with that role (arrays → comma-joined; bool → `true/false`).
- `agent_field <agent-id> <field>` — same, by id.
- `route_role <issue> [labels-csv]` — which role should handle a task, with precedence:
  1. **per-task** role (`control/fleet.json` `tasks[issue].role`)
  2. **label_scope** match (first enabled agent whose `label_scope` ∩ the issue labels)
  3. configured **`DEFAULT_ROLE`** (only if an enabled agent has it)
  4. **empty** → no registry / no confident role → caller keeps the current global behaviour.

## Config (`config.env`, override in `config.local.env`)

| var | default | meaning |
|---|---|---|
| `DEFAULT_ROLE` | *(empty)* | role used by `route_role` when nothing else matches; empty = none |
| `ALLOW_GLOBAL_OPUS` | `0` | `1` lets agents use `model_default: opus` (write-gate) |
| `AGENTS_DEFAULT_FILE` | `deploy/agents.default.json` | override the fallback seed path (mainly for tests) |

## Testing

```bash
# TypeScript: fallback, CAS + stale-rev (409), opus write-gate, normalize  (Node 22.6+)
node --test mission-control/lib/agents.test.ts

# Shell: route_role precedence + fallback, role_field, agent_field
bash tests/route-role.test.sh
```

Both must print all-pass. (The `MODULE_TYPELESS_PACKAGE_JSON` notice from `node --test` is harmless.)

## Seeding the live file (optional)

`control/agents.json` is created the first time you save via the dashboard. To pre-seed it from the
committed default:

```bash
cp deploy/agents.default.json control/agents.json
```

A missing file is fine — readers fall back to the default team.
