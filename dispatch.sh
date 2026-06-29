#!/usr/bin/env bash
# dispatch.sh — pick up exactly ONE task and build it (handy for testing).
# For parallel/24-7: use supervisor.sh or loop.sh.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

NUM="$(claim_next)"
[ -z "$NUM" ] && { log "No agent-ready tasks in the backlog."; exit 0; }
exec "$FLEET_DIR/worker.sh" "$NUM"
