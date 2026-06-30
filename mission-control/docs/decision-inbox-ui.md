# Decision Inbox (dashboard UI)

The dashboard half of the durable-approvals system. The phone (Telegram) is **fast**; the dashboard is
the **full context**. Both read and write the *same* approvals store, so a decision made on either side
is instantly reflected on the other.

> Approvals are created by agents / API. The Decision Inbox lets you triage them with full context:
> kind, risk, target, summary, agent advice, the redacted diff, the phone-notification status, and the
> complete audit trail — then Approve / Reject / Pause / defer to the manager.

---

## What was built

**Page** — `app/(app)/approvals/page.tsx` (route `/approvals`, title "Decision Inbox").
- Mobile-first dark cards (control-room theme — no white cards on dark).
- Two tabs: **Pending** (default) and **History** (approved / rejected / expired), each with a live count.
- Each card shows: kind label, risk badge, summary, target (`PR #` / `issue #` / work-item), agent,
  created-relative time, and either a live **expiry** countdown (pending) or the decision provenance.
- **Big Approve / Reject buttons** directly on each pending card for one-tap triage.
- Tap a card → **detail drawer** (bottom-sheet on phones, right side-panel on desktop) with the full
  redacted context, `diff_preview`, agent advice, risk, **phone-notification status**, and **audit trail**.
- Empty state: **"No decisions waiting."**
- A reason textarea (optional) is recorded with Reject / Pause — **no `window.confirm` / `window.prompt`**.

**Nav / topbar** — `components/shell/app-shell.tsx`
- New **Decisions** sidebar item with a live **pending-count badge**.
- A "**N waiting**" pill in the topbar (visible on mobile where the sidebar is hidden), links to `/approvals`.
- ⌘K command palette gains a **Decision Inbox** entry.

**Drawer component** — `components/ui/drawer.tsx`
- Dark, accessible drawer built on `@radix-ui/react-dialog` (focus-trap, Esc, scroll-lock). Bottom-sheet
  on phones, side-panel on desktop. This is separate from the light `ui/dialog.tsx`.

**View-model (pure, shared & tested)** — `lib/approvals-view.ts`
- `approvalView(row, now?)` maps a server row → all derived display fields (kind label, risk level + tone,
  target, status, relative/expiry times, notification ids). No server imports, so it is unit-testable and
  safe in the client bundle.

---

## APIs used

| Method & path | Purpose | Auth |
|---|---|---|
| `GET /api/approvals` | list all approvals (newest 100) | session |
| `GET /api/approvals?status=pending` | pending only (used by the nav badge) | session |
| `GET /api/approvals/[id]` | one approval + its **audit trail** + **phone-notification status** | session |
| `POST /api/approvals/decide` | decide: `approve` \| `reject` \| `pause` \| `manager` | session (trusted) or one-time token* |
| `POST /api/approvals` | create an approval (also best-effort pushes it to the phone) | session |

\* A bare one-time decision **token** (the phone-button path) may only ever authorize the *safe* verbs
`approve` / `reject`. `pause` / `manager` require a dashboard session.

**Decision verbs**
- **Approve** → `decideApproval(approve)` then runs the approval's validated `action_json` via
  `runApprovalAction()` (merge / create_task / cap_increase / … / `noop` for sign-offs).
- **Reject** → `decideApproval(reject)` with the optional reason.
- **Pause task** → `decideApproval(reject)` **and** `appendCommand({cmd:"cancel", issue})` — mirrors the
  phone's Pause button. Only offered when the approval has an issue/PR.
- **Let manager decide** → records an audit note and leaves the approval **pending** (no decision).
- **Open PR/issue** → external GitHub link (built from the configured repo).

---

## How dashboard & phone work together

```
            agent / API  ──create──▶  approvals store (SQLite: approvals + audit)
                                           ▲              ▲
                                           │              │
        POST /api/approvals/decide  ───────┘              └─────── Telegram webhook
        (decided_via = "dashboard")                                (decided_via = "telegram")
                                           │
                                  decideApproval()  ← single source of truth
                                  (idempotent · expiry · hashed single-use token · audited)
```

- **One store, one decision function.** Both surfaces call the same server-side `decideApproval()`.
  There is **no client-side shortcut** — the UI only POSTs; all validation, auth, idempotency, expiry and
  audit happen on the server.
- **Idempotent & race-safe.** If you approve on the phone and then open the dashboard, the row already
  shows *Approved* (via Telegram). Re-deciding the same way is a no-op; a *different* decision returns 409;
  an expired one returns 410. The dashboard list polls every 8 s, so decisions made anywhere appear quickly.
- **`decided_via`** records where each decision came from (`dashboard` / `telegram` / `api` …) and is shown
  on the card and in the detail drawer.
- **Redaction.** Secrets are stripped at creation (`lib/redact.ts`); the diff is truncated. Nothing the
  dashboard renders contains live secrets.
- **Safety.** No dangerous action is approved by a UI-only confirm: approving runs only the pre-declared,
  server-validated `action_json`; the dashboard never composes a new action from client input.

---

## Commands & tests to run

```bash
cd mission-control

# unit tests (pure view-model + approve/reject flow + expired state, against an isolated temp db)
node --test --experimental-sqlite lib/approvals-view.test.ts

# the rest of the approvals + phone suite
node --test --experimental-sqlite lib/approvals.test.ts
node --test lib/phone.test.ts

# typecheck + production build
npm run build
```

Open the dashboard over the SSH tunnel (`ssh -L 3000:127.0.0.1:3000 fleet@<vps>` → http://localhost:3000)
and visit **Decisions** in the sidebar.
