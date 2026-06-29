# Mission Control — autonomous dev-fleet

Point it at **your** GitHub repo, fill the backlog, and a fleet of autonomous coding agents
builds each task in parallel — in isolated git worktrees, gated by your build, reviewed by a
second agent — and opens a pull request for you to review and merge. A premium dashboard lets
you steer the fleet (how many agents, which model, which effort), watch live who's doing what,
chat with an orchestrator that knows your codebase, and resume past conversations.

`main` is never touched directly — every change arrives as a PR.

```
GitHub issue (label: agent-ready)
  └─ supervisor.sh claims it → agent-wip        (up to MAX_WORKERS in parallel)
       └─ worker.sh: worktree off origin/main, own branch
            ├─ model routing   (haiku classifier → sonnet or opus) + effort
            ├─ Claude Code builds headless
            ├─ secret gate + green gate ($GREEN_CMD must pass)
            ├─ commit + push + open PR                 → agent-done
            └─ reviewer agent comments on the PR (✅/⚠️/❌)
       └─ live telemetry → control/status.json + logs + SQLite
       (red → label agent-failed; retry from the dashboard)
```

## Requirements
- **Node.js 22.5+** (24+ recommended) — the dashboard uses the built-in `node:sqlite`, no native build.
- **[Claude Code CLI](https://code.claude.com)** — installed and signed in (`claude` once). The agents run via `claude -p`.
- **[GitHub CLI](https://cli.github.com) (`gh`)** — signed in; the fleet uses it for issues/branches/PRs.
- **A GitHub repo** you want the agents to work on (any stack; set its build command).
- *(optional)* **ripgrep** for fast knowledge-base retrieval; an Obsidian/markdown vault for context.

## Quick start
```bash
git clone <this-repo> mission-control && cd mission-control
./setup.sh                       # asks for your repo, paths, build command, password; writes config + secret
cd mission-control && npm run dev   # dashboard → http://localhost:3000  (log in)
# in another terminal, from the repo root:
./supervisor.sh                  # run the fleet once through the backlog   (./loop.sh = 24/7)
```
Add work: create GitHub issues labelled **`agent-ready`**, or click **New task** in the dashboard.

## The dashboard (Mission Control)
Runs **co-located** with the fleet (same machine/VPS) and steers the supervisor purely via files
in `control/` — never by exec'ing shells — so it moves 1:1 from local to a server.

- **Dashboard** — fleet status + all live knobs (start/pause/stop, workers ±, daily cap, breaker, model, effort, review).
- **Workers** — live "who's doing what": per worker the issue, model, effort, phase, elapsed time, a stalled flag, and a **live (secret-redacted) log** + kill/cancel.
- **Conversations** — an orchestrator chat that knows the live fleet + your codebase (and optional vault), with **streaming** answers and **resumable** history (SQLite).
- **Knowledge** — browse/search your notes vault *(in progress)*.
- **⌘K** command palette for everything.

## Configuration
- `config.env` — committed defaults (no secrets). Don't edit for per-install values.
- `config.local.env` — your overrides (gitignored, written by `setup.sh`): `REPO`, `REPO_DIR`, `PROJECT_NAME`, `GREEN_CMD`, `VAULT_DIR`, …
- `mission-control/.env.local` — dashboard env (gitignored): `MC_DASHBOARD_PASSWORD`, `MC_SESSION_SECRET`, `FLEET_DIR`, `GITHUB_REPO`, `GITHUB_TOKEN`, …

Hard ceilings the UI can never exceed (`HARD_MAX_WORKERS`, `MAX_ATTEMPTS_PER_DAY`, `ALLOW_GLOBAL_OPUS`, …) live in `config.env` and are enforced server-side.

## Before running 24/7 unattended
Running autonomous agents that push to GitHub and spend tokens needs guardrails: protect `main`,
give the fleet a least-privilege fine-grained PAT, isolate the build agent (rootless container +
egress allowlist), and rotate any secrets. See `deploy/` for a hardening checklist and a systemd/VPS bundle.

## Cost note
Headless `claude -p` runs draw from your Claude plan's Agent-SDK allowance, then API rates — more
agents at higher effort = real cost. The daily caps and circuit breaker in the dashboard exist for this.

## License
MIT — see `LICENSE`.
