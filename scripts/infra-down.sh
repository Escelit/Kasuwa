#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Stopping infrastructure via docker compose..."
  docker compose -f "$COMPOSE_FILE" down
elif command -v podman-compose >/dev/null 2>&1; then
  echo "Stopping infrastructure via podman-compose..."
  podman-compose -f "$COMPOSE_FILE" down
else
  echo "Note: Docker / container runtime is not running in this environment."
fi
