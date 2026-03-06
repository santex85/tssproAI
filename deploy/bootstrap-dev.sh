#!/usr/bin/env bash
# Bootstrap dev server (209.38.17.171): install Docker, init Swarm, prepare deploy directory.
# Run on the server once (e.g. via: ssh root@209.38.17.171 'bash -s' < deploy/bootstrap-dev.sh).
# After this: clone repo into DEPLOY_PATH, copy .env.development.example to .env and fill secrets, then run make deploy-dev from your machine.

set -e

DEPLOY_PATH="${DEPLOY_PATH:-/root/smart_trainer}"

# Install Docker if missing
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker || true
else
  echo "Docker already installed: $(docker --version)"
fi

# Ensure Docker Compose plugin (usually included with docker-ce from get.docker.com)
if ! docker compose version &>/dev/null; then
  echo "Docker Compose plugin not found. Install docker-ce with compose plugin or run: apt-get update && apt-get install -y docker-compose-plugin"
  exit 1
fi

# Init Swarm if not already (use ADVERTISE_ADDR when host has multiple IPs, e.g. 209.38.17.171)
if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
  echo "Initializing Docker Swarm..."
  if [ -n "${ADVERTISE_ADDR}" ]; then
    docker swarm init --advertise-addr "${ADVERTISE_ADDR}"
  else
    docker swarm init
  fi
else
  echo "Docker Swarm already active"
fi

# Create deploy directory and .cursor (backend bind-mount from base compose; prod override may not remove it in stack deploy)
mkdir -p "$DEPLOY_PATH" "$DEPLOY_PATH/.cursor"
echo "Deploy path: $DEPLOY_PATH"

echo ""
echo "Bootstrap done. Next steps:"
echo "  1. Clone the repo into $DEPLOY_PATH (e.g. git clone <repo_url> $DEPLOY_PATH)"
echo "  2. On the server: cp $DEPLOY_PATH/.env.development.example $DEPLOY_PATH/.env"
echo "  3. Edit $DEPLOY_PATH/.env and set DOMAIN=dev.tsspro.tech, CORS_ORIGINS, and all secrets (POSTGRES_PASSWORD, API keys, S3, etc.)"
echo "  4. From your machine: make deploy-dev"
echo ""
echo "Ensure DNS: dev.tsspro.tech -> this server's IP (209.38.17.171)."
