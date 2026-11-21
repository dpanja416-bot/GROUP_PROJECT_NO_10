"""Routes the current frontend already calls: /api/history and /api/predict."""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.prediction import PredictionOut
from app.services import prediction_service

router = APIRouter(prefix="/api", tags=["scans"])


@router.get("/history",
            dependencies=[Depends(rate_limit("history", settings.history_rate_limit))])
def history(db: Session = Depends(get_db), user: Optional[User] = Depends(get_current_user)):
    return prediction_service.get_history(db, user)


# Plain `def` (not async): FastAPI runs it in a worker thread, so the slow
# model call does not block the whole server.
@router.post("/predict", response_model=PredictionOut,
             dependencies=[Depends(rate_limit("predict", settings.predict_rate_limit))])
def predict(
    files: List[UploadFile] = File(..., alias="file"),
    patient_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    return prediction_service.analyze_upload(db, files, patient_id, user)