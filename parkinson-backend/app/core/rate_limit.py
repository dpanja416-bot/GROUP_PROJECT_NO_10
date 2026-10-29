from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.services.cache_service import hit


def _client_ip(request: Request) -> str:
    # Behind a proxy/Nginx later, read X-Forwarded-For here.
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int):
    """Usage: dependencies=[Depends(rate_limit('login', 5))]"""

    def dependency(request: Request) -> None:
        window = settings.rate_window_seconds
        count, retry_after = hit(f"rl:{name}:{_client_ip(request)}", window)
        if count > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency