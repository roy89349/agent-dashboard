# Phone Command Interface

Control the Mission Control agent fleet from your phone via one chat app. **Provider: Telegram.**

## 1. Why Telegram

There is no existing WhatsApp Business / Twilio setup, and Telegram is the fastest, most reliable
path to a working MVP: a bot is created in seconds (BotFather), it needs only a bot token + your
chat id (no business verification / number provisioning), it has first-class **inline buttons** for
approvals, and a dead-simple webhook. WhatsApp can be added later by implementing the same
`PhoneProvider` interface in `lib/phone/whatsapp.ts` and wiring it in `lib/phone/index.ts`.

The chat app is **only transport/UI**. The backend stays the source of truth: every action is
validated server-side, written through the existing declarative control-plane (`control/fleet.json`,
`commands.jsonl`) or the validated `lib/*` services, redacted, and audited. **No shell-out, ever.**

## 2. Setup

1. In Telegram, message **@BotFather** → `/newbot` → pick a name + username → copy the **bot token**.
2. Get **your chat id**: message your new bot anything, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id` (a number).
3. Set the env vars (below) in `mission-control/.env.local` on the server and restart the dashboard service.
4. Set the webhook (below).
5. In the dashboard → **Config → Phone command interface**, click **Send test message**. You should
   get a message on your phone. Send `/help`.

## 3. Env vars (`mission-control/.env.local`)

| var | required | meaning |
|---|---|---|
| `PHONE_COMMAND_PROVIDER` | no (default `telegram`) | `telegram` (only one implemented) |
| `TELEGRAM_BOT_TOKEN` | **yes** | from BotFather |
| `TELEGRAM_ALLOWED_CHAT_ID` | **yes** | the ONLY chat id allowed to run commands |
| `TELEGRAM_WEBHOOK_SECRET` | recommended | random string; verified on every webhook call |
| `MC_PUBLIC_URL` | recommended | public https base of the dashboard (for the webhook URL + "Open dashboard" buttons) |

If unset, the app does **not** crash: the dashboard works, and Config shows a clear setup error.

## 4. Webhook setup

The webhook route is **`POST /api/integrations/telegram/webhook`** (public — it authenticates itself
via your chat id + the optional secret). Expose the dashboard over https (Tailscale Serve / a tunnel
/ a domain) and register it once:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=<MC_PUBLIC_URL>/api/integrations/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

The dashboard binds to `127.0.0.1` only; if it isn't publicly reachable, put the webhook behind your
existing https entry (Tailscale Funnel / reverse proxy). The Config screen shows the exact URL.

## 5. Commands

```
Status:   /status  /fleet  /agents  /tasks  /prs  /decisions
Control:  /pause  /resume  /start  /stop  /breaker_reset
Tasks:    /task <text>   /prompt <text>   /goal <text>
Roles:    /assign <role> <text>   /frontend <text>   /backend <text>   /qa <text>   /security <text>   /manager <text>
Work:     /continue <issue>   /cancel <issue>   /priority <issue> high|normal|low
Help:     /help
```
Any non-command message is treated as a message to the Manager: the bot replies *"make this a
task?"* with buttons **Create task · Ask manager first · Frontend · Backend · QA · Cancel**.

## 6. How I do things from my phone

- **Status check:** `/status` (fleet + workers + breaker + pending approvals), `/tasks`, `/prs`, `/agents`.
- **New prompt/task:** `/task add a dark-mode toggle` → creates an `agent-ready` issue → the fleet builds it.
  Or just type the idea → tap **Create task** (or assign it to a role).
- **Steer an agent:** `/frontend fix the mobile navbar` (creates a task labelled for that role).
- **Give an approval:** when an agent needs sign-off you get a message with **Approve / Reject /
  More info / Let manager decide / Pause task / Open dashboard** buttons. Tap one — it's validated +
  executed server-side and you get a confirmation.
- **Pause/resume the fleet:** `/pause`, `/resume`. `/stop` asks for a one-tap confirmation (it halts work).
- **Continue / reprioritize:** `/continue 42`, `/cancel 42`, `/priority 42 high`.

## 7. Security model

- **Only `TELEGRAM_ALLOWED_CHAT_ID` may run commands.** `verifySender` is checked before any plan is
  produced; an unknown sender gets nothing sensitive and no action runs (logged as `phone.unauthorized`).
- Optional **webhook secret** header is verified on every call.
- **Approvals** carry a one-time **decision token**, stored only as a **sha256 hash**; tokens are
  single-use and expire. Decisions are **idempotent** (repeat = same result; conflicting = 409);
  expired/invalid tokens are refused.
- **Dangerous commands require confirmation** (e.g. `/stop` opens a confirm approval). High-impact
  approvals (`merge`, `cap_increase`, `force_opus`, `deploy`, `secret_access`) only execute via the
  validated `lib/*` paths in `lib/phone/actions.ts`.
- **Redaction:** every outbound message + stored preview runs through `lib/redact.ts`; full sensitive
  diffs are never sent to the phone (truncated preview → "open the dashboard").
- **commands.jsonl / fleet.json are only written after server-side validation** (route → authorize →
  execute). The chat never reaches a shell; raw user text never touches a shell.
- Every command + decision is written to the SQLite **`audit`** table.

## 8. Test commands

```bash
# unit (deterministic): approvals (CAS/token/expiry/idempotent/redaction) + phone (router/auth/parse)
node --test --experimental-sqlite mission-control/lib/approvals.test.ts
node --test mission-control/lib/phone.test.ts

# end-to-end (after BotFather + webhook): send /help, /status, then a message and tap "Create task";
# create an approval from the dashboard (POST /api/approvals) → it lands on your phone with buttons.
```

## 9. Known TODOs

- Full **Decision Inbox** screen in the dashboard (approvals are currently shown as a count in Config +
  available via `GET /api/approvals`; decisions also arrive on the phone).
- The **Manager "make this a task?"** flow is deterministic (buttons) — wiring the actual Manager LLM
  to phrase/triage is a follow-up.
- WhatsApp provider (`lib/phone/whatsapp.ts`) — implement the same interface if/when a Business/Twilio
  number exists.
- Optional **reject-reason prompt** on the phone (currently reject is one tap; reason optional via API).
- Rate-limiting inbound webhook calls (Telegram is already restricted to one chat id).
