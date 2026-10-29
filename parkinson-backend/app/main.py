from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (registers tables)
from app.core.config import settings
from app.db.base import Base
from app.db.redis import init_redis
from app.db.session import engine
from app.routers import auth, health, legacy


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)  # demo only; Alembic comes later
    connected = init_redis()
    print(f"[startup] Redis: {'connected' if connected else 'not used (memory fallback)'}")
    print(f"[startup] AUTH_REQUIRED={settings.auth_required}")
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(legacy.router)