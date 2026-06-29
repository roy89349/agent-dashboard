#!/usr/bin/env bash
# loop.sh — 24/7 mode: start the supervisor that continuously clears the backlog
# with MAX_WORKERS parallel agents. Ctrl-C to stop.
# On the VPS you run this as a systemd service (see README → "To the VPS").
set -uo pipefail
FLEET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$FLEET_DIR/supervisor.sh"
