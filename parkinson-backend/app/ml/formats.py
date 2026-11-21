from pathlib import Path


def detect_format(path: Path, filename: str = "") -> str:
    """Detect the real file type from its first bytes (not from the extension).
    Returns: nifti | nifti_gz | zip | dicom_single | png | jpeg | unknown"""
    with open(path, "rb") as f:
        head = f.read(400)
    if head[:2] == b"\x1f\x8b":
        return "nifti_gz"
    if head[344:348] in (b"n+1\x00", b"ni1\x00"):
        return "nifti"
    if head[:4] in (b"PK\x03\x04", b"PK\x05\x06"):
        return "zip"
    if head[128:132] == b"DICM":
        return "dicom_single"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if filename.lower().endswith((".dcm", ".dicom")):
        return "dicom_single"
    return "unknown"