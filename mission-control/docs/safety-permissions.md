# Safety / permission layer

`lib/permissions.ts` is the central, **server-side**, deny-by-default chokepoint. An action is allowed only
if it fits the caller's **autonomy level**, **granted skills**, the action's **detected risk**, the **team
approval policy**, and the **hard env gates** — and it is **never weaker** than the existing merge
confirm-valve / `ALLOW_GLOBAL_OPUS` / `ALLOW_AUTO_MERGE` write-gates.

> Designed via a 3-architect panel + adversarial red-team (blocker + 5 important findings baked in before
> build). The PURE core (`evaluateAction` / `detectRisk` / `effectiveLevel`) does no I/O so the permission
> **matrix is unit-tested**; `enforce()` is the only side-effecting entry.

---

## Autonomy ladder (0–5)
0 read-only · 1 suggest only · 2 branch changes · 3 PR creation · 4 auto-merge low-risk if checks pass ·
5 full autonomous + audit. The existing string enum maps on: **suggest→1, review→3, auto→3, full→5**
(`auto→3`, NOT 4, because the system only gates `full` behind `ALLOW_AUTO_MERGE` and treats `auto` as
"autonomous PR, never self-merge" — mapping it to 4 would be *more* permissive than today). Levels 4/5 are
**emergent**: a `full` agent clamped by a team `auto_below_risk` policy lands in the auto-merge band. The
ceiling is hard-clamped: `!ALLOW_AUTO_MERGE` → max 3; a `manual` team or a team with `blocking_roles` → max 3;
a disabled agent or an agent with no team → fail-closed (0 / clamped).

## Which actions are centrally controlled
The 12 checker functions (`canRead, canModifyCode, canCreatePR, canMerge, canDeploy, canChangeEnv,
canChangeDatabase, canAddDependency, canUseOpus, canNotifyUser, canCreatePhoneCommand, canCreateApproval`)
all delegate to `evaluateAction(action, ctx) → Decision { effect: allow|deny|requires_approval, risk,
categories, … }`.

**Risk detection** (`detectRisk`, conservative / over-flag) from file paths + action type:

| Category | Risk | Detected from |
|---|---|---|
| auth_security | critical | `lib/session.ts`, `app/api/login/**`, `**/middleware`, `**/proxy`, `*session*`, `lib/permissions` |
| secret_access | critical | `.env*`, `*.pem/.key/.p12/.pfx/.jks`, `id_rsa`, `*credential/secret/token*`, `serviceAccount*.json` |
| billing_payment | critical | `*billing/payment/stripe/invoice/subscription/pricing/checkout*` |
| github_workflow | critical | `.github/**` (workflows, CODEOWNERS, dependabot), `renovate.json` |
| delete_file | high (critical if the deleted file is sensitive) | any `status:"deleted"` |
| env_config | high | `config.*`, `*.config.ts` |
| dependency | high | `package.json` (scripts/postinstall), lockfiles, `requirements.txt`, `go.mod`, `Cargo.toml`, … |
| db_schema | high | `migrations/**`, `*.sql`, `schema.prisma`, `supabase/migrations/**` |
| deploy_merge | medium baseline | `merge`/`deploy` actions (real risk comes from the diff; `deploy prod` → critical) |
| force_opus / cap_increase / fleet_mutation | high / medium / medium | `use_opus` global, cap raises, phone verbs |

## Which actions trigger approvals
`evaluateAction` returns `requires_approval` when:
- **always** (regardless of team policy): an action touching **auth_security / secret_access / billing_payment
  / github_workflow** (these can never be auto-allowed).
- a **governing skill** has `approval_required` or is high/critical risk (agents).
- a team `auto_below_risk` policy and the risk exceeds `auto_approve_max_risk`.
- the risk is **high/critical**, or the action is `merge` / `deploy`.

**Hard env gates** (cannot be approved away, apply to humans too): `use_opus`/`force_opus` → deny without
`ALLOW_GLOBAL_OPUS`; an **agent** `merge` → deny without `ALLOW_AUTO_MERGE` (open a PR instead).

**Invariant #7 (no regression):** a **trusted human who already passed the route's confirm-valve** keeps
today's one-click behaviour (`allow`, no second durable approval) — the hard env gates above still apply.

## Block-until-approved + audit
`enforce(action, ctx, opts)` is the only side-effecting entry:
- `deny` → `recordAudit("permission.denied")` + throws `PermissionError(403)`.
- `requires_approval` → reuses or creates a durable approval via `createApproval()` (**idempotent**: dedupes a
  live pending approval keyed on `(kind, action_json, pr)`), best-effort `sendApprovalRequest` to the phone
  (an outage can't open the gate), `recordAudit("permission.approval_required")`, and returns
  `{ allowed:false, approvalId }` — the route returns **202** and performs **no mutation**. The action runs
  later only through the unchanged `decideApproval → runApprovalAction` path.
- `allow` → `recordAudit("permission.approved_risky"` for high/critical, else `"permission.allowed")`.

The four audit verbs: `permission.denied · permission.allowed · permission.approval_required ·
permission.approved_risky` (detail redacted + clamped).

## Integration map

**Wired now (server-side):**
- `app/api/merge/route.ts` — the 401 + 412 confirm-valve stay FIRST/unchanged; then `enforce(merge)`. Human
  one-click merge unchanged (#7) + now audited; ready for agent merges.
- `app/api/fleet/route.ts` — diffs the patch vs current; `enforce(use_opus)` for `router:"opus"`,
  `enforce(cap_increase)` for `max_workers`/`max_pr_per_day` raises, before `writeFleet` (whose own gates stay
  as backstop). 202 + no-write on pending.
- `lib/phone/execute.ts` — every **mutating** fleet-control verb (incl. `continue`/requeue) goes through
  `enforce` (fail-closed: an unclassified mutating kind can't bypass); read-only + approval-resolution verbs
  skip. Dangerous verbs (stop) return the existing Approve/Reject card via the enforced approval.
- `app/api/agent/act/route.ts` — **the agent enforcement gateway**: `POST {agentId, teamId?, action}` →
  `enforce` → `allow` / `202 pending+approvalId` / `403 denied`. Auth: session OR `X-Agent-Token`.

**TODO integration (documented):**
- **The build-agent runner** (`worker.sh` issue→agent→PR→merge) is the primary downstream consumer: every
  agent code-write / PR-open / dependency / env / db / deploy / merge must call `/api/agent/act` (with
  `AGENT_GATEWAY_TOKEN`) and honour allow / block / deny before touching git/GitHub. Until that lands,
  autonomous agents are gated only at the route boundary — the wired routes today are **human-operated**, so
  no existing safe flow is weakened, but the autonomy ladder is not yet enforced for agents.
- A real gated **deploy / change_env / change_database / add_dependency executor** — these approval kinds are
  currently **sign-off only** (`action_json:{type:"noop"}`); approving them records intent but runs nothing.
- Feeding the **real PR diff** into the human merge route (today it is diff-blind; the confirm-valve governs).

## Env gates
`ALLOW_GLOBAL_OPUS=1` (opus / force-opus), `ALLOW_AUTO_MERGE=1` (autonomy `full` / approval `auto` /
auto-merge), `AGENT_GATEWAY_TOKEN` (the on-host runner's token for `/api/agent/act`).

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/permissions.test.ts   # the permission MATRIX (10): detectRisk, decision matrix, enforce
npm run build                                                # typecheck + build
# regression — nothing else breaks:
node --test --experimental-sqlite lib/teams.test.ts lib/agents.test.ts lib/approvals.test.ts
node --test lib/phone.test.ts
```
