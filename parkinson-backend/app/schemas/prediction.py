from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class PredictionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    patient_id: Optional[str] = None
    filename: str
    prediction: str
    confidence: float  # 0-100
    status: str
    model_version: str
    created_at: datetime
    input_format: Optional[str] = None  # only filled in the /predict response

    @field_validator("created_at")
    @classmethod
    def _force_utc(cls, v: datetime) -> datetime:
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v