#!/usr/bin/env bash
# dev-fleet VPS bootstrap — run as ROOT on a FRESH Ubuntu 24.04 server.
# Installs the toolchain, creates a non-root user 'fleet', and hardens SSH + firewall.
# Afterwards log in as 'fleet', connect gh + claude, and install dev-fleet.service.
# ⚠️ Read this first; adjust FLEET_USER/SSH_PUBKEY to taste.
set -euo pipefail
FLEET_USER="${FLEET_USER:-fleet}"

echo "== 1/8 system update =="
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get install -y curl git jq ufw fail2ban unattended-upgrades podman ca-certificates ripgrep

echo "== 2/8 Node 24 =="   # node:sqlite needs Node 22.5+; 24 to match .nvmrc
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

echo "== 3/8 GitHub CLI =="
# ⚠️ check first: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y gh

echo "== 4/8 Claude Code CLI =="
npm install -g @anthropic-ai/claude-code

echo "== 4b/8 Tailscale (private access) =="
curl -fsSL https://tailscale.com/install.sh | sh

echo "== 5/8 non-root user '$FLEET_USER' =="
id "$FLEET_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$FLEET_USER"
# Reuse the SSH key you already added to root (your provider injected it) so you can log in as 'fleet':
install -d -m700 -o "$FLEET_USER" -g "$FLEET_USER" "/home/$FLEET_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "/home/$FLEET_USER/.ssh/authorized_keys"
  chown "$FLEET_USER:$FLEET_USER" "/home/$FLEET_USER/.ssh/authorized_keys"
  chmod 600 "/home/$FLEET_USER/.ssh/authorized_keys"
fi
# passwordless sudo (the SSH key is the auth; the account has no password):
usermod -aG sudo "$FLEET_USER"
echo "$FLEET_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$FLEET_USER"
chmod 440 "/etc/sudoers.d/90-$FLEET_USER"

echo "== 6/8 firewall (default-deny inbound, SSH only) =="
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "== 7/8 SSH hardening (keys-only, root login off) =="
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'        /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
grep -q "^AllowUsers $FLEET_USER" /etc/ssh/sshd_config || echo "AllowUsers $FLEET_USER" >> /etc/ssh/sshd_config
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

echo "== 8/8 automatic security updates =="
dpkg-reconfigure -f noninteractive unattended-upgrades || true

cat <<EOF

✅ Bootstrap done. Reconnect as '$FLEET_USER' (your SSH key was copied from root):
     ssh $FLEET_USER@<this-server-ip>
   Then (full runbook: deploy/SERVER.md):
  1) git clone https://github.com/<owner>/agent-dashboard ~/agent-dashboard
  2) cd ~/agent-dashboard && ./setup.sh   (asks for your repo/paths/build-cmd/password; writes config + secret; runs npm ci)
  3) gh auth login (paste the FINE-GRAINED PAT) && gh auth setup-git
  4) claude setup-token   (your Claude plan)
  5) sudo tailscale up   then   tailscale serve --bg 3000   (HTTPS dashboard on your tailnet)
  6) cd ~/agent-dashboard/mission-control && npm run build
  7) sudo cp deploy/mission-control-dashboard.service deploy/dev-fleet.service /etc/systemd/system/
     sudo systemctl enable --now mission-control-dashboard
  8) ⚠️ BEFORE running the fleet 24/7: finish deploy/FASE-0-CHECKLIST.md (protect main, fine-grained PAT,
     containment via deploy/run-agent-sandbox.sh + egress allowlist), THEN: sudo systemctl enable --now dev-fleet
EOF
