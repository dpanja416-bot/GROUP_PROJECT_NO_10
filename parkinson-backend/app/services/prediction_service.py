import hashlib
import time
from typing import Optional

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ml import predictor
from app.models.prediction import Prediction
from app.models.user import User
from app.services.cache_service import cache_delete_prefix, cache_get, cache_set

ALLOWED_EXTENSIONS = (".jpg", ".jpeg", ".png", ".dcm", ".dicom", ".nii", ".nii.gz")
CHUNK = 1024 * 1024
HISTORY_TTL = 10  # seconds
RESULT_TTL = 3600  # seconds


# ---------- validation ----------
def _magic_ok(name: str, data: bytes) -> bool:
    if name.endswith((".jpg", ".jpeg")):
        return data[:3] == b"\xff\xd8\xff"
    if name.endswith(".png"):
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if name.endswith(".nii.gz"):
        return data[:2] == b"\x1f\x8b"
    if name.endswith(".nii"):
        return data[344:348] == b"n+1\x00"
    return True  # DICOM: extension check only (some files lack the preamble)


async def read_and_validate(file: UploadFile) -> bytes:
    filename = (file.filename or "").lower()
    if not filename.endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Unsupported file type. Allowed: JPG, PNG, DICOM, NIfTI.",
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(CHUNK):
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"File too large (max {settings.max_upload_mb} MB).",
            )

    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file.")
    if not _magic_ok(filename, bytes(data[:400])):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File content does not match its extension.",
        )
    return bytes(data)


# ---------- prediction ----------
def create_prediction(
    db: Session,
    data: bytes,
    filename: str,
    patient_id: Optional[str],
    user: Optional[User],
) -> Prediction:
    started = time.perf_counter()
    file_hash = hashlib.sha256(data).hexdigest()

    # Same file + same model version -> reuse the earlier answer
    cache_key = f"pred:{file_hash}:{settings.model_version}"
    cached = cache_get(cache_key)
    if cached is not None:
        label, confidence = cached["label"], cached["confidence"]
    else:
        result = predictor.predict(data, filename)
        label, confidence = result.label, result.confidence
        cache_set(
            cache_key, {"label": label, "confidence": confidence}, RESULT_TTL
        )

    row = Prediction(
        user_id=user.id if user else None,
        patient_id=(patient_id or "").strip()[:64] or None,
        filename=(filename or "scan")[:255],
        file_hash=file_hash,
        prediction=label,
        confidence=confidence,
        model_version=settings.model_version,
        status="completed",
        processing_ms=int((time.perf_counter() - started) * 1000),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    cache_delete_prefix("history:")  # history changed
    return row


# ---------- history ----------
def _history_key(user: Optional[User]) -> str:
    return f"history:{user.id if user else 'all'}"


def get_history(db: Session, user: Optional[User], limit: int = 500) -> list[dict]:
    key = _history_key(user)
    cached = cache_get(key)
    if cached is not None:
        return cached

    stmt = select(Prediction).order_by(Prediction.created_at.desc()).limit(limit)
    if user is not None:
        stmt = stmt.where(Prediction.user_id == user.id)

    from app.schemas.prediction import PredictionOut

    items = [
        PredictionOut.model_validate(r).model_dump(mode="json")
        for r in db.scalars(stmt).all()
    ]
    cache_set(key, items, HISTORY_TTL)
    return items