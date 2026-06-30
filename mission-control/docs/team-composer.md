# Team Composer

A visual page (`/team-composer`) to compose your own AI production team: add agents (Manager, Frontend,
Backend, QA, Security, KPI, Docs, Communication, Excel/Data, …), wire them into an org-chart, and configure
routing, approval and budget — all on top of the existing config-driven agent registry.

> **Additive + inert.** Nothing in the issue→agent→PR flow reads `teams.json`; it is a visual overlay. A
> missing/corrupt teams file falls back to the committed default and reads never throw (a deleted agent
> shows as a dimmed "ghost" node). The proven fleet flow stays green with teams.json absent.

---

## How to make an agent

Agents live in the registry (`control/agents.json`, seeded from `deploy/agents.default.json`). In the
composer, **Add agent** offers:

1. **From registry** — pick an existing agent to add to the current team (just adds membership).
2. **New / template** — pick one of the 12 role templates (`lib/team-presets.ts`) or type a custom role,
   give it a name/id → it is created via `POST /api/agents` and added to the team.

**Safety:** a newly created agent starts **disabled** with **no label scope**, so it can never re-route the
live fleet or disable the security gate until you explicitly enable + configure it. Editing an existing
agent's `enabled` / `role` / `label_scope` / `blocking` (the fields `worker.sh`/`lib.sh` route on) requires a
confirm (`412 needsConfirm`) — the UI shows a "this changes the running fleet" dialog.

Each agent card shows: name, role, skills, model, effort, depth, **autonomy**, max concurrency, budget,
blocking/advisory, and an enabled toggle.

### Autonomy levels
`suggest` (drafts/comments only) · `review` (opens a PR for human approval — **default**, = today's
behaviour) · `auto` (opens a PR autonomously, never self-merges) · `full` (may self-merge — **DANGEROUS**,
rejected unless `ALLOW_AUTO_MERGE=1`). v1 stores autonomy as a *preference*; no consumer self-merges yet, and
any future consumer must re-check `ALLOW_AUTO_MERGE` downstream (exactly like opus is re-checked in the shell).

## How to compose a team

1. Pick **＋ New team** (or build a recommended one — below).
2. **Add agents** → they appear on the canvas (desktop) / tree (mobile). The lead (★/crown) sits on top.
3. **Connect** (desktop): toggle Connect, choose a kind (reports_to / reviews / hands_off_to / asks), click
   source then target. Click an edge to change its kind or delete it. Drag cards to reposition (saved with
   the team); **Auto-layout** re-flows; **Fit/Reset** zoom.
4. **Configure** via the side panel tabs: **Agent** (the selected agent's settings) · **Team** (name,
   description, labels, repo/path scope, enabled, template) · **Routing** · **Approval** · **Budget**.
5. **Save** (CAS). **Save as template** stores a reusable copy (`is_template`, excluded from active routing).

### Build a recommended team
**Recommend** → pick a project type (SaaS web app · Mobile app · Excel/data automation · Security audit ·
UI redesign · Bugfix sprint). The blueprint (config-driven `deploy/team-rules.default.json`, overridable by
`control/team-rules.json`) is resolved against your **enabled** agents: each role → the first enabled agent,
edges whose endpoints both resolve are kept, and any role with no enabled agent is reported as *missing*
(skipped — add it from a template and re-build). The draft loads unsaved so you can edit before **Save**.

## How routing / approval / budget are saved

All team config persists in **`control/teams.json`** via `POST /api/teams` with CAS-on-rev (mirrors
`agents.json`): file lock, atomic 0600 write, `rev++`, `409` on a stale `baseRev`. Two independent revs
(agents + teams) so each conflicts/reloads separately; `use-teams.ts` **serializes** writes per resource
(one in-flight POST, re-based on the latest rev) so there are no self-inflicted 409 storms.

Every dangerous setting is validated **server-side** in `lib/teams.ts` (the client only pre-validates for UX):

| Setting | Server rule |
|---|---|
| members / lead / edges | must reference team members (pre-existing ghosts tolerated; a *new* unknown member → 400) |
| routing `assign_to` / `fallback_to` | a member id OR a known registry role → else 400 |
| `reports_to` edges | must form a DAG (cycle → 400) |
| `blocking_roles` | filtered to roles actually present among members (not rejected) |
| `approval_policy.required_reviews` | clamped 0–10; forced ≥ 1 when mode ≠ `manual` (no zero-human auto-approve) |
| `approval_policy.mode='auto'` / `auto_merge` | **403 unless `ALLOW_AUTO_MERGE=1`** |
| `budget_caps.per_agent` | may only *lower* an agent's registry budget; clamped 0–1e9 |
| `max_concurrency` / `max_pr_per_day` | clamped to `HARD_MAX_WORKERS` / `HARD_MAX_PR_PER_DAY` |
| repo/path scope | path-traversal-safe (`..` / leading `/` stripped) |
| whole-list replace (`patch.teams`) | requires `confirm:true` |

### Env knobs
`ALLOW_AUTO_MERGE=1` enables autonomy `full` / approval `auto` / `auto_merge` (off by default).
`ALLOW_GLOBAL_OPUS=1` (existing) enables model `opus`. `HARD_MAX_WORKERS` / `HARD_MAX_PR_PER_DAY` cap budgets.
`TEAMS_DEFAULT_FILE` / `TEAM_RULES_DEFAULT_FILE` override the seed paths.

## Files
Types in `lib/types.ts`. Persistence: `lib/teams.ts`. Engine: `lib/team-rules.ts`. Layout: `lib/team-layout.ts`.
Templates: `lib/team-presets.ts`. APIs: `app/api/{agents,teams,teams/recommend}/route.ts`. UI:
`app/(app)/team-composer/page.tsx` + `components/team-composer/*`. (Distinct from `lib/team.ts`, the coarse
Build/Platform/Command presentation grouping used on the board.)

## Tests / build
```bash
cd mission-control
node --test lib/teams.test.ts          # CAS, integrity, DAG, gates, merge-upsert, ghosts, recommend (10)
node --test lib/team-layout.test.ts    # layout depths + NaN guard (5)
node --test lib/agents.test.ts         # registry incl. autonomy gate
npm run build                          # typecheck + build
```
