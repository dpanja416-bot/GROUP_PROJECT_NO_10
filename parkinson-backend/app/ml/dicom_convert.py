"""Converts a DICOM series (a .zip, or many .dcm files) into one 3D NIfTI file.
Uses only pydicom + nibabel (pure Python, no extra tools to install)."""
import shutil
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom

from app.core.config import settings

MIN_SLICES = 20


class DicomConversionError(ValueError):
    pass


def _extract_flat(zip_path: Path, dest: Path) -> list[Path]:
    """Extract files under generated names (so path tricks can't work) and
    stop if the unpacked data grows too large."""
    dest.mkdir(parents=True, exist_ok=True)
    limit = settings.max_unzipped_mb * 1024 * 1024
    written = 0
    files: list[Path] = []
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = [i for i in zf.infolist() if not i.is_dir()]
            if len(infos) > settings.max_zip_files:
                raise DicomConversionError(f"Zip has too many files (max {settings.max_zip_files}).")
            for idx, info in enumerate(infos):
                target = dest / f"f{idx:05d}.dcm"
                with zf.open(info) as src, open(target, "wb") as out:
                    while chunk := src.read(1024 * 1024):
                        written += len(chunk)
                        if written > limit:
                            raise DicomConversionError("Zip content is too large after unpacking.")
                        out.write(chunk)
                files.append(target)
    except zipfile.BadZipFile as exc:
        raise DicomConversionError("The uploaded zip file is corrupted.") from exc
    return files


def _round_tuple(values, digits=3):
    return tuple(round(float(v), digits) for v in values)


def convert_zip_to_nifti(zip_path: Path, workdir: Path) -> Path:
    files = _extract_flat(zip_path, workdir / "dicom")
    return convert_files_to_nifti(files, workdir)


def convert_files_to_nifti(files: list[Path], workdir: Path) -> Path:
    """files = the .dcm slices of one scan (from a zip or uploaded one by one)."""

    # 1) read headers only, group slices by series
    series: dict[str, list] = {}
    for path in files:
        try:
            ds = pydicom.dcmread(path, force=True, stop_before_pixels=True)
        except Exception:
            continue
        needed = ("ImagePositionPatient", "ImageOrientationPatient", "Rows", "Columns")
        if not all(hasattr(ds, tag) for tag in needed):
            continue
        series.setdefault(str(getattr(ds, "SeriesInstanceUID", "unknown")), []).append((path, ds))

    if not series:
        raise DicomConversionError(
            "No readable DICOM images found. Select all the .dcm files of ONE "
            "scan, or zip that folder.")

    # 2) the biggest series is the 3D scan (others are localizers etc.)
    _, items = max(series.items(), key=lambda kv: len(kv[1]))

    def geometry_key(ds):
        return (int(ds.Rows), int(ds.Columns), _round_tuple(ds.ImageOrientationPatient, 2))

    counts: dict = {}
    for _, ds in items:
        counts[geometry_key(ds)] = counts.get(geometry_key(ds), 0) + 1
    best_key = max(counts, key=counts.get)
    items = [(p, ds) for p, ds in items if geometry_key(ds) == best_key]

    # 3) order slices along the scan direction
    iop = np.array(items[0][1].ImageOrientationPatient, dtype=float)
    row_cos, col_cos = iop[:3], iop[3:]
    normal = np.cross(row_cos, col_cos)

    def position(ds):
        return np.array(ds.ImagePositionPatient, dtype=float)

    items.sort(key=lambda it: float(np.dot(position(it[1]), normal)))
    unique, last = [], None
    for p, ds in items:
        d = float(np.dot(position(ds), normal))
        if last is None or abs(d - last) > 1e-3:
            unique.append((p, ds))
            last = d
    items = unique

    n = len(items)
    if n < MIN_SLICES:
        raise DicomConversionError(
            f"Found only {n} slices in the largest series; a 3D MRI scan needs at "
            f"least {MIN_SLICES}. Make sure you selected the whole series.")

    # 4) build the 3D array
    rows, cols = int(items[0][1].Rows), int(items[0][1].Columns)
    volume = np.zeros((rows, cols, n), dtype=np.float32)
    for k, (path, _) in enumerate(items):
        try:
            full = pydicom.dcmread(path, force=True)
            pixels = full.pixel_array
        except Exception as exc:
            raise DicomConversionError(
                "Could not decode the DICOM pixel data (compressed or unusual DICOM format).") from exc
        if pixels.ndim != 2:
            raise DicomConversionError(
                "Multi-frame / enhanced DICOM is not supported. Export the scan as one file per slice.")
        slope = float(getattr(full, "RescaleSlope", 1) or 1)
        intercept = float(getattr(full, "RescaleIntercept", 0) or 0)
        volume[:, :, k] = pixels.astype(np.float32) * slope + intercept

    # 5) affine (DICOM uses LPS, NIfTI uses RAS)
    first, last_ds = items[0][1], items[-1][1]
    spacing = [float(v) for v in getattr(first, "PixelSpacing", [1.0, 1.0])]
    slice_vec = (position(last_ds) - position(first)) / (n - 1)

    affine_lps = np.eye(4)
    affine_lps[:3, 0] = col_cos * spacing[0]   # array axis 0 = row index
    affine_lps[:3, 1] = row_cos * spacing[1]   # array axis 1 = column index
    affine_lps[:3, 2] = slice_vec
    affine_lps[:3, 3] = position(first)
    affine_ras = np.diag([-1.0, -1.0, 1.0, 1.0]) @ affine_lps

    out = workdir / "converted.nii"
    image = nib.Nifti1Image(volume, affine_ras)
    image.set_qform(affine_ras, code=1)
    image.set_sform(affine_ras, code=1)
    nib.save(image, str(out))
    for name in ("dicom", "dicom_upload"):
        shutil.rmtree(workdir / name, ignore_errors=True)
    return out