"""Run the full pipeline on one file from the command line.
Usage (from parkinson-backend, venv active):
    python scripts/predict_file.py path/to/scan.nii.gz
    python scripts/predict_file.py path/to/dicom_series.zip
Compare the printed pd_probability with the value from the notebook."""
import hashlib
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml import predictor  # noqa: E402
from app.services.prediction_service import run_model_on_file  # noqa: E402


def main(path: str):
    source = Path(path)
    with tempfile.TemporaryDirectory(prefix="mri_") as tmp:
        workdir = Path(tmp)
        raw = workdir / "upload.bin"
        shutil.copyfile(source, raw)
        file_hash = hashlib.sha256(raw.read_bytes()).hexdigest()
        result, input_format = run_model_on_file(raw, source.name, file_hash, workdir)
    print("input format  :", input_format)
    print("label         :", result.label)
    print("confidence    :", result.confidence, "%")
    print("pd_probability:", result.pd_probability)
    print("slices used   :", result.slices_used)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/predict_file.py <file>")
    main(sys.argv[1])