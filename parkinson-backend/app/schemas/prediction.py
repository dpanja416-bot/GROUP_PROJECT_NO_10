from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class PredictionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: Optional[str] = None
    filename: str
    prediction: str
    confidence: float  # 0-100
    status: str
    model_version: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def _force_utc(cls, v: datetime) -> datetime:
        # SQLite returns naive datetimes; mark them UTC so the browser shows local time correctly
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v