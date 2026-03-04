"""Unit tests for scheduler_lock (distributed cron lock via Redis)."""

from unittest.mock import patch

import pytest

from app.core.scheduler_lock import (
    LOCK_KEY_PREFIX,
    try_acquire_cron_lock,
)


class FakeRedisSetNX:
    """In-memory Redis-like client that supports SET key value NX EX ttl."""

    def __init__(self):
        self._store: dict[str, str] = {}

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool | None:
        if not nx:
            self._store[key] = value
            return True
        if key in self._store:
            return None  # redis-py returns None when NX and key exists
        self._store[key] = value
        return True

    async def aclose(self):
        pass


@pytest.mark.asyncio
async def test_try_acquire_cron_lock_acquires_when_free():
    """First caller acquires the lock and runs the job."""
    fake = FakeRedisSetNX()
    with patch("app.core.scheduler_lock.get_redis", return_value=fake):
        acquired = await try_acquire_cron_lock("test_job", ttl_seconds=60)
    assert acquired is True
    assert fake._store.get(f"{LOCK_KEY_PREFIX}test_job") is not None


@pytest.mark.asyncio
async def test_try_acquire_cron_lock_fails_when_held():
    """Second caller does not acquire the lock and should skip the job."""
    fake = FakeRedisSetNX()
    fake._store[f"{LOCK_KEY_PREFIX}test_job"] = "other-worker:123"
    with patch("app.core.scheduler_lock.get_redis", return_value=fake):
        acquired = await try_acquire_cron_lock("test_job", ttl_seconds=60)
    assert acquired is False


@pytest.mark.asyncio
async def test_try_acquire_cron_lock_redis_unavailable():
    """When Redis is None (unavailable), do not run the job (fail-closed)."""
    with patch("app.core.scheduler_lock.get_redis", return_value=None):
        acquired = await try_acquire_cron_lock("test_job", ttl_seconds=60)
    assert acquired is False


@pytest.mark.asyncio
async def test_try_acquire_cron_lock_redis_error():
    """When Redis raises, do not run the job (fail-closed)."""
    class FailingRedis:
        async def set(self, key, value, nx=False, ex=None):
            raise ConnectionError("redis down")
    with patch("app.core.scheduler_lock.get_redis", return_value=FailingRedis()):
        acquired = await try_acquire_cron_lock("test_job", ttl_seconds=60)
    assert acquired is False
