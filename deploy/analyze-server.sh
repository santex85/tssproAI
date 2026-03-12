#!/usr/bin/env bash
# Run on production server (host from DEPLOY_HOST) to list Docker apps, backups, and optionally remove one project.
# Usage: ./analyze-server.sh [remove-project-path]
#   If remove-project-path is given (e.g. /home/user/old_app), runs docker compose down -v there and optionally rm -rf.

set -e

echo "=== Docker containers (all) ==="
docker ps -a 2>/dev/null || true

echo ""
echo "=== Docker Compose projects ==="
docker compose ls 2>/dev/null || docker-compose ls 2>/dev/null || true

echo ""
echo "=== Docker volumes ==="
docker volume ls 2>/dev/null || true

echo ""
echo "=== Common app/backup dirs ==="
for d in /home /var/www /opt /root; do
  if [ -d "$d" ]; then
    echo "--- $d ---"
    ls -la "$d" 2>/dev/null || true
  fi
done

echo ""
echo "=== Directories matching *backup* (maxdepth 4) ==="
find /home /var /opt /root -maxdepth 4 -type d -name '*backup*' 2>/dev/null || true

echo ""
echo "=== Recent backup-like files (*.tar.gz, *.sql) in /home /var /opt ==="
find /home /var/www /opt -maxdepth 5 -type f \( -name '*.tar.gz' -o -name '*.sql' \) 2>/dev/null | head -50

echo ""
echo "=== Crontabs (backup jobs) ==="
for u in root $(getent passwd | cut -d: -f1); do
  crontab -u "$u" -l 2>/dev/null && echo "(user: $u)" || true
done
ls -la /etc/cron.d /etc/cron.daily 2>/dev/null || true

REMOVE_PATH="$1"
if [ -n "$REMOVE_PATH" ]; then
  echo ""
  echo "=== Removing project at $REMOVE_PATH ==="
  if [ ! -d "$REMOVE_PATH" ]; then
    echo "Path does not exist or is not a directory. Skipping."
  else
    if [ -f "$REMOVE_PATH/docker-compose.yml" ] || [ -f "$REMOVE_PATH/compose.yml" ]; then
      (cd "$REMOVE_PATH" && docker compose down -v 2>/dev/null || docker-compose down -v 2>/dev/null) && echo "Compose down -v done."
    fi
    echo "To delete directory run: rm -rf $REMOVE_PATH"
    read -r -p "Delete directory now? [y/N] " ans
    if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
      rm -rf "$REMOVE_PATH"
      echo "Deleted."
    fi
  fi
fi

echo ""
echo "Done. Keep backup of App A; remove App B as above or by hand."
