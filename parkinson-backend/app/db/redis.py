import redis

from app.core.config import settings

_client = None


def init_redis() -> bool:
    """Try to connect once at startup. Returns True if Redis is usable."""
    global _client
    if not settings.redis_url:
        return False
    try:
        client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        client.ping()
        _client = client
        return True
    except redis.RedisError:
        _client = None
        return False


def get_redis():
    return _client