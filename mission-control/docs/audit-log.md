# Audit Log

Every important action in Mission Control is traceable: **who/what did it, why, with which approval, via which
channel, at what risk, and whether it was allowed/denied**. The log is append-only and redacted — no secret ever
reaches storage.

---

## Which actions are logged
The trick is one central bridge: **`recordAudit()` (called everywhere already) now also writes a rich
`audit_events` row**, so the entire existing audit surface flows in automatically — no rewrite. That covers agent/
team/skill/config changes, autonomy & budget changes, approvals (requested · approved/rejected/expired), risky
actions denied/allowed, security blocks, PR/merge/deploy decisions, workflows (started/completed/failed), memory
updates, knowledge source add/remove, manager plans approved/rejected, phone commands, notifications, and more (~50
action types). A handful of high-value call sites are **enriched** with structured fields (`status`, `risk_level`,
`related_pr`/`related_work_item_id`): permissions (deny · approval-required · allow), approvals (create · decide),
and the phone webhook (`phone.command` received). New code can also call **`logAuditEvent()`** directly with the
full rich shape.

Each event carries: `actor_type` (user/agent/system/phone/api) · `actor_id`/`actor_label` · `action` ·
`target_type`/`target_id` · `risk_level` · `status` (allowed/denied/pending_approval/approved/rejected/failed) ·
redacted old/new values + details + summary · `related_work_item_id`/`workflow_id`/`approval_id`/`pr`/`issue` ·
`source` (dashboard/phone/telegram/whatsapp/worker/supervisor/api) · timestamps.

## How redaction works
There is **one write path** — `insertAuditEvent()` in `lib/db.ts` — and it runs every free-text/value field through
the **central `redact()` helper** *before* truncating (so a token can't be split to evade the pattern):
`old_value_json`, `new_value_json`, `details_json` (redact + cap 4000), `redacted_summary` (redact + cap 500), and
`actor_label`. The `recordAudit` bridge passes its `detail` through the same path, so even legacy callers are
scrubbed again defensively. Diffs/values are never stored in full — they're redacted and length-capped, so the
audit log can't accidentally contain secrets, tokens, keys, or `.env` contents. `redactAuditDetails()` exposes the
same helper for callers that want to pre-scrub.

## How export works
`GET /api/audit/export?format=json|csv` (session-gated) streams the **currently-filtered** trail as a download.
- **JSON**: `JSON.stringify` of the stored (already-redacted) rows.
- **CSV**: a fixed safe column set; each cell is RFC-4180 escaped (quotes/commas/newlines) **and**
  formula-injection-guarded — a cell starting with `= + - @` (or tab/CR) is prefixed with `'` so spreadsheets can't
  execute it. Capped at 50 000 rows.

The Audit Log page (`/audit`) has the table, filters (actor · action · risk · status · source · date · agent),
full-text search, a detail drawer (with deep links to the approval, work item, workflow, agent, PR/issue), and
JSON/CSV export buttons that honour the active filters.

## Append-only + performance
`audit_events` is **append-only** — there is no UPDATE or DELETE path anywhere; events are only inserted and read.
Reads are indexed (`created_at DESC`, `action`, `actor_id`), filters are parameterised (wildcards escaped), and the
bridge is wrapped in try/catch so audit logging can never break the action it records.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/audit.test.ts   # append+read, secret REDACTED out of old/new/details,
                                                      # recordAudit bridge (inferred fields), filters (prefix/
                                                      # status/source/agent/date/search), pagination+total,
                                                      # JSON+CSV export incl. formula-injection guard
node --test --experimental-sqlite lib/*.test.ts       # full suite → 183 green
npm run build                                         # typecheck + Turbopack build → clean
```
