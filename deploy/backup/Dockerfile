# Lightweight backup image: pg_dump + aws-cli. S3-compatible (Selectel, AWS).
# Schedule via BACKUP_CRON_SCHEDULE (entrypoint loop, no crond — Swarm-safe).
FROM alpine:3.19

RUN apk add --no-cache \
    postgresql-client \
    python3 \
    py3-pip \
    gzip \
    && pip3 install --no-cache-dir --break-system-packages awscli \
    && rm -rf /var/cache/apk/* /root/.cache

WORKDIR /opt
COPY backup.sh /opt/backup.sh
RUN chmod +x /opt/backup.sh && touch /var/log/backup.log

COPY entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
