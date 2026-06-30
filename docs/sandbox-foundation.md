# Sandbox Foundation — isolating the build agent

The build agent runs **untrusted input** (GitHub issue text) with `claude -p --dangerously-skip-permissions`.
Without isolation, prompt-injection in a task could read your GitHub token, `~/.claude` credentials,
`config.local.env` or `.env` files, or run arbitrary commands on the host. This foundation puts the
**code-executing** part of a build inside a rootless **Podman** sandbox, while the parts that need
secrets (git push, PR creation) stay **outside** in the orchestrator (`worker.sh`) — the
*credential-broker* pattern.

This is the safety prerequisite for adding more agent roles: every role that executes model-driven
code reuses this same sandbox.

---

## How it works

```
worker.sh  (HOST, trusted orchestrator)
  ├─ git worktree add               (host)
  ├─ write the prompt to a file     (host)
  ├─ deploy/sandbox/run-build.sh ───────────────► Podman container  (UNTRUSTED agent)
  │      mounts ONLY:  the worktree (rw) · the prompt (ro) · pipeline.sh (ro)        │
  │      passes ONLY:  a SHORT-LIVED Claude access token (env)                       │
  │      runs as:      a non-root uid (userns=keep-id) → can write the worktree,     │
  │                    and claude accepts --dangerously-skip-permissions             │
  │      pipeline.sh:  npm ci → claude -p (build) → npm install if deps changed →    │
  │                    green-gate ($GREEN_CMD)                                       │
  │      returns:      exit 0=green ok · 21/22=install fail · 23=green-gate fail      │
  ◄──────────────────────────────────────────────────────────────────────────────────┘
  ├─ git add -A + secret-gate        (host — reads files, never executes them)
  └─ commit · git push · gh pr create (host — uses the GitHub PAT the agent never sees)
```

Key files (`deploy/sandbox/`):

| File | Role |
|---|---|
| `Containerfile` | the image: `node:22-slim` + `@anthropic-ai/claude-code` + `git` + `ripgrep` |
| `build-image.sh` | `(re)build the image` → `$SANDBOX_IMAGE` |
| `pipeline.sh` | runs **inside** the container (trusted, mounted read-only): install → agent → green-gate |
| `run-build.sh` | host wrapper: derives the token, launches the container with the right mounts/network |
| `selftest.sh` | proves isolation (see below) |
| `run-agent-sandbox.sh` (repo root `deploy/`) | the original **template** this foundation grew from — kept for reference |

The orchestrator picks sandbox-vs-host in `worker.sh` (`build_on_host` is the fallback).

---

## What is and isn't visible to the agent

**NOT visible inside the container** (verified by `selftest.sh`):

- `~/.claude/.credentials.json` — your Claude Max credentials (access **and** refresh token)
- `~/.config/gh/hosts.yml` — the GitHub PAT used for push/PR
- `config.local.env`, `mission-control/.env.local` — per-install config & secrets
- any host `.env` file, your `$HOME`, SSH keys — the container filesystem is the image's, **only the
  worktree is mounted**
- `gh` / git credentials — `gh` isn't even installed in the image; the agent cannot push

**Visible / available inside the container** (by design):

- the **worktree** of this one task (rw) — the code being changed (it ends up in a PR you review anyway)
- a **short-lived Claude access token** via `CLAUDE_CODE_OAUTH_TOKEN` — used only to talk to Anthropic.
  The refresh-capable creds stay on the host; the host's router/reviewer calls keep the token fresh.
- the prompt for this task (read-only)

> Not yet enforced: an **egress allowlist** (restrict the container to Anthropic + npm only). Until
> added, a determined agent could exfiltrate the worktree source or the short-lived token — but
> **not** the GitHub PAT or host access. Tracked as a follow-up.

---

## Configuration (all in `config.env`, override in `config.local.env`)

| Variable | Default | Meaning |
|---|---|---|
| `FLEET_SANDBOX` | `on` | `on` = build in the sandbox (requires podman). `off` = build on the **host** (NO isolation — local dev only). |
| `SANDBOX_IMAGE` | `localhost/fleet-sandbox:latest` | image used for the agent step (build with `build-image.sh`) |
| `SANDBOX_NET` | `pasta` | container network (rootless default) |
| `CLAUDE_SANDBOX_TOKEN` | *(empty)* | explicit standalone Claude token for the container. Empty = derive a short-lived one from `~/.claude`. Put real values only in `config.local.env`. |

Nothing is hardcoded — image, network, token source and the on/off switch are all config.

- **Server (24/7):** keep `FLEET_SANDBOX=on` (the default). `deploy/bootstrap.sh` installs podman.
  A system **systemd** service additionally needs `loginctl enable-linger fleet` and
  `XDG_RUNTIME_DIR=/run/user/<uid>` (already set in `deploy/dev-fleet.service`) for rootless podman.
- **Local dev without podman:** set `FLEET_SANDBOX=off` in your `config.local.env`. The build then
  runs on the host (the old inline behavior) so you can still develop — at the cost of isolation.

---

## How to test

### 1. Isolation self-test (run this first — must PASS before 24/7)

```bash
cd ~/agent-dashboard            # or your clone dir
deploy/sandbox/build-image.sh   # only needed once / after Containerfile changes
deploy/sandbox/selftest.sh
```

Expect: `✅ PASS — host secrets … are invisible, gh is absent, and Claude auth works.`
If you see any `LEAK:` line, do **not** run the fleet 24/7 — the sandbox isn't isolating.

### 2. End-to-end (the real issue→PR flow still works)

```bash
# create a tiny throwaway task
gh issue create --repo <owner>/<repo> --label agent-ready \
  --title "docs: sandbox smoke test" --body "Append one line '<!-- sandbox ok -->' to README.md. Change nothing else."

# run ONE supervised pass (does not require the 24/7 service)
./supervisor.sh --once

# verify a PR was opened, then clean up
gh pr list --repo <owner>/<repo> --state open
```

Expect: the worker logs `🛠 building in sandbox …`, a PR is opened with only the README change, and
the reviewer comments. Close the PR + issue afterwards.

### 3. Confirm the host fallback (optional, dev machines)

```bash
FLEET_SANDBOX=off ./supervisor.sh --once
```

Expect: the worker logs `⚠️ FLEET_SANDBOX=off — building ON THE HOST …` and still produces a PR.
Use only where you accept no isolation.
