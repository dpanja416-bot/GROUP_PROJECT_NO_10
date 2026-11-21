"""Preprocessing copied from the training notebook (ResNet_CBAM_data_preprocessing).
Do NOT change these numbers: the model was trained with exactly this pipeline."""
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image

from app.core.config import settings

SLICES_PER_SUBJECT = 12
LOWER_DEPTH_FRACTION = 0.20
UPPER_DEPTH_FRACTION = 0.80
MIN_FOREGROUND_FRACTION = 0.02
OUTPUT_SIZE = 224


def normalize_volume(volume):
    volume = np.asarray(volume, dtype=np.float32)
    finite = np.isfinite(volume)
    nonzero = finite & (volume != 0)
    if nonzero.sum() < 100:
        raise ValueError("The scan has too few non-empty voxels to analyse.")
    values = volume[nonzero]
    lo, hi = np.percentile(values, [1.0, 99.0])
    if not np.isfinite(lo + hi) or hi <= lo:
        raise ValueError("The scan has an invalid intensity range.")
    clipped = np.clip(volume, lo, hi)
    normalized = (clipped - lo) / (hi - lo)
    normalized[~finite | ~nonzero] = 0.0
    return normalized


def select_axial_indices(volume, count=SLICES_PER_SUBJECT):
    depth = volume.shape[2]
    start = max(0, int(round(depth * LOWER_DEPTH_FRACTION)))
    stop = min(depth, int(round(depth * UPPER_DEPTH_FRACTION)))
    candidates = []
    for z in range(start, max(start + 1, stop)):
        plane = volume[:, :, z]
        if np.mean(plane > 0.05) >= MIN_FOREGROUND_FRACTION:
            candidates.append(z)
    if not candidates:
        raise ValueError("No usable brain slices found in the scan.")
    positions = np.linspace(0, len(candidates) - 1, min(count, len(candidates)))
    return sorted({candidates[int(round(pos))] for pos in positions})


def slice_to_uint8(plane):
    return np.round(np.clip(plane, 0, 1) * 255).astype(np.uint8)


def load_canonical_volume(path: Path) -> np.ndarray:
    try:
        nii = nib.load(str(path))
    except Exception as exc:
        raise ValueError("The file could not be read as a NIfTI scan.") from exc

    shape = tuple(nii.shape)
    if len(shape) == 4 and shape[3] == 1:
        shape = shape[:3]
    if len(shape) != 3:
        raise ValueError(f"Expected a 3D T1 MRI volume, got shape {tuple(nii.shape)}.")
    if int(np.prod(shape)) > settings.max_volume_voxels:
        raise ValueError("The scan is too large to process.")

    try:
        nii = nib.as_closest_canonical(nii)
        volume = nii.get_fdata(dtype=np.float32)
    except Exception as exc:
        raise ValueError("The NIfTI file is corrupted or incomplete.") from exc

    if volume.ndim == 4 and volume.shape[3] == 1:
        volume = volume[..., 0]
    return volume


def extract_slices(path: Path) -> list[Image.Image]:
    """NIfTI file -> list of 224x224 grayscale slices (same as training)."""
    volume = normalize_volume(load_canonical_volume(path))
    slices = []
    for z in select_axial_indices(volume):
        plane = slice_to_uint8(volume[:, :, z])
        image = Image.fromarray(plane).resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.BILINEAR)
        slices.append(image)
    return slices