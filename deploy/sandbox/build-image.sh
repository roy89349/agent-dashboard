#!/usr/bin/env bash
# build-image.sh — (re)build the rootless Podman image the build agent runs in.
# Image name is config-driven (SANDBOX_IMAGE); see deploy/sandbox/Containerfile.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${SANDBOX_IMAGE:-localhost/fleet-sandbox:latest}"
echo "Building sandbox image: $IMAGE"
exec podman build -t "$IMAGE" -f "$DIR/Containerfile" "$DIR"
