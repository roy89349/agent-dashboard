# Phase 0 — Security blockers before 24/7

> These 5 things **must** be done before the fleet may run unattended 24/7.
> They are actions an automated agent cannot/should not do for you: GitHub account settings,
> creating new secrets, and rotating keys. Check them off as you go.
> Until this is done, only run the fleet **manually and supervised** (`./supervisor.sh --once`).

Repo: `<owner/repo>` · Fleet host: VPS · Dashboard: `mission-control/`

---

## 1. Enforce branch protection on `main` 🔴

**Why:** the fleet pushes branches and opens PRs. Without branch protection, a compromised or
runaway agent (or a stolen token) could push straight to `main` or delete it. We want: **PR only**,
no force-push, no delete, and the fleet **cannot merge by itself** (you merge via the dashboard).

> Branch protection / rulesets only work on private repos with **GitHub Pro**. Free account →
> either make the repo **public**, or upgrade to Pro (~$4/mo). Decide deliberately.

- [ ] Decide: make the repo **public** or get **GitHub Pro**.
- [ ] Create a **ruleset** on `main` (Settings → Rules → Rulesets → New branch ruleset):
  - Target branch: `main`
  - ✅ Require a pull request before merging (Required approvals may be 0 — you merge yourself)
  - ✅ Block force pushes
  - ✅ Restrict deletions
  - ✅ Restrict who can push → only you (not the fleet PAT)
- [ ] **Verify:** as a test, try a direct push to `main` with the fleet PAT → it must be
      rejected. (`git push origin main` from a clone using the PAT → "protected branch").

Quick CLI version (optional, requires `gh` logged in as your own account):
```bash
gh api -X POST repos/<owner>/<repo>/rulesets \
  -f name='protect-main' -f target='branch' -f enforcement='active' \
  -F 'conditions[ref_name][include][]=refs/heads/main' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][type]=non_fast_forward' \
  -F 'rules[][type]=deletion'
```

---

## 2. Fine-grained PAT for the fleet 🔴

**Why:** by default the fleet would run with your full `gh` login (broad scope). On a 24/7 VPS you
want a **least-privilege** token that can only do what the fleet needs and nothing more — no admin,
no workflow files, no other repos. If the VPS leaks, the damage is limited and the key is revocable.

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:

- [ ] **Resource owner:** your own account · **Repository access:** Only select → `<owner/repo>`
- [ ] **Permissions** (Repository):
  - Contents: **Read and write** (push branches)
  - Issues: **Read and write** (labels, comments)
  - Pull requests: **Read and write** (open/comment PRs)
  - Metadata: **Read** (required, automatic)
  - ❌ Administration, ❌ Workflows, ❌ Secrets, ❌ everything else → leave on "No access"
- [ ] **Expiration:** 90 days (set a reminder to rotate)
- [ ] Store the token in a password manager (it goes into `fleet.env` on the VPS later, `chmod 600`).
- [ ] **Verify scope:** with this token, `gh issue list` and `gh pr create` must work, but
      `gh api -X PUT repos/<owner>/<repo>/pulls/1/merge` must **fail** (no merge right →
      merging stays exclusive to the dashboard with your confirmation).

> Note: the **dashboard** is allowed to merge. Give the dashboard a **separate** token
> (or the same one, only if you deliberately allow merge). Keep the fleet token and dashboard
> token separate so the fleet itself can never merge.

---

## 3. Separate Supabase project for telemetry 🔴

**Why:** the fleet pushes live status to Supabase (`fleet_tasks`/`fleet_events`). That must **never**
live in your production DB, and the fleet must **never** hold the production service-role key. A small
dedicated project fully isolates the blast radius.

- [ ] Create a new Supabase project: **`mission-control`** (free tier is enough).
- [ ] Apply the migration: `mission-control/supabase/migrations/0001_fleet.sql`
      (SQL Editor → paste → run, or `supabase db push` with that project linked).
- [ ] Record three values:
  - `SUPABASE_MC_URL` → `https://<ref>.supabase.co`
  - `SUPABASE_MC_ANON_KEY` (anon/publishable) → for the **dashboard** (server-side read)
  - `SUPABASE_MC_WRITE_KEY` → for the **fleet** (`push_telemetry`). Use a **restricted**
    write key; do not give the fleet the service-role key if you can avoid it.
- [ ] **RLS on** for both tables; no anon SELECT (the dashboard reads server-side behind the
      mc_session cookie — see `lib/supabase.ts`).
- [ ] Put these in `deploy/fleet.env` (fleet) and the dashboard env respectively. NEVER in git.
- [ ] **Verify:** run `./supervisor.sh --once` with `SUPABASE_MC_URL/WRITE_KEY` set →
      confirm rows appear in `fleet_tasks`, and that the production DB is untouched.

---

## 4. Rotate secrets 🔴

**Why:** if any real secret (e.g. a third-party client secret, an old service-role key) has ever
been in a local env file or in circulation, rotate it before adding a fleet+dashboard+VPS that talk
to this ecosystem, so old copies become worthless.

- [ ] **Rotate third-party client secrets** in their provider portal → replace the value in
      Supabase secrets / hosting env / `.env.local`. Revoke the old value.
- [ ] **Rotate the Supabase service-role key** of your production project (Settings → API →
      "Reset" / new key) → update everywhere the real one is used (edge functions, etc.).
- [ ] **Grep the git history** to confirm no secret was ever committed:
      `git -C $REPO_DIR log -p -G 'CLIENT_SECRET|service_role|sk-ant-' | head`
      → if anything shows up in history: rotating is doubly required (the old one is public).
- [ ] Confirm `.env*` is in `.gitignore` and not "exposed" in your hosting provider.
- [ ] **Verify:** dependent features still work after rotation (otherwise a consumer lost a key —
      update it). The fleet never receives these production secrets anyway.

---

## 5. Containment: Podman isolation + egress allowlist 🔴

**Why:** by default the build agent runs with `--dangerously-skip-permissions` directly on the host.
That is acceptable manually-with-you-present, but **not** 24/7 unattended: a runaway or
prompt-injected agent would then have access to your whole `$HOME` and the open internet. We put the
agent step in a **rootless Podman container** with only the worktree and an **egress allowlist**
(Anthropic + npm only), while git push + PR are done by the orchestrator outside the container.

- [ ] Install rootless Podman on the VPS (included in `deploy/bootstrap.sh`).
- [ ] Wire the build step in `worker.sh` via `deploy/run-agent-sandbox.sh` (template is ready):
      mount **only** `$WT` (the worktree), **no** `$HOME`/secrets, read-only rootfs where possible.
- [ ] Set an **egress allowlist**: only `api.anthropic.com` + npm registry/CDN reachable;
      everything else outbound blocked (firewall in the container/netns or a proxy).
- [ ] Keep `gh`/git **outside** the container (the orchestrator pushes and opens the PR with the fleet PAT).
- [ ] **Verify:** start a worker; confirm from inside the container that (a) `cat ~/.aws`/`~/.ssh`
      etc. do not exist, (b) `curl https://example.com` fails but `curl https://api.anthropic.com`
      succeeds, (c) the build runs green.

---

## Only then → turn on 24/7

Once 1–5 are ✅:
- [ ] VPS steps from `deploy/README.md` (bootstrap → fleet.env → systemd), start with `MAX_WORKERS=1`.
- [ ] WhatsApp notifications: `openclaw channels login --channel whatsapp` → `WHATSAPP_TO` + `NOTIFY_CMD`.
- [ ] Dashboard behind auth + rate limit (access control / firewall), `MC_SESSION_SECRET` = `openssl rand -hex 32`.
- [ ] Burn-in: 24–48h at MAX_WORKERS=1, low daily cap, circuit breaker on; watch via the dashboard.
