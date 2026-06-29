# dev-fleet — running 24/7 on your own VPS

> Full rationale + security review lives in your own design doc (keep it outside the repo).
> **Do NOT run the fleet 24/7 autonomously before Phase 0 + containment are done.**

## Phase 0 — BLOCKING (your actions, before deploy)
> Checklist version with exact steps + verification per blocker: **`deploy/FASE-0-CHECKLIST.md`**.

1. **Enforce branch protection on `main`.** Make the repo public **or** get GitHub Pro → ruleset on
   `main` (require PR, block force-push, block deletion, restrict push to you only).
2. **Fine-grained PAT** for the fleet (only `<owner/repo>`: Contents/Issues/PR write,
   NO admin/merge/workflow/other repos). Your personal full-scope token stays on your own machine.
3. **Separate Supabase project** `mission-control` for telemetry. NEVER the production service-role key.
4. **Rotate** any real secrets (e.g. third-party client secrets, old service-role keys); confirm they
   are not committed to git or exposed in your hosting provider.

## VPS steps
1. Fresh Ubuntu 24.04 + cloud firewall default-deny inbound. `sudo bash deploy/bootstrap.sh`.
2. As user `fleet`: copy `$FLEET_DIR` here, `git clone https://github.com/<owner/repo> $REPO_DIR`.
3. `gh auth login` (the FINE-GRAINED PAT) + `gh auth setup-git`; `claude setup-token`.
4. `cp deploy/fleet.env.example fleet.env` → fill in (REPO_DIR, WHATSAPP_TO, SUPABASE_MC_*), `chmod 600 fleet.env`.
5. **Wire containment (before 24/7):** run the agent step via `deploy/run-agent-sandbox.sh`
   (rootless Podman, only the worktree, NO $HOME secrets, egress allowlist to anthropic/npm only).
   git push + PR are done by the orchestrator outside the container.
6. `sudo cp deploy/dev-fleet.service /etc/systemd/system/ && sudo systemctl enable --now dev-fleet`.
   Start with `MAX_WORKERS=1`. `journalctl -u dev-fleet -f`.

## WhatsApp
`openclaw channels login --channel whatsapp` (scan the QR) → set `WHATSAPP_TO` + the `NOTIFY_CMD`
in `fleet.env`. Test: `MSG="test" bash -c "$NOTIFY_CMD"`.

## Dashboard (Mission Control)
Separate Next.js app in `$FLEET_DIR/mission-control/` → deploy on your hosting provider (its own project).
Env: telemetry anon key (mission-control project), fine-grained PAT, `MC_DASHBOARD_PASSWORD`,
`MC_SESSION_SECRET` (`openssl rand -hex 32`). Put access control / rate limiting in front of it.
Apply `mission-control/supabase/migrations/0001_fleet.sql` to the telemetry project.
