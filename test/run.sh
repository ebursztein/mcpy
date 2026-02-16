#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="mcpy-integration-test"

echo "Building integration test container..."
podman build -f test/Containerfile -t "$IMAGE" .

echo ""
echo "Running integration tests..."
podman run --rm "$IMAGE"
