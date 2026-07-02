# Multi-repo support — shell half

The fleet can build issues from **extra GitHub repos** next to the primary one. This document
covers the shell side (`lib.sh` / `worker.sh` / `supervisor.sh`); the dashboard side lives in
`docs/multi-repo-dashboard.md` (written by the dashboard half).

**Sellability rule:** with no `repos.json` present, every script behaves **byte-identically** to
the single-repo fleet. Multi-repo is pure opt-in; nothing in the primary flow is renamed.

## The registry: `$REPOS_FILE`

Default path: `$CONTROL_DIR/repos.json` (override with `REPOS_FILE=` in `config.local.env`).

```json
{
  "rev": 3,
  "repos": [
    {
      "id": "tapsafe",
      "repo": "owner/name",
      "dir": "/abs/clone/path",
      "name": "TapSafe",
      "desc": "NL familie-app, Expo + Supabase",
      "green_cmd": "npm run build",
      "enabled": true
    }
  ]
}
```

| field | required | rules |
|---|---|---|
| `id` | yes | slug `^[a-z0-9][a-z0-9-]{0,31}$`; anything else ⇒ entry skipped with a stderr warning |
| `repo` | yes | GitHub `owner/name` (must contain `/`) |
| `dir` | yes | absolute path to a local clone of `repo` whose `origin` remote pushes to it |
| `name` | no | project name for agent prompts; defaults to `id` |
| `desc` | no | short stack/context for agent prompts; defaults to empty |
| `green_cmd` | no | per-repo green gate; empty ⇒ falls back to the global `GREEN_CMD` |
| `enabled` | no | `false` ⇒ not claimable (in-flight tasks still resolve); missing ⇒ treated as `true` |

Invalid entries are **skipped, never fatal**: a broken/unparseable file simply means
single-repo mode (a warning is printed to stderr by `repos_list`).

### Precedence

- The **primary repo is NOT in this file.** It stays `REPO` / `REPO_DIR` / `PROJECT_NAME` /
  `PROJECT_DESC` / `GREEN_CMD` from `config.env` / `config.local.env`, with all legacy names.
- Claiming order: **primary day queue → secondary repos in file order → night queue
  (primary-only)**. Primary `agent-ready` issues always win.
- Same labels everywhere: `agent-ready` (`LABEL_READY`), `agent-wip`, `agent-done`,
  `agent-failed`, `agent-cancelled` — create them in each secondary repo.

## The claim string

`claim_next` (lib.sh) hands the worker a **claim string**:

| repo | claim string | example |
|---|---|---|
| primary | bare issue number | `42` |
| secondary | `<id>#<n>` | `tapsafe#7` |

Helpers: `claim_repo_of <claim>` → repo id (empty for primary), `claim_issue_of <claim>` → number.
`worker.sh <claim>` and `dispatch.sh` accept both forms transparently.

## Namespacing (secondary repos only)

The primary repo keeps every legacy name, so nothing existing breaks.

| artifact | primary (unchanged) | secondary |
|---|---|---|
| state file | `state/issue-<n>.json` | `state/issue-<id>--<n>.json` |
| branch | `agent/issue-<n>-<slug>` | `agent/<id>/issue-<n>-<slug>` |
| worktree | `worktrees/issue-<n>` | `worktrees/<id>--issue-<n>` |
| logs (`.agent/.gate/.run/.prompt`) | `logs/issue-<n>.*` | `logs/issue-<id>--<n>.*` |
| `emit` event data | no `repo` key | every event carries `"repo":"<id>"` |
| heartbeat `worker-<slot>.json` | no `repo` key | extra `"repo":"<id>"` field |
| `status.json` slot | no `repo` key | extra `"repo":"<id>"`, log URL gains `&repo=<id>` |
| pr-visual POST | no `repo` field | extra `-F "repo=<id>"` |
| cancel marker | `control/cancel/<n>` | `control/cancel/<id>#<n>` (see limitations) |

The mechanism: `worker.sh` exports `FLEET_REPO_ID` when the claim is secondary; `emit` and
`push_telemetry` (lib.sh) read it to namespace the state file and tag events. Empty/unset ⇒
exact legacy behaviour.

## Caps: GLOBAL across all repos

`MAX_PR_PER_DAY`, `MAX_ATTEMPTS_PER_DAY`, the circuit-breaker (`FAIL_BREAK` /
`consecutive_fails`) and the night cap all count events from **all repos together** — they read
the single `logs/events.jsonl`. This is the simplest honest model: the caps protect your token
budget and your sanity, and both are global resources. There are no per-repo caps.

## Adding a repo by hand

1. Clone it locally: `git clone git@github.com:owner/name.git /abs/clone/path` (make sure
   `gh` auth can see it and `origin` pushes to it).
2. Create the fleet labels in that repo (`agent-ready`, `agent-wip`, `agent-done`,
   `agent-failed`, `agent-cancelled`).
3. Add the entry to `$CONTROL_DIR/repos.json` (schema above) with `"enabled": true`.
4. Label an issue `agent-ready` in that repo. No restart needed — the supervisor picks it up
   on the next claim tick. (The UI way to do this is the dashboard half.)

To pause a repo, set `"enabled": false` (in-flight tasks finish; nothing new is claimed).

## Limitations (deliberate, documented)

- **Priority queue is primary-only.** `control/fleet.json` `priority[]` entries are plain issue
  ints, so they can only order the PRIMARY repo's queue. Secondary repos are claimed in
  GitHub order (repos in file order). Per-task `fleet.json` `tasks{}` knobs (model/effort/
  depth/role) also key on the bare issue number and therefore only apply to primary tasks;
  secondary tasks use the global router/effort/depth defaults.
- **Night shift is primary-only.** `LABEL_NIGHT` issues are only claimed from the primary repo.
- **Dashboard kill/cancel commands are primary-only.** `commands.jsonl` validates `issue` as an
  int; a secondary slot's key is `<id>#<n>`, so kill/cancel by number safely no-ops for
  secondary tasks (they can still be stopped by TERM-ing the worker pid, which requeues the
  issue). This also means a cancel of primary `#3` can never hit a running `tapsafe#3`.
- **Do not remove a registry entry while one of its tasks is `agent-wip`** — the worker/recovery
  can then no longer resolve the repo. Disable it (`"enabled": false`) instead.
- Secondary PRs target `main` (same as primary).
