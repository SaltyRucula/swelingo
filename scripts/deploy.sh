#!/usr/bin/env bash
# deploy.sh — Pull latest changes and rebuild/restart all containers on the VPS.
# Run this on the server after SSHing in, or wire it into a CI step.
#
# Usage:
#   ./scripts/deploy.sh
#
# Prerequisites on the server:
#   - Docker and docker-compose installed
#   - A .env file at repo root with EXPO_PUBLIC_API_URL set
#   - Git remote set up (git remote -v)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# NOTE: When deploying via rsync, always exclude .env:
#   rsync -av --exclude='.git' --exclude='node_modules' --exclude='target' \
#         --exclude='dist' --exclude='.env' ...
# The server's .env has production values and must not be overwritten.

echo "==> Pulling latest changes..."
if git rev-parse --git-dir > /dev/null 2>&1; then
  git pull
else
  echo "Not a git repo — skipping git pull (files deployed via rsync)."
fi

echo "==> Checking .env..."
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in EXPO_PUBLIC_API_URL."
  exit 1
fi

if grep -q '<YOUR_DROPLET_IP>' .env; then
  echo "ERROR: .env still has placeholder value. Set EXPO_PUBLIC_API_URL to your server's IP."
  exit 1
fi

if grep -q 'EXPO_PUBLIC_API_URL=.*localhost' .env; then
  echo "ERROR: EXPO_PUBLIC_API_URL contains 'localhost' — this will break the production build."
  echo "       Set EXPO_PUBLIC_API_URL=https://swelingo.com (or your domain/IP)."
  exit 1
fi

if grep -q 'API_BASE_URL=.*localhost' .env; then
  echo "ERROR: API_BASE_URL contains 'localhost' — GitHub OAuth redirect_uri will be wrong."
  echo "       Set API_BASE_URL=https://swelingo.com"
  exit 1
fi

if grep -q 'WEB_URL=.*localhost' .env; then
  echo "ERROR: WEB_URL contains 'localhost' — post-OAuth redirect will fail."
  echo "       Set WEB_URL=https://swelingo.com"
  exit 1
fi

echo "==> Rebuilding and restarting containers..."
# Use only the base compose file — docker-compose.local.yml is for local dev only.
docker compose -f docker-compose.yml up --build -d

echo ""
echo "Done. Services running:"
docker compose ps
