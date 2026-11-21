import hashlib
import secrets
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ml import dicom_convert, predictor
from app.ml.formats import detect_format
from app.models.prediction import Prediction
from app.models.user import User
from app.schemas.prediction import PredictionOut
from app.services.cache_service import cache_delete_prefix, cache_get, cache_set

CHUNK = 1024 * 1024
HISTORY_TTL = 10     # seconds
RESULT_TTL = 3600    # seconds

# Only N scans are analysed at the same time (the model is CPU heavy)
_heavy = threading.BoundedSemaphore(settings.max_concurrent_predictions)


class InputError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------- upload handling ----------
def save_upload(file: UploadFile, dest: Path) -> tuple[int, str]:
    """Stream the upload to a temp file, enforcing the size limit and hashing it."""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    digest, size = hashlib.sha256(), 0
    with open(dest, "wb") as out:
        while chunk := file.file.read(CHUNK):
            size += len(chunk)
            if size > max_bytes:
                raise InputError(f"File too large (max {settings.max_upload_mb} MB).", 413)
            digest.update(chunk)
            out.write(chunk)
    if size == 0:
        raise InputError("Empty file.", 400)
    return size, digest.hexdigest()


def save_dicom_files(files: list[UploadFile], workdir: Path) -> tuple[list[Path], str]:
    """Several .dcm files uploaded together = ONE scan series."""
    if len(files) > settings.max_zip_files:
        raise InputError(f"Too many files (max {settings.max_zip_files}).", 413)
    folder = workdir / "dicom_upload"
    folder.mkdir()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    total, paths, digests = 0, [], []
    for index, item in enumerate(files):
        target = folder / f"f{index:05d}.dcm"
        digest = hashlib.sha256()
        with open(target, "wb") as out:
            while chunk := item.file.read(CHUNK):
                total += len(chunk)
                if total > max_bytes:
                    raise InputError(f"Upload too large (max {settings.max_upload_mb} MB).", 413)
                digest.update(chunk)
                out.write(chunk)
        paths.append(target)
        digests.append(digest.hexdigest())
    if total == 0:
        raise InputError("Empty upload.", 400)
    # same files in any order -> same hash (used for the result cache)
    combined = hashlib.sha256("".join(sorted(digests)).encode()).hexdigest()
    return paths, combined


def run_model_on_dicom_files(paths: list[Path], file_hash: str, workdir: Path):
    """Returns (PredictionResult, input_format_text)."""
    if not settings.use_real_model:
        return predictor.predict_dummy(file_hash), "DICOM series"
    try:
        nifti = dicom_convert.convert_files_to_nifti(paths, workdir)
    except dicom_convert.DicomConversionError as exc:
        raise InputError(str(exc), 422)
    try:
        return predictor.predict_volume(nifti), "DICOM series (converted to NIfTI)"
    except ValueError as exc:
        raise InputError(str(exc), 422)


# ---------- the pipeline: detect format -> convert if needed -> model ----------
def run_model_on_file(raw: Path, filename: str, file_hash: str, workdir: Path):
    """Returns (PredictionResult, input_format_text)."""
    kind = detect_format(raw, filename)

    if not settings.use_real_model:  # demo / placeholder mode
        if kind == "unknown":
            raise InputError("Unsupported file type. Upload NIfTI, DICOM zip, JPG or PNG.")
        return predictor.predict_dummy(file_hash), kind

    if kind in ("nifti", "nifti_gz"):
        nifti = workdir / ("volume.nii.gz" if kind == "nifti_gz" else "volume.nii")
        raw.replace(nifti)
        input_format = "NIfTI"
    elif kind == "zip":
        try:
            nifti = dicom_convert.convert_zip_to_nifti(raw, workdir)
        except dicom_convert.DicomConversionError as exc:
            raise InputError(str(exc), 422)
        input_format = "DICOM series (converted to NIfTI)"
    elif kind == "dicom_single":
        raise InputError(
            "A single DICOM file is only one slice. Upload the whole scan series "
            "as a .zip, or a .nii / .nii.gz file.")
    elif kind in ("png", "jpeg"):
        raise InputError(
            "This model needs a 3D MRI scan (NIfTI, or a DICOM series in a .zip), "
            "not a 2D image.")
    else:
        raise InputError("Unsupported file. Upload .nii, .nii.gz, or a .zip of a DICOM series.")

    try:
        return predictor.predict_volume(nifti), input_format
    except ValueError as exc:  # unreadable/invalid scan
        raise InputError(str(exc), 422)


def generate_patient_id() -> str:
    """e.g. PT-20261122-A1B2C3"""
    return f"PT-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}"


# ---------- main entry used by the route ----------
def analyze_upload(db: Session, files: list[UploadFile], patient_id: Optional[str],
                   user: Optional[User]) -> Prediction:
    """One file (NIfTI / zip) or several .dcm files that together are one scan."""
    started = time.perf_counter()
    multi = len(files) > 1
    filename = f"DICOM series ({len(files)} files)" if multi else (files[0].filename or "scan")

    with tempfile.TemporaryDirectory(prefix="mri_") as tmp:  # deleted automatically
        workdir = Path(tmp)
        try:
            if multi:
                paths, file_hash = save_dicom_files(files, workdir)
            else:
                raw = workdir / "upload.bin"
                _, file_hash = save_upload(files[0], raw)

            cache_key = f"pred:{file_hash}:{settings.model_version}"
            cached = cache_get(cache_key)
            if cached is not None:
                label, confidence = cached["label"], cached["confidence"]
                input_format = cached.get("input_format")
            else:
                with _heavy:
                    if multi:
                        result, input_format = run_model_on_dicom_files(paths, file_hash, workdir)
                    else:
                        result, input_format = run_model_on_file(raw, filename, file_hash, workdir)
                label, confidence = result.label, result.confidence
                cache_set(cache_key, {"label": label, "confidence": confidence,
                                      "input_format": input_format}, RESULT_TTL)
        except InputError as exc:
            raise HTTPException(exc.status_code, exc.message)

    row = Prediction(
        user_id=user.id if user else None,
        patient_id=(patient_id or "").strip()[:64] or generate_patient_id(),
        filename=filename[:255],
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
    cache_delete_prefix("history:")
    row.input_format = input_format  # returned to the frontend, not stored
    return row


# ---------- history ----------
def get_history(db: Session, user: Optional[User], limit: int = 500) -> list[dict]:
    key = f"history:{user.id if user else 'all'}"
    cached = cache_get(key)
    if cached is not None:
        return cached

    stmt = select(Prediction).order_by(Prediction.created_at.desc()).limit(limit)
    if user is not None:
        stmt = stmt.where(Prediction.user_id == user.id)

    items = [PredictionOut.model_validate(r).model_dump(mode="json")
             for r in db.scalars(stmt).all()]
    cache_set(key, items, HISTORY_TTL)
    return items