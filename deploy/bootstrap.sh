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
apt-get install -y curl git jq ufw fail2ban unattended-upgrades podman ca-certificates

echo "== 2/8 Node 22 =="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
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

echo "== 5/8 non-root user '$FLEET_USER' =="
id "$FLEET_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$FLEET_USER"
# Add your SSH pubkey so you can log in as 'fleet':
#   install -d -m 700 -o $FLEET_USER -g $FLEET_USER /home/$FLEET_USER/.ssh
#   echo "<your-ssh-pubkey>" > /home/$FLEET_USER/.ssh/authorized_keys
#   chown $FLEET_USER:$FLEET_USER /home/$FLEET_USER/.ssh/authorized_keys; chmod 600 ...

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

✅ Bootstrap done. Next steps (as user '$FLEET_USER'):
  1) git clone <your dev-fleet repo, or copy your local \$FLEET_DIR here> ~/dev-fleet
     and clone the target repo:  git clone https://github.com/<owner/repo> ~/<repo>
  2) gh auth login   →  paste the FINE-GRAINED PAT (Contents/Issues/PR write, NO admin/workflow)
     gh auth setup-git
  3) claude setup-token   →  your Claude plan (or an API key with a budget cap)
  4) create ~/dev-fleet/fleet.env (see deploy/fleet.env.example) with REPO_DIR=/home/$FLEET_USER/<repo>
  5) ⚠️ BEFORE 24/7: wire the agent step into containment (deploy/run-agent-sandbox.sh) and
     set the cloud firewall egress allowlist. See deploy/README.md.
  6) sudo cp deploy/dev-fleet.service /etc/systemd/system/ && sudo systemctl enable --now dev-fleet
     journalctl -u dev-fleet -f
EOF
