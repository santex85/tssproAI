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

# Optional: add swap on low-RAM dev servers to avoid OOM during frontend build (expo export). Skip with SKIP_SWAP=1.
if [ "${SKIP_SWAP:-0}" != "1" ]; then
  TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
  TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
  CURRENT_SWAP_KB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
  if [ "$TOTAL_MEM_MB" -lt 2048 ] 2>/dev/null && [ "$CURRENT_SWAP_KB" -lt 512000 ] 2>/dev/null; then
    SWAPFILE="${SWAPFILE:-/swapfile}"
    if [ ! -f "$SWAPFILE" ] || [ "$(stat -c%s "$SWAPFILE" 2>/dev/null)" -lt 900000000 ]; then
      echo "Low RAM detected (${TOTAL_MEM_MB}MB). Creating 1GB swap at $SWAPFILE to avoid OOM during docker build..."
      touch "$SWAPFILE" && chmod 600 "$SWAPFILE"
      dd if=/dev/zero of="$SWAPFILE" bs=1M count=1024 status=none 2>/dev/null || true
      mkswap "$SWAPFILE" 2>/dev/null && swapon "$SWAPFILE" 2>/dev/null || true
      if grep -q "^$SWAPFILE " /etc/fstab 2>/dev/null; then true; else echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab 2>/dev/null; fi
      echo "Swap configured. Re-run deploy-dev."
    fi
  fi
fi

# Create deploy directory and .cursor (backend bind-mount from base compose; prod override may not remove it in stack deploy)
mkdir -p "$DEPLOY_PATH" "$DEPLOY_PATH/.cursor"
echo "Deploy path: $DEPLOY_PATH"

echo ""
echo "Bootstrap done. Next steps:"
echo "  1. Clone the repo into $DEPLOY_PATH (e.g. git clone <repo_url> $DEPLOY_PATH)"
echo "  2. On the server: cp $DEPLOY_PATH/.env.development.example $DEPLOY_PATH/.env"
echo "  3. Edit $DEPLOY_PATH/.env and set DOMAIN=dev.tsspro.tech, APP_DOMAIN=dev.app.tsspro.tech, VITE_APP_URL=https://dev.app.tsspro.tech, EXPO_PUBLIC_API_URL=https://dev.app.tsspro.tech, CORS_ORIGINS, and all secrets (POSTGRES_PASSWORD, API keys, S3, etc.)"
echo "     On low-RAM dev server add: NODE_MEMORY_MB=1536 (or 1024) to reduce frontend build memory and avoid OOM."
echo "  4. From your machine: make deploy-dev"
echo ""
echo "Ensure DNS: dev.tsspro.tech and dev.app.tsspro.tech -> this server's IP (209.38.17.171)."
