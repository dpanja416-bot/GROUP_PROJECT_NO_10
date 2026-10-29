"""
Dummy model. Replace the body of predict() with the real model later.
The rest of the backend only calls predict() and never changes.
"""
import hashlib
from dataclasses import dataclass


@dataclass
class PredictionResult:
    label: str  # "Parkinson" or "Healthy"
    confidence: float  # 0-100


def predict(file_bytes: bytes, filename: str) -> PredictionResult:
    # Deterministic fake result: the same file always gives the same answer.
    digest = hashlib.sha256(file_bytes).digest()
    label = "Parkinson" if digest[0] % 2 == 0 else "Healthy"
    confidence = 70.0 + (digest[1] / 255) * 29.0  # 70.0 - 99.0
    return PredictionResult(label=label, confidence=round(confidence, 2))