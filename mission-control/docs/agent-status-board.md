# Agent / role / team status on the board & workers

The Dashboard, Board and War Room no longer show anonymous worker slots — every lane and card shows
**which agent, role and team** is responsible, what phase it's in, its risk, and whether it's waiting for
an approval. You can filter and regroup by role / agent / team / status.

---

## Metadata now visible

**Per worker lane (War Room):**
- **Agent identity** — initials avatar (coloured by role) + role chip + team badge.
- **Role** and **team** (team is derived from the role — see below).
- **Current task** (`#issue title`), **current phase** badge, **model · effort**, **depth**.
- **Time running** (elapsed), **status** (running / stalled / **waiting for approval**), **risk** badge.
- Live log tail + Cancel / Kill (unchanged).

**Per board card:**
- Agent avatar + **role chip** + **team badge** (when the issue is being worked / routes to a role).
- **Risk badge** + **"waiting approval"** badge when a pending approval blocks the issue.
- Existing model / state / verdict / merge controls (unchanged).

**Filters & views (board + workers):**
- Filter by **role · agent · team · status** (only dimensions that have data show up).
- **Group by** — Board: Status (default, original 4 columns) / Role / Team. War Room: Flat (default) /
  Role / Team / Status.

## Where the data comes from (existing status + events, no new polling)

```
worker.sh ──route_role + role_field──▶ heartbeat worker-<slot>.json {role, agent_id, agent_name, …}
                                              │
supervisor.sh status_write ───────────────────┼──▶ control/status.json  slots[].{role, agent_id, agent_name}
                                              │
readStatus() ──teamForRole(role)──────────────┼──▶ slots[].{team_id, team_name, current_phase}
/api/fleet/status ──listPendingApprovals()────┼──▶ slots[].{awaiting_approval, risk_level}
getBoard() ──live slot + pending approvals─────┴──▶ card.{role, agentId, agentName, teamId, teamName, riskLevel, awaitingApproval}
```

- **Role** comes from `route_role` (per-task `role` field > label_scope match > `DEFAULT_ROLE`); the
  **agent** is the first enabled registry agent for that role (`role_field`).
- **Team** is a presentation grouping over roles (`lib/team.ts`): Build (frontend/backend/qa/designer/
  architect/data), Platform (security/devops), Command (manager/kpi/communication/documentation). The
  registry needs no `team` field.
- **Risk + waiting** reuse the durable-approvals store (a pending approval for the issue → `risk_level`
  via `riskLevel()` + `awaiting_approval`). No extra client poll — the existing `/api/fleet/status` and
  `/api/board` responses are enriched server-side in the same request.

## Backward compatibility

Every new field is **optional**. Nothing is removed.
- An **old `status.json`** (slots without `role/agent_id/agent_name`) renders exactly as before — the
  identity row simply doesn't appear, `teamForRole(null)` → null, and `slotMeta` falls back to the phase.
- An **old board card** (no role/team) shows its original chips; `cardMeta` uses the column for status.
- If the **approvals store is unavailable**, enrichment is skipped (try/catch) and slots/cards still render.
- The shell change is additive: `route_role`/`role_field` already existed and are unit-tested; the worker
  just *emits* the resolved role for display — it does not change how the build runs.

## Files

- Types: `lib/types.ts` (`SlotStatus` + `BoardCard` optional fields, `RiskLevel`).
- Pure helpers: `lib/team.ts` (team/role tones/initials), `lib/agent-view.ts` (normalize/filter/facet/group).
- Server enrichment: `lib/fleet.ts` (`readStatus`), `app/api/fleet/status/route.ts`, `lib/board.ts`.
- Shell emit: `worker.sh` (role + agent in heartbeat), `supervisor.sh` (pass-through to `status.json`).
- UI: `components/fleet/agent-meta.tsx`, `components/fleet/filter-bar.tsx`, `components/fleet/worker-lanes.tsx`,
  `components/task-card.tsx`, `components/board.tsx`.

## Tests / build

```bash
cd mission-control
node --test lib/agent-view.test.ts                  # team derivation + normalize + filter/group + backward-compat (7)
node --test --experimental-sqlite lib/approvals-view.test.ts lib/approvals.test.ts   # (5 + 8)
node --test lib/phone.test.ts                       # (9)
npm run build                                        # typecheck + build
# fleet shell (repo root):
bash -n worker.sh && bash -n supervisor.sh           # syntax
bash tests/route-role.test.sh                         # role routing (10)
```
