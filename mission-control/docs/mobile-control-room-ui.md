# Mobile control room + design-token cleanup

Mission Control is now usable from a phone as a command center, and the visual inconsistencies (light
components clashing with the dark theme) are gone. The desktop sidebar flow is untouched; the change is
additive — no routes removed, no big rewrite.

---

## Mobile navigation

- **Bottom nav** (`components/shell/mobile-nav.tsx`, phones only — `md:hidden`): **Dashboard · Decisions ·
  War Room · Agents · More**. Active tab is emerald with a top marker; the Decisions tab carries the live
  pending-approval badge.
- **"More" bottom-sheet**: secondary destinations — **Tasks** (the kanban board), **Conversations**,
  **Knowledge**, **Config**, **Phone Command setup** — plus **fleet quick-actions** (Start / Pause / Stop)
  and the live fleet status.
- **Desktop sidebar** keeps working exactly as before (it just gained the War Room + Agents entries).

> Mapping note: this app has one kanban board that serves as both "Dashboard" and "Tasks", so the board is
> the Dashboard tab and also appears as "Tasks" in the More sheet. "War Room" is the live `/workers` lanes.

## Mobile topbar

The header (`components/shell/app-shell.tsx`) is now mobile-first:
- **Fleet status dot** (online/offline) on phones (desktop shows it in the sidebar).
- **Open-decisions count** pill → links to the Decision Inbox.
- **Quick pause/resume** toggle (one tap; CAS write to `fleet.json`).
- **Phone Command setup** shortcut (→ `/config#phone`).
- ⌘K is hidden on phones (no keyboard); New-task stays.

## New: Agents screen

- `GET /api/agents` (session-gated) + read-only `/agents` page — the config-driven team roster (role,
  name, enabled, model/effort/depth, blocking, skills, tools, label scope, review-of-roles). Editing/CRUD
  is a later step; this gives the nav a real destination and makes the team visible.

---

## confirm/prompt flows replaced with real modals

All `window.confirm` / `window.prompt` are gone, replaced by one dark, promise-based modal
(`components/ui/confirm.tsx` → `useConfirm()`), mounted once via `<ConfirmProvider>` in the app shell.
Dangerous actions can require a typed **challenge** word.

| Where | Was | Now |
|---|---|---|
| Task card — Cancel | `confirm()` | dark confirm (danger) |
| Task card — Merge a **rejected** PR | `window.prompt("type MERGE")` | confirm with **type-MERGE challenge** |
| War Room — Cancel / Kill worker | `confirm()` ×2 | dark confirm (danger) |
| Control bar — Stop fleet | `confirm()` | dark confirm (danger) |
| Control bar — force Opus / high effort / orchestrate | `confirm()` ×3 | dark confirm |
| Knowledge — discard unsaved changes | `confirm()` | dark confirm (danger) |

## Design-token issues fixed (light → dark)

The shared primitives were light-themed (white surfaces, slate hexes) and clashed on the dark app:
- **`ui/button.tsx`** — every variant re-themed dark (translucent whites + emerald accent), same
  variant/size names so all call sites keep working.
- **`ui/input.tsx`** — dark surface, emerald focus ring.
- **`ui/dialog.tsx`** — dark content/title/description/close (was `bg-white`).
- **`task-card.tsx`** — was fully light (`bg-white`, `text-[#0F172A]`, `bg-[#F1F5F9]`, `bg-red-50`); now
  dark with translucent chips + emerald/indigo accents.
- **`new-task-dialog.tsx`** textarea, **`login`** page card — de-whitened.
- New canonical primitives: **`ui/badge.tsx`** (tone-based) and **`ui/empty-state.tsx`**.

## Responsive passes

- **app-shell `main`** reserves space for the bottom nav (`pb-20 md:pb-0`); full-height views
  (`chat`, `knowledge`) subtract the nav on phones (`max-md:h-[calc(100dvh-8.5rem)]`).
- **Conversations** — the conversation list was `hidden sm:flex` (no way to switch/create chats on a
  phone!); it is now a **slide-over** with a mobile top bar (open list / new chat).
- **Knowledge** — the 288px rail + editor side-by-side is now **one pane at a time** on phones, with a
  back button.
- **Dashboard / board / War Room / Approvals / Agents / Config** — already grid/flex-wrap based; verified
  they stack cleanly and clear the bottom nav.

---

## Tests / build commands to run

```bash
cd mission-control
npm run build                                                   # typecheck + production build (Turbopack)
node --test --experimental-sqlite lib/approvals-view.test.ts    # decision-inbox view-model + flow (5)
node --test --experimental-sqlite lib/approvals.test.ts         # durable approvals (8)
node --test lib/phone.test.ts                                   # phone layer (9)
```

**Visual testing:** there is no automated visual/Playwright tooling wired into this repo yet, so no
screenshots are generated. Manual phone check (DevTools 390×844 or a real phone over the tunnel):
bottom nav switches screens · More sheet opens with fleet quick-actions · Decisions badge shows the
pending count · Conversations slide-over + new chat work · Knowledge list↔editor back button works ·
Cancel/Merge-rejected/Stop show the dark modal (no browser confirm) · no white cards anywhere.
