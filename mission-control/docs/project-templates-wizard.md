# Project Templates & the "Build My Team" wizard

Pick a project type and get a full, rule-based team proposal — agents, skills per agent, workflows, autonomy,
review rules, budgets, update frequency, approval policy, suggested knowledge sources, safety mode, and phone
commands — then tweak everything and create a real team (or save it as a reusable template). Rule-based today; the
`recommendTeamForProject()` seam is the single place an LLM recommender can slot in later.

---

## Which templates exist
Twelve (`lib/project-templates.ts` → `PROJECT_TEMPLATES`), each built only from **real** agent roles + skill ids +
`tpl_` workflow ids (no owner/project-specific logic):

1. **SaaS webapp** · 2. **Mobile app** · 3. **AI automation** · 4. **Data / Excel automation** · 5. **Bugfix
sprint** · 6. **UI redesign** · 7. **Security audit** · 8. **Documentation sprint** · 9. **Launch preparation** ·
10. **Legacy code cleanup** · 11. **Performance sprint** · 12. **Backend / API sprint**

Each carries a default risk, ordered roles, `skills_by_role`, `autonomy_by_role`, workflow templates, default
labels, knowledge hints, phone commands, base review strictness, and a safety mode. Six map to the existing
`ProjectType` set for `Team.source_project_type` provenance; the other six store `null` provenance (the template id
still lives in the recommendation).

## How recommendations work
`recommendTeamForProject(input)` (rule-based) takes the wizard inputs — project name · type · repo · tech stack ·
goal · risk · budget · speed-vs-quality · tools · auto-merge · phone updates · review strictness · knowledge
sources · preferred workflow — and produces a full proposal:
- **Agents**: each template role resolves to the first *enabled* registry agent (unresolved roles are reported in
  `missing_roles` + a warning). **Skills per agent** come from `skills_by_role` (resolved to real skill names).
- **Autonomy** is capped by risk + speed/quality (`capAutonomy`): **never above `review` at high/critical risk**,
  capped at `review` for quality-first, allowed up to `auto` only when speed-first *and* low risk.
- **Review rules**: strictness from your choice or derived (quality/high→strict, speed→light, else the template
  default); `required_reviews` (strict 2, else 1); blocking roles (security, +qa when strict).
- **Approval policy — the HARD rule**: at **high/critical risk, auto-merge is forced OFF and mode stays `manual`**
  (a warning is emitted if you asked for auto-merge). Auto-merge is only ever enabled at **low** risk (and still
  env-gated by `ALLOW_AUTO_MERGE`); medium risk keeps a human merge.
- **Budget** (estimated tokens) scales with team size unless you set one; cheap mode for speed, high-effort for
  quality. **Update frequency / phone / safety mode / knowledge sources** follow the template + your inputs.

`validateTemplateRecommendation()` re-checks the invariants on the *draft that actually persists* (defence in
depth): no auto-merge/non-manual approval at high risk, `required_reviews ≥ 1` when not manual, non-negative
budget, autonomy ≤ review at high risk, lead ∈ members, members non-empty.

## How I make a team from the wizard
1. Open **Build Team** (`/build-team`). 2. Pick a template + name the project. 3. Set risk/budget/speed/auto-merge/
review/etc. → **Build recommendation**. 4. On the review step: see the team (agent cards with skills + autonomy),
workflows, risk/safety, budget, updates/phone, and suggested knowledge — **adjust risk/speed/strictness/auto-merge
inline** (re-recommends) and **deselect any member**. 5. **Create team** (persists via the CAS-guarded teams write
path) or **Save as template** (`is_template=true`, reusable). The create endpoint re-validates the (possibly
hand-edited) recommendation server-side, so a tampered draft can't bypass the no-auto-merge-at-high-risk rule.

Non-destructive by design: creating a team does **not** mutate the shared agent registry (per-agent skills/autonomy
stay advisory) or global budget settings — those come back as `advisory` for the UI to surface.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/project-templates.test.ts   # 12 templates resolve+validate, unknown→400,
                                                                  # NO auto-merge at high risk (+ autonomy cap),
                                                                  # auto-merge only at low risk, speed/quality
                                                                  # shifts, tampered-rec rejected, create persists,
                                                                  # missing-role warning
node --test --experimental-sqlite lib/*.test.ts                   # full suite → 166 green
npm run build                                                     # typecheck + Turbopack build → clean
```
