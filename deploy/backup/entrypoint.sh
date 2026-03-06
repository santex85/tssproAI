#!/bin/sh
# Run backup on schedule without crond (Swarm-safe: no setpgid).
# BACKUP_CRON_SCHEDULE format: "minute hour * * *" (e.g. "0 3 * * *" = 03:00 UTC daily).
SCHEDULE="${BACKUP_CRON_SCHEDULE:-0 3 * * *}"
# Parse minute and hour (first two fields)
set -- $SCHEDULE
CRON_MIN=${1:-0}
CRON_HOUR=${2:-3}
# Zero-pad for display
HOUR_PAD=$(printf '%02d' "$CRON_HOUR")
MIN_PAD=$(printf '%02d' "$CRON_MIN")
echo "Backup schedule: daily at ${HOUR_PAD}:${MIN_PAD} UTC (from BACKUP_CRON_SCHEDULE)"

# Run once at startup so a new deploy gets a backup soon
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running initial backup..."
/opt/backup.sh >> /var/log/backup.log 2>&1 || true

while true; do
  # Seconds until next scheduled time (e.g. next 03:00 UTC)
  SLEEP_SEC=$(python3 - "$CRON_HOUR" "$CRON_MIN" << 'PY'
import sys
from datetime import datetime, timedelta
h, m = int(sys.argv[1]), int(sys.argv[2])
now = datetime.utcnow()
target = now.replace(hour=h, minute=m, second=0, microsecond=0)
if target <= now:
    target += timedelta(days=1)
print(int((target - now).total_seconds()))
PY
)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Next backup in ${SLEEP_SEC}s (~$((SLEEP_SEC/3600))h)"
  sleep "$SLEEP_SEC"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running scheduled backup..."
  /opt/backup.sh >> /var/log/backup.log 2>&1 || true
done
