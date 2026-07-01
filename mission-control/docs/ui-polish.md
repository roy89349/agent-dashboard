# UI Polish — Liquid Glass design direction

Mission Control's UI language is **liquid glass on a dark luxe background**: translucent blurred
panels with a top-edge highlight, soft deep shadows, quiet functional glows, and a grouped
navigation. It should read as a high-end AI command center (Linear/Raycast/Vercel calm + Apple
glass depth) — subtle and readable, never neon.

## Design system (single source of truth)

### Tokens & classes — `app/globals.css`
- CSS vars: base palette (`--bg --bg-elev --text --muted --accent --accent-2 --danger --warn`)
  plus glass vars (`--glass --glass-strong --glass-border --glass-highlight --glass-shadow`).
- Background: three fixed radial mesh orbs (indigo / emerald / violet) at low intensity.
- Surface classes:
  - `.glass` — page-level panel: blur(14px), 1px translucent border, inset top highlight, deep
    soft shadow, `rounded-2xl`.
  - `.glass-card` — smaller unit: blur(10px), `rounded-xl`, lighter shadow.
  - `.glass-inset` — recessed well (kanban columns, timelines, log tails, meta tables, canvases).
  - `.glass-hover` — add to any clickable card/row: border + bg lift + deeper shadow on hover.
  - `.glass-overlay` — dialogs, drawers, sticky action bars, command palette: blur(20px), strong.
  - `.glow-ok / .glow-warn / .glow-danger / .glow-info` — quiet 1px ring + faint bloom for
    ACTIVE states only (selected card, tripped breaker, pending approval, offline fleet).
- Chrome: thin scrollbars, emerald `::selection`, global `:focus-visible` ring, styled `kbd`.
- Motion: `mc-fade-in`, drawer/overlay keyframes; **`prefers-reduced-motion` collapses all
  animations/transitions** globally.

### Status colors (functional, everywhere)
- **emerald** = running / success / online / allowed
- **red/rose** = failed / danger / offline / denied
- **amber** = waiting / warning / approval-required / estimates-warnings
- **indigo** = info / review / planning / AI

### Reusable components — `components/ui/glass.tsx`
- `PageHeader` — title + status subtitle + right-aligned actions.
- `GlassPanel` / `GlassCard` — thin wrappers over the classes.
- `MetricCard` — label / value / hint / icon / tone / optional `href`.
- `SectionLabel` — small uppercase tracking label for section headings.

Existing primitives that are part of the system (keep canonical, don't fork): `ui/button`,
`ui/badge` (Badge + BADGE_TONE), `ui/dialog`, `ui/drawer`, `ui/confirm`, `ui/empty-state`,
`ui/input`, `fleet/agent-meta` (AgentIdentity/RiskBadge/WaitingBadge), `skills/risk-badge`.

## Navigation structure

Desktop sidebar (`components/shell/app-shell.tsx`) is grouped with section headings — same
routes, visual grouping only:

- **Command**: Dashboard · War Room · Decisions · Work Items · Workflows
- **Team**: Manager · Agents · Build Team · Team Composer · Skills
- **Intelligence**: Knowledge · KPIs · Costs · Performance
- **Communication**: Updates · Conversations · Phone (`/config#phone`)
- **System**: Audit Log · Config

Active item = glass pill (border + inset highlight + faint emerald glow) + emerald icon + left
accent bar. `/workers` (Worker Lanes) and `/chats` stay reachable via More sheet / ⌘K / links.

Mobile (`components/shell/mobile-nav.tsx`): bottom nav **Dashboard · Decisions · War Room ·
Work Items · More**; the More sheet mirrors the 5 sidebar sections and keeps the fleet
Start/Pause/Stop quick actions and the pending-decisions badge.

## Dashboard composition (`app/(app)/page.tsx`)

1. `PageHeader` "Mission Control" + status subtitle + quick actions (Decisions, Ask manager;
   New task lives in the topbar).
2. `ControlBar` command strip (glass) — online/offline chip with functional glow, stats, knob
   steppers/selects as glass cards, Start/Pause/Stop.
3. `MetricsRow` (`components/fleet/metrics-row.tsx`) — 6 MetricCards from the existing
   `/api/war-room` health payload (active agents, open decisions, running workflows, blockers,
   PRs ready, budget), each linking to its screen. Polls 15 s, pauses on hidden tab.
4. Glass filter toolbar (FilterBar + Refresh).
5. Kanban board — columns as `.glass-inset` with tinted counters (Backlog neutral, Building
   indigo, Review amber, Done emerald); cards as `.glass-card .glass-hover` with clear
   hierarchy (title → agent identity → chips → actions).

## Per-screen summary of what changed

All sweeps were **visual only** — no props, handlers, fetch/streaming calls, routes or exports
changed; unit-test suite unchanged (184/184 pass).

- **War Room** — glass health tiles with functional glows (breaker/blockers → danger, decisions
  → warn, PRs → ok), agent grid as hover-glass cards with amber/red accents for
  waiting-on-you/blocked, timeline in a glass inset with severity-tinted titles.
- **Decisions** — PageHeader with live count, scannable glass cards, "Why am I being asked?"
  section (risk + advice), glass-inset meta/diff, sticky glass approve/reject bar (44px targets).
- **Worker Lanes** — lanes as glass cards, `glow-warn` for awaiting-approval, mono log tail in
  a glass inset.
- **Work Items** — glass cards with `glow-ok` selection, handoff timeline with a visual thread
  line, parent/child "Related tasks" with connectors, amber-glass plan-only section.
- **Workflows** — stepper as glass nodes with gradient connector; waiting/blocked steps get
  amber glow, failed red; approval-gate chip explicit; activity log in a scrollable inset.
- **Manager** — planning cockpit: state-grouped plan cards, "Awaiting decision" amber section,
  44px approve/adjust/reject, compose dialog with inset subtask well.
- **Updates** — day-grouped summaries with type chips, Urgent section (amber glow), glass Ask-
  the-team box, phone-origin chip.
- **Agents** — roster of avatar glass cards (status dot, role, chips); detail tabs as a premium
  segmented control; memory/feedback items as cards.
- **Build Team** — glowing step indicator, template cards with selected `glow-ok`, review step
  as glass sections, strong emerald Create CTA.
- **Team Composer** — canvas as a recessed glass well, glass agent nodes with selection glow,
  glass side panel/dialogs; drag/pan/zoom/edge math untouched.
- **Skills** — glass library grid (category/risk/approval/roles chips), glass filter bar,
  polished detail drawer.
- **Knowledge** — prominent glass search, source cards with tag/access chips, professional
  EmptyState for a missing `VAULT_DIR`.
- **KPIs / Costs / Performance** — MetricCard tiles, gradient bars, avatar leaderboard; all
  real/derived/estimate labels and the estimates banner preserved (no invented costs).
- **Conversations / Chats** — Team Chat visually primary, glass segmented tabs, subtle-glass
  assistant vs emerald-tint user bubbles, premium chat input, quieter agent-log timeline,
  day-grouped summaries.
- **Audit Log** — glass table panel with `overflow-x-auto`, Badge chips for risk/status/source,
  glass filter toolbar, redaction chips, tidy export buttons.
- **Config** — grouped into Fleet / GitHub / Sandbox / Phone / Knowledge / Limits / Security via
  SectionLabels; values as mono config cards; missing values get amber chips; `#phone` anchor kept.
- **Login** — centered glass panel on the mesh background.
- **Shell extras** — glass topbar, glass-overlay command palette with icon-chip rows, glass
  new-task dialog.

## Mobile approach

- Bottom nav (5 slots) + grouped More sheet with fleet quick actions and decisions badge.
- Everything stacks to one column; primary actions ≥ 44px; wide tables scroll inside their panel
  (no page-level horizontal overflow); Conversations/Knowledge keep their slide-over/one-pane
  patterns; drawers stay bottom-sheets on phones.

## How future screens should follow the style

1. Page container: `p-4 sm:p-5 space-y-4`; start with `PageHeader` (informative subtitle,
   actions right).
2. Surfaces: `.glass` for the page's main panels, `.glass-card` (+ `.glass-hover` when
   clickable) for units, `.glass-inset` for recessed content (tables, logs, timelines).
3. State: status colors above; `glow-*` ONLY for active/attention states; `Badge` for chips;
   `EmptyState` for empty screens; `useConfirm()` instead of `window.confirm`.
4. Never a light/white surface; no new hardcoded hex colors — use the tokens.
5. Keep 44px touch targets for primary mobile actions and let content stack.

## Verified

- `npx next build` — green (all 20+ routes compile).
- `npx tsc --noEmit` — clean.
- `node --test lib/*.test.ts` — **184/184 pass**.
- Live smoke (production server + session login): all 21 routes + `/agents/[id]` → HTTP 200.
- No eslint config exists in this project (no lint script) — build + tsc are the gates.

## Known TODOs

- Desktop sidebar has no collapsed/icon-only mode yet (considered; skipped to avoid layout risk).
- Remaining solid `bg-white` occurrences are toggle-switch thumbs only (intentional).
- Decision Inbox still polls (no SSE); War Room budget tile is a placeholder until real token
  usage lands (pre-existing gaps, out of scope for the polish).
- FilterBar could get facet-chip styling (kept functional-minimal).
- This polish is deployed locally only until committed + pulled on the VPS.
