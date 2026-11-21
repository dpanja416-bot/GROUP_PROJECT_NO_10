"""Prediction entry points.
 - predict_volume(): the real PyTorch ResNet18+CBAM model (USE_REAL_MODEL=true)
 - predict_dummy():  the old random placeholder (USE_REAL_MODEL=false)"""
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.ml import preprocessing

CLASS_NAMES = ["HC", "PD"]  # index 0 = healthy control, index 1 = Parkinson's
LABELS = {"HC": "Healthy", "PD": "Parkinson"}
IMAGE_SIZE = 160
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass
class PredictionResult:
    label: str              # "Parkinson" or "Healthy"
    confidence: float       # 0-100, confidence in the label shown
    pd_probability: float = 0.0   # 0-1
    slices_used: int = 0


_model = None
_transform = None
_lock = threading.Lock()


def load_model():
    """Load the weights once (first call or at server start)."""
    global _model, _transform
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model

        import torch
        from torchvision import transforms
        from torchvision.transforms import InterpolationMode
        from app.ml.model import ResNet18CBAM

        path = Path(settings.model_path)
        if not path.is_file():
            raise FileNotFoundError(
                f"Model weights not found at '{path}'. Put the .pth file there "
                f"or set MODEL_PATH in .env.")

        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        # weights_only=True: only tensors/plain data are loaded (safe against pickle attacks)
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)

        if checkpoint.get("architecture") != "ResNet18CBAM":
            raise ValueError("Checkpoint architecture is not ResNet18CBAM.")
        if list(checkpoint.get("class_names", [])) != CLASS_NAMES:
            raise ValueError(f"Unexpected class order: {checkpoint.get('class_names')}")
        if int(checkpoint.get("image_size", -1)) != IMAGE_SIZE:
            raise ValueError(f"Unexpected image size: {checkpoint.get('image_size')}")

        model = ResNet18CBAM(num_classes=len(CLASS_NAMES), pretrained=False)
        model.load_state_dict(checkpoint["model_state_dict"], strict=True)
        model.eval()

        _transform = transforms.Compose([
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE), interpolation=InterpolationMode.BILINEAR),
            transforms.Grayscale(num_output_channels=3),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])
        _model = model
        return _model


def predict_volume(nifti_path: Path) -> PredictionResult:
    import torch

    model = load_model()
    slices = preprocessing.extract_slices(nifti_path)             # 12 slices, 224x224
    batch = torch.stack([_transform(image) for image in slices])  # (12, 3, 160, 160)

    with torch.inference_mode():
        probabilities = torch.softmax(model(batch), dim=1)[:, CLASS_NAMES.index("PD")]

    pd_probability = float(probabilities.mean())   # subject score = mean over slices
    is_pd = pd_probability >= 0.5
    confidence = (pd_probability if is_pd else 1.0 - pd_probability) * 100.0
    return PredictionResult(
        label=LABELS["PD" if is_pd else "HC"],
        confidence=round(confidence, 2),
        pd_probability=round(pd_probability, 4),
        slices_used=len(slices),
    )


def predict_dummy(file_hash: str) -> PredictionResult:
    """Placeholder: deterministic fake result from the file hash."""
    digest = bytes.fromhex(file_hash)
    label = "Parkinson" if digest[0] % 2 == 0 else "Healthy"
    confidence = round(70.0 + (digest[1] / 255) * 29.0, 2)
    return PredictionResult(label=label, confidence=confidence)