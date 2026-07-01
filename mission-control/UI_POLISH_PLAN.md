# UI Polish Plan — "Liquid Glass" Mission Control

Goal: make the whole app feel like a high-end AI command center (Apple liquid glass × Linear ×
Raycast × Vercel). UI/UX only — no backend features, no route removals, no broken functionality.

## 1. Current UI problems

- **Sidebar**: 18 flat items in one long list — no grouping, hard to scan, active state is a thin bar.
- **Dashboard**: control bar + kanban only; no page header, no metrics, lots of dead space; columns are
  flat `bg-white/5` blocks; cards are functional but flat.
- **Design system**: tokens exist (`globals.css`) but are minimal; most surfaces are ad-hoc
  `border-white/10 bg-white/[0.03]` — consistent-ish but flat, no depth/blur/highlight.
- **No shared PageHeader/MetricCard/GlassPanel** — each screen invents its own header and card.
- **Status colors** are mostly consistent (emerald/red/amber/indigo) but applied ad-hoc.
- **Mobile**: bottom nav exists but "Work Items" is buried in More; tables (audit) overflow.
- **Empty states** vary; some screens have none.

## 2. New navigation structure (visual grouping only — all routes kept)

Sidebar gets section headings; same links, no route changes:

- **Command** — Dashboard `/` · War Room `/war-room` · Decisions `/approvals` · Work Items
  `/work-items` · Workflows `/workflows`
- **Team** — Manager `/manager` · Agents `/agents` · Build Team `/build-team` · Team Composer
  `/team-composer` · Skills `/skills`
- **Intelligence** — Knowledge `/kennis` · KPIs `/kpis` · Costs `/costs` · Performance
  `/agent-performance`
- **Communication** — Updates `/updates` · Conversations `/conversations` · Phone `/config#phone`
  (existing anchor, no new backend)
- **System** — Audit Log `/audit` · Config `/config`

`/workers` (Worker Lanes) and `/chats` stay reachable (More sheet, ⌘K, links from War Room/board).

Mobile bottom nav: **Dashboard · Decisions · War Room · Work Items · More** (Agents moves into the
grouped More sheet, which mirrors the 5 sections above).

## 3. Liquid glass design system (globals.css + components/ui/glass.tsx)

Tokens (CSS vars): existing palette kept; add `--glass`, `--glass-strong`, `--glass-border`,
`--glass-highlight`, status vars (`--ok --danger --warn --info`), radii, shadow recipes.

Utility classes (single source of truth, used everywhere):
- `.glass` — panel: translucent bg + `backdrop-blur` + 1px translucent border + **top-edge inset
  highlight** + soft deep shadow, `rounded-2xl`.
- `.glass-card` — smaller card variant (`rounded-xl`, lighter blur) + `.glass-hover` (border +
  bg lift + subtle glow on hover; premium, not neon).
- `.glass-inset` — recessed wells (kanban columns, timelines).
- `.glow-ok / .glow-warn / .glow-danger / .glow-info` — quiet active-state glows.
- Background: dark mesh — 3 subtle radial orbs (indigo/emerald/violet), fixed; low intensity.
- `prefers-reduced-motion`: kill fade/drawer animations + pulses.
- Global `:focus-visible` ring; thin scrollbars kept.

Reusable components (`components/ui/glass.tsx` — small, no over-engineering):
- `PageHeader` (title, subtitle, actions slot)
- `GlassPanel`, `GlassCard`
- `MetricCard` (label, value, hint, tone, optional icon/link)
- `SectionLabel`
Existing primitives polished in place: `ui/button` (glass surfaces + tuned focus ring), `ui/badge`
(unchanged API), `ui/dialog`/`ui/drawer`/`ui/confirm` (glass surface), `ui/input`, `ui/empty-state`
(glass), `fleet/filter-bar` (glass toolbar). Existing `Badge`/`RiskBadge`/`AgentIdentity` stay the
canonical status/risk/identity components.

## 4. Per-screen changes

- **Shell**: grouped sidebar w/ section headings, compacter rows, premium active state (glass pill +
  accent glow), glass topbar; mobile nav per §2.
- **Dashboard**: PageHeader ("Mission Control" + status line + quick actions New task/Decisions/Ask
  manager) → ControlBar as glass **command strip** (stronger start/pause/stop, clearer offline) →
  **metrics row** (active agents, open decisions, running workflows, blockers, PRs ready — from the
  existing `/api/war-room` health payload, no new backend) → glass kanban columns + refined cards
  (clear hierarchy: title → identity → chips → actions) → filters in a glass toolbar.
- **War Room**: most "control room" — glass health tiles, agent grid cards, grouped timeline in a
  glass inset, compact filters, blockers/waiting-for-you prominent.
- **Decisions**: scannable glass cards (risk/agent/issue/PR/expiry), big approve/reject, "why am I
  being asked" (existing reason/advice fields), phone-notified status; mobile-first large targets.
- **Work Items**: glass cards w/ status/priority/risk/agent/workflow; detail drawer sections;
  parent/child visual.
- **Workflows**: stepper as glass nodes; per-step status/role; blocked/waiting/approval prominent.
- **Manager**: planning-cockpit layout (plans/decompositions/pending sign-offs as glass sections).
- **Updates**: summaries grouped per day, urgent separated, phone-origin recognizable.
- **Agents**: roster as agent cards (avatar/role/autonomy/skills); detail keeps its 5 tabs, glass.
- **Build Team / Team Composer**: wizard steps as glass panels, strong CTA; canvas + side panel glass.
- **Skills**: visual library grid, category/risk/approval badges, glass filters + drawer.
- **Knowledge**: prominent search, source cards, tag chips, professional VAULT_DIR empty state.
- **KPIs/Costs/Performance**: MetricCards + existing SVG sparklines; real/derived/estimate labels
  kept; no invented costs.
- **Conversations**: Team Chat prominent, premium chat input, logs quieter, mobile slide-over kept.
- **Audit Log**: compact professional table + glass filter bar + drawer + export; mobile card variant.
- **Config**: grouped glass sections (Fleet/GitHub/Sandbox/Phone/Knowledge/Limits/Security) using the
  existing read-only data; missing-config warnings visible.
- **Login**: glass panel on mesh background.

## 5. Mobile approach

- Bottom nav (5 slots per §2) + grouped More sheet with fleet quick actions (kept).
- All new surfaces stack to one column; touch targets ≥ 44px on decision/mobile actions.
- No horizontal overflow: tables get `overflow-x-auto` + card fallbacks where already patterned.
- Decisions/War Room/Work Items/Dashboard reachable in ≤ 1 tap; pending count on nav + topbar (kept).

## 6. Execution order

1. `globals.css` tokens/classes + `ui/glass.tsx` + polish `ui/*` primitives (shared, done first).
2. Shell (sidebar groups, topbar) + mobile nav.
3. Dashboard (header, command strip, metrics, board, cards, filters).
4. Parallel per-screen sweeps using ONLY the shared classes/components (disjoint file sets).
5. `npm run build` + lint + `node --test` suite; fix all errors; route smoke.
6. `docs/ui-polish.md` + this plan updated with outcomes.

Hard rules for every sweep: dark glass only (no white cards), subtle glow (no neon), data-driven
(no Roy/slipbase hardcoding), keep all props/handlers/API calls identical, keep focus states,
respect reduced-motion.
