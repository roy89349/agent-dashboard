# Skill Library

Capabilities as explicit lego-blocks. A **Skill** is what an agent *can* do; **autonomy + the team approval
policy** decide what it *may* do. The page lives at `/skills`.

> **Additive + inert.** Nothing in the issue→agent→PR flow reads skills yet — agents reference skills by id
> (`Agent.skill_ids`, additive). A missing/corrupt `control/skills.json` falls back to the committed default
> and reads never throw (one corrupt skill is dropped, not the whole file). Dangerous skills carry
> `approval_required` so a future consumer routes their use through the durable-approvals system, and the UI
> warns on risky links today.

---

## Which skills exist (18 defaults)

`deploy/skills.default.json` (repo-root seed, overridable by `control/skills.json`):

| Skill | Category | Risk | Approval |
|---|---|---|---|
| Codebase lezen | code | low | — |
| Code aanpassen | code | medium | — |
| GitHub issue lezen | github | low | — |
| GitHub PR maken | github | high | ✅ |
| PR reviewen | github | medium | — |
| Tests runnen | quality | low | — |
| Browser/screenshot review | quality | medium | — |
| Excel/CSV verwerken | data | medium | — |
| PDF/Word uitlezen | data | low | — |
| Supabase/database queries | data | high | ✅ |
| Deploy logs lezen | ops | low | — |
| Documentation schrijven | docs | low | — |
| Security audit | security | high | ✅ |
| KPI/cost reporting | analytics | low | — |
| Knowledge vault raadplegen | knowledge | low | — |
| User communication | comms | medium | — |
| Phone notification vragen stellen | comms | medium | — |
| Phone command ontvangen | control | **critical** | ✅ |

Each skill has: `id, name, description, category, risk_level (low/medium/high/critical), required_permissions,
compatible_roles (empty = all), allowed_tools, approval_required, config_schema (optional JSON), enabled,
archived`. **Create / edit / archive** from the page (archive is a soft-delete that keeps history).

## How skills are linked to agents

Open a skill → the detail drawer's **"Agents — link this capability"** list. Toggle an agent to link/unlink;
that writes `Agent.skill_ids` via `POST /api/agents` (a **separate CAS** from `/api/skills`). Because
`skill_ids` is **not** a fleet-routing field (`enabled`/`role`/`label_scope`/`blocking`), linking never
triggers the "this changes the running fleet" confirm and never re-routes the fleet or disables the security
gate. (You can also see/edit an agent's other settings in the Team Composer.)

## How risk / approval is shown

- **Risk badge** on every card + the detail header: low (emerald) · medium (amber) · high (red) · critical (rose).
- **Approval badge** (🔒) when `approval_required`. High/critical skills default to approval-required (overridable);
  editing a high/critical skill to *not* required shows a warning.
- **Per-agent warnings** in the link list (`lib/skills-view.ts → evaluateSkillForAgent`):
  - **role incompatible** — the agent's role isn't in `compatible_roles` (medium).
  - **risk-vs-autonomy** — a high/critical skill on an **auto/full** (autonomous) agent: *high* severity when
    it isn't approval-gated (or critical-on-self-merge), *medium* when gated. Lower the autonomy, gate it, or
    don't link it.
  - **approval required** (info) — each use needs an approval.

## Filters
Category · Risk · Role · Status (enabled / archived / all — archived hidden by default).

## Env / files
`SKILLS_DEFAULT_FILE` overrides the seed path. Persistence: `lib/skills.ts` (`control/skills.json`, CAS mirror
of `lib/teams.ts`). Logic: `lib/skills-view.ts`. API: `app/api/skills/route.ts`. UI: `app/(app)/skills/page.tsx`
+ `components/skills/*`. Linking field: `Agent.skill_ids` (additive, not yet consumed by the build).

## Tests / build
```bash
cd mission-control
node --test lib/skills.test.ts        # CAS, normalize, default-approval, merge-upsert, tolerant read (5)
node --test lib/skills-view.test.ts   # warning logic + filters/facets (4)
npm run build                         # typecheck + build
```
