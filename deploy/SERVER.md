# Running Mission Control 24/7 on a VPS (Tailscale, private)

End state: a small Ubuntu server runs the **dashboard** (always reachable, privately, over HTTPS via
Tailscale) and the **fleet** (autonomous build agents). You reach it at
`https://<server>.<your-tailnet>.ts.net`, log in, and you're in your environment — from any device on
your tailnet. Code changes are a `git push` + one update command away.

> Order matters: get the **dashboard** up first (steps 1–7). Only enable the **24/7 fleet** after the
> Fase 0 security checklist (step 9), because the agents push to GitHub and spend tokens unattended.

## What you need
- A VPS: **Hetzner CPX21** (~€8/mo, comfortable) or CPX11 / a DigitalOcean 2 GB droplet. **Ubuntu 24.04**.
- A free **Tailscale** account (tailscale.com) — install the client on your laptop/phone too.
- Your **fine-grained GitHub PAT** (Contents/Issues/Pull requests = Read & write on your repo).
- Your **Claude plan** (for `claude setup-token`).

## 1. Create the server + your SSH key
Create the Ubuntu 24.04 VM and add your SSH public key in the provider UI. SSH in as root:
```bash
ssh root@<server-ip>
```

## 2. Bootstrap (as root)
Copy this repo's `deploy/bootstrap.sh` to the server and run it (installs Node 24, gh, claude,
ripgrep, Tailscale, podman; creates user `fleet`; hardens SSH + firewall):
```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/agent-dashboard/main/deploy/bootstrap.sh -o bootstrap.sh
bash bootstrap.sh
# add YOUR ssh pubkey so you can log in as 'fleet':
install -d -m700 -o fleet -g fleet /home/fleet/.ssh
echo "<your-ssh-pubkey>" > /home/fleet/.ssh/authorized_keys
chown fleet:fleet /home/fleet/.ssh/authorized_keys && chmod 600 /home/fleet/.ssh/authorized_keys
# allow inbound on the tailscale interface (private), public stays SSH-only:
ufw allow in on tailscale0
```
(If the repo is private, instead of curl just `scp` your local `deploy/bootstrap.sh` up, or clone after step 4.)

## 3. Log in as fleet + clone
```bash
ssh fleet@<server-ip>
git clone https://github.com/<owner>/agent-dashboard ~/agent-dashboard
cd ~/agent-dashboard
```

## 4. Configure (one command)
```bash
./setup.sh
```
Answer the prompts: your **GitHub repo** (owner/name), the **local clone path** (let it `git clone`
your project, e.g. `/home/fleet/<repo>`), **build command** (`npm run build`), optional **vault**,
a **dashboard password**, and paste your **fine-grained PAT**. It writes `config.local.env` +
`mission-control/.env.local` (with a generated session secret) and runs `npm ci`.

## 5. Authenticate gh + claude (for the fleet)
```bash
gh auth login          # choose HTTPS, paste the FINE-GRAINED PAT
gh auth setup-git
claude setup-token     # your Claude plan
```

## 6. Tailscale (private HTTPS)
```bash
sudo tailscale up                 # opens a login link — approve the machine in your tailnet
tailscale serve --bg 3000         # serves https://<server>.<tailnet>.ts.net → localhost:3000
tailscale serve status            # shows the exact HTTPS URL
```
Tailscale gives a real HTTPS cert on the tailnet, so the secure login cookie works. The dashboard
binds to `127.0.0.1` only — it's never exposed on the public internet.

## 7. Build + start the dashboard
```bash
cd ~/agent-dashboard/mission-control && npm run build
sudo cp ~/agent-dashboard/deploy/mission-control-dashboard.service /etc/systemd/system/
sudo cp ~/agent-dashboard/deploy/dev-fleet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mission-control-dashboard
journalctl -u mission-control-dashboard -f      # watch it boot
```
Now open `https://<server>.<tailnet>.ts.net` on any tailnet device → log in. ✅ Dashboard is live 24/7.

## 8. Verify
- Dashboard loads, you can log in, board shows your issues/PRs, "New task" works.
- The fleet shows **offline** (it isn't enabled yet — that's step 9).

## 9. Before the 24/7 fleet: Fase 0
Work through **`deploy/FASE-0-CHECKLIST.md`** (protect `main`, least-privilege PAT, separate
telemetry, rotate secrets, **containment**: wire the agent step through `deploy/run-agent-sandbox.sh`
+ an egress allowlist). Then:
```bash
sudo systemctl enable --now dev-fleet
journalctl -u dev-fleet -f
```
Start with `MAX_WORKERS=1` (the unit default), watch a day, then raise it from the dashboard.

## Tweaking & updating later
- **Live knobs** (workers, model, effort, caps, breaker) → change them in the dashboard; no redeploy.
- **Config** (repo/paths/prompts) → edit `config.local.env` / `mission-control/.env.local`, then restart.
- **Code changes** → on your laptop `git push`; on the server:
  ```bash
  ~/agent-dashboard/deploy/update.sh      # git pull + npm ci + build + restart both services
  ```

## Logs / control
```bash
journalctl -u mission-control-dashboard -f     # dashboard
journalctl -u dev-fleet -f                      # fleet
sudo systemctl restart mission-control-dashboard
sudo systemctl stop dev-fleet                    # (you can also Stop/Pause from the dashboard)
```
