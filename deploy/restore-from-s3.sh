#!/usr/bin/env bash
# Restore PostgreSQL from a backup stored in S3.
# Usage: ./restore-from-s3.sh [S3_KEY|latest] [--dry-run]
#   S3_KEY: full key in bucket (e.g. backups/postgres/smart_trainer_20250301_0300.dump.gz), or "latest"
#   --dry-run: only download and show info, do not restore
# Requires: .env in project root with POSTGRES_*, S3_BACKUP_* (or S3_*). Uses docker compose (local)
# or docker stack postgres container (st2_postgres) when running on a server with stack deploy.
#
# Safety: restore requires interactive TTY (no piping). Before restore, creates a local backup
# of the current DB to /tmp/smart_trainer_pre_restore_YYYYMMDD_HHMMSS.dump.gz. Fails if backup fails.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $PROJECT_ROOT"
  exit 1
fi

# shellcheck source=/dev/null
set -a
source .env
set +a

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
if [ -f docker-compose.override.yml ]; then
  COMPOSE_CMD="$COMPOSE_CMD -f docker-compose.override.yml"
fi

DRY_RUN=false
S3_KEY_ARG=""
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=true
  else
    S3_KEY_ARG="$arg"
  fi
done

if [ -z "$S3_KEY_ARG" ]; then
  echo "Usage: $0 [S3_KEY|latest] [--dry-run]"
  echo "  S3_KEY: object key in bucket (e.g. backups/postgres/smart_trainer_20250301_0300.dump.gz)"
  echo "  latest: use the most recent backup by filename timestamp"
  exit 1
fi

BUCKET="${S3_BACKUP_BUCKET:-$S3_BUCKET}"
AWS_ACCESS_KEY="${S3_BACKUP_ACCESS_KEY:-$S3_ACCESS_KEY}"
AWS_SECRET_ACCESS_KEY="${S3_BACKUP_SECRET_KEY:-$S3_SECRET_KEY}"
export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"

AWS_OPTS=()
if [ -n "${S3_BACKUP_ENDPOINT}" ]; then
  AWS_OPTS+=(--endpoint-url "$S3_BACKUP_ENDPOINT")
fi

if [ -z "$BUCKET" ] || [ -z "$AWS_ACCESS_KEY" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "ERROR: Set S3_BACKUP_BUCKET (or S3_BUCKET), S3_BACKUP_ACCESS_KEY, S3_BACKUP_SECRET_KEY in .env"
  exit 1
fi

list_s3() {
  aws s3 ls "s3://${BUCKET}/${S3_BACKUP_PREFIX:-backups/postgres/}" "${AWS_OPTS[@]}" 2>/dev/null || true
}

if [ "$S3_KEY_ARG" = "latest" ]; then
  echo "Listing backups to find latest..."
  PREFIX="${S3_BACKUP_PREFIX:-backups/postgres/}"
  [[ "$PREFIX" != */ ]] && PREFIX="${PREFIX}/"
  LAST=""
  while read -r line; do
    # Format: 2025-03-01 03:00:00  12345 smart_trainer_20250301_0300.dump.gz
    KEY=$(echo "$line" | awk '{print $4}')
    [ -z "$KEY" ] && continue
    if [[ "$KEY" =~ smart_trainer_[0-9]{8}_[0-9]{4}\.dump\.gz ]]; then
      LAST="${PREFIX}${KEY}"
    fi
  done < <(list_s3 | sort -k4)
  if [ -z "$LAST" ]; then
    echo "ERROR: No backups found in s3://${BUCKET}/${PREFIX}"
    exit 1
  fi
  S3_KEY="$LAST"
  echo "Latest backup: $S3_KEY"
else
  S3_KEY="$S3_KEY_ARG"
fi

RESTORE_FILE="/tmp/smart_trainer_restore_$$.dump.gz"
cleanup() { rm -f "$RESTORE_FILE"; }
trap cleanup EXIT

echo "Downloading s3://${BUCKET}/${S3_KEY} ..."
if ! aws s3 cp "s3://${BUCKET}/${S3_KEY}" "$RESTORE_FILE" "${AWS_OPTS[@]}"; then
  echo "ERROR: Download failed"
  exit 1
fi

SIZE=$(wc -c < "$RESTORE_FILE")
echo "Downloaded ${SIZE} bytes to $RESTORE_FILE"

if [ "$DRY_RUN" = true ]; then
  echo "Dry run: not restoring. Remove --dry-run to restore."
  exit 0
fi

# Require interactive TTY — no piping (e.g. echo y | ./restore) to avoid accidental destructive runs
if [ ! -t 0 ]; then
  echo "ERROR: Restore requires interactive mode. Do not pipe input (e.g. echo y | ./restore-from-s3.sh)."
  echo "Run directly: ./deploy/restore-from-s3.sh latest"
  exit 1
fi

echo "WARNING: This will OVERWRITE the running database (--clean --if-exists)."
echo "Current data will be replaced. Ensure backend is stopped or users are aware."
echo ""
read -r -p "Continue? Type 'yes' to confirm: " ans
if [ "$ans" != "yes" ]; then
  echo "Aborted. (Expected 'yes', got: ${ans:-empty})"
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-smart_trainer}"
POSTGRES_DB="${POSTGRES_DB:-smart_trainer}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}"

# Prefer stack postgres container (docker stack deploy st2) when present; else use compose
POSTGRES_CONTAINER=$(docker ps -q -f name=st2_postgres 2>/dev/null | head -1)

# Pre-restore backup: save current DB before overwriting
PRE_BACKUP="/tmp/smart_trainer_pre_restore_$(date +%Y%m%d_%H%M%S).dump.gz"
echo "Creating pre-restore backup: $PRE_BACKUP"
if [ -n "$POSTGRES_CONTAINER" ]; then
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc 2>/dev/null | gzip > "$PRE_BACKUP"; then
    echo "ERROR: Pre-restore backup failed. Aborting restore."
    rm -f "$PRE_BACKUP"
    exit 1
  fi
else
  if ! $COMPOSE_CMD exec -T postgres env PGPASSWORD="$POSTGRES_PASSWORD" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc 2>/dev/null | gzip > "$PRE_BACKUP"; then
    echo "ERROR: Pre-restore backup failed. Aborting restore."
    rm -f "$PRE_BACKUP"
    exit 1
  fi
fi
if [ ! -s "$PRE_BACKUP" ]; then
  echo "ERROR: Pre-restore backup is empty. Aborting."
  rm -f "$PRE_BACKUP"
  exit 1
fi
echo "Pre-restore backup saved: $PRE_BACKUP ($(wc -c < "$PRE_BACKUP") bytes)"

if [ -n "$POSTGRES_CONTAINER" ]; then
  echo "Using stack postgres container: $POSTGRES_CONTAINER"
  echo "Copying dump into postgres container..."
  docker cp "$RESTORE_FILE" "$POSTGRES_CONTAINER:/tmp/restore.dump.gz"
  echo "Restoring (pg_restore --clean --if-exists)..."
  if ! docker exec "$POSTGRES_CONTAINER" sh -c "gunzip -c /tmp/restore.dump.gz | pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner"; then
    echo "ERROR: pg_restore failed. Pre-restore backup is at: $PRE_BACKUP"
    docker exec "$POSTGRES_CONTAINER" rm -f /tmp/restore.dump.gz
    exit 1
  fi
  docker exec "$POSTGRES_CONTAINER" rm -f /tmp/restore.dump.gz
else
  echo "Using docker compose postgres service..."
  echo "Copying dump into postgres container..."
  $COMPOSE_CMD cp "$RESTORE_FILE" postgres:/tmp/restore.dump.gz
  echo "Restoring (pg_restore --clean --if-exists)..."
  if ! $COMPOSE_CMD exec -T postgres sh -c "gunzip -c /tmp/restore.dump.gz | pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists --no-owner"; then
    echo "ERROR: pg_restore failed. Pre-restore backup is at: $PRE_BACKUP"
    $COMPOSE_CMD exec -T postgres rm -f /tmp/restore.dump.gz
    exit 1
  fi
  $COMPOSE_CMD exec -T postgres rm -f /tmp/restore.dump.gz
fi

echo "Restore finished. Pre-restore backup: $PRE_BACKUP (keep for rollback). Verify data and restart backend if needed."
