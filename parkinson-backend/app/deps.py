from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    AUTH_REQUIRED=true  -> a valid token is mandatory (else 401)
    AUTH_REQUIRED=false -> demo mode: no/invalid token just means 'no user'
    """
    user = None
    if creds is not None:
        user_id = decode_token(creds.credentials)
        if user_id:
            user = db.get(User, user_id)
            if user is not None and not user.is_active:
                user = None

    if user is None and settings.auth_required:
        raise _unauthorized("Not authenticated")
    return user