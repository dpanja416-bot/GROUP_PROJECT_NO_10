"""
Tiny cache + counter that uses Redis when available,
and falls back to process memory when Redis is not configured.
"""
import json
import time
from typing import Any, Optional

import redis

from app.db.redis import get_redis

_memory: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
_counters: dict[str, tuple[int, float]] = {}  # key -> (count, reset_at)


# ---------- cache ----------
def cache_get(key: str) -> Optional[Any]:
    r = get_redis()
    if r is not None:
        try:
            raw = r.get(key)
            return json.loads(raw) if raw is not None else None
        except redis.RedisError:
            pass
    item = _memory.get(key)
    if item is None:
        return None
    value, expires_at = item
    if expires_at < time.time():
        _memory.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl: int) -> None:
    r = get_redis()
    if r is not None:
        try:
            r.set(key, json.dumps(value), ex=ttl)
            return
        except redis.RedisError:
            pass
    _memory[key] = (value, time.time() + ttl)


def cache_delete_prefix(prefix: str) -> None:
    r = get_redis()
    if r is not None:
        try:
            for k in r.scan_iter(match=f"{prefix}*"):
                r.delete(k)
        except redis.RedisError:
            pass
    for k in [k for k in _memory if k.startswith(prefix)]:
        _memory.pop(k, None)


# ---------- rate-limit counter ----------
def hit(key: str, window: int) -> tuple[int, int]:
    """Count one request. Returns (count_in_window, seconds_until_reset)."""
    r = get_redis()
    if r is not None:
        try:
            pipe = r.pipeline()
            pipe.incr(key)
            pipe.ttl(key)
            count, ttl = pipe.execute()
            if ttl is None or ttl < 0:
                r.expire(key, window)
                ttl = window
            return int(count), int(ttl)
        except redis.RedisError:
            pass

    now = time.time()
    count, reset_at = _counters.get(key, (0, 0.0))
    if reset_at < now:
        count, reset_at = 0, now + window
    count += 1
    _counters[key] = (count, reset_at)
    return count, max(1, int(reset_at - now))