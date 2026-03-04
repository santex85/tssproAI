"""
Distributed lock for cron jobs so that only one worker runs each scheduled task
when running multiple Uvicorn/Gunicorn processes.

Uses Redis SET key value NX EX ttl (atomic set-if-not-exists with TTL).
Key format: cron_lock:{lock_name}
Value: worker identifier (hostname:pid) for debugging.

When Redis is unavailable or lock is already held, returns False so the caller
skips execution (fail-closed: no duplicate runs).
"""

from __future__ import annotations

import logging
import os

from app.core.rate_limit import get_redis

logger = logging.getLogger(__name__)

LOCK_KEY_PREFIX = "cron_lock:"


def _worker_id() -> str:
    """Unique identifier for this process (for lock value / debugging)."""
    return f"{os.environ.get('HOSTNAME', 'localhost')}:{os.getpid()}"


async def try_acquire_cron_lock(lock_name: str, ttl_seconds: int = 300) -> bool:
    """
    Try to acquire a distributed lock for a cron job.

    Only one worker across all processes should run the job. This uses Redis
    to ensure that when multiple Uvicorn/Gunicorn workers run the same
    scheduled task, only the first to acquire the lock runs it; others skip.

    :param lock_name: Logical name of the job (e.g. "orchestrator_run", "sleep_reminder").
    :param ttl_seconds: Lock TTL in seconds. Should be longer than max job duration
        so the lock is not released before the job finishes (lock auto-expires).
    :return: True if lock was acquired (this worker should run the job),
        False if lock already held or Redis unavailable (skip execution).
    """
    redis_client = get_redis()
    if redis_client is None:
        logger.warning("Scheduler lock: Redis unavailable, skipping job %s", lock_name)
        return False

    key = f"{LOCK_KEY_PREFIX}{lock_name}"
    value = _worker_id()

    try:
        # SET key value NX EX ttl — only set if key does not exist
        acquired = await redis_client.set(key, value, nx=True, ex=ttl_seconds)
        if acquired:
            logger.debug("Scheduler lock: acquired %s for worker %s", lock_name, value)
        return bool(acquired)
    except Exception as e:
        logger.warning("Scheduler lock: Redis error for %s (%s), skipping job", lock_name, e)
        return False
