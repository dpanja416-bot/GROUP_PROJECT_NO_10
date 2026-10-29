from fastapi import APIRouter
from sqlalchemy import text

from app.db.redis import get_redis
from app.db.session import SessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready():
    db_ok = True
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "status": "ready" if db_ok else "degraded",
        "database": db_ok,
        "redis": "connected" if get_redis() is not None else "memory-fallback",
    }