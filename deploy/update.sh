#!/usr/bin/env bash
# Pull the latest code, rebuild the dashboard, and restart both services.
# Run on the server as the 'fleet' user from anywhere:  ~/agent-dashboard/deploy/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ git pull"
git pull --ff-only

echo "→ install + build dashboard"
( cd mission-control && npm ci && npm run build )

echo "→ restart services"
sudo systemctl restart mission-control-dashboard
sudo systemctl restart dev-fleet

echo "✓ updated."
echo "  dashboard logs: journalctl -u mission-control-dashboard -f"
echo "  fleet logs:     journalctl -u dev-fleet -f"
