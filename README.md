# Parkinson MRI Analysis

Attention-based deep learning system for early detection of Parkinson's disease from brain MRI.
Users upload a T1 MRI scan (NIfTI or DICOM), the backend converts it if needed, runs a trained
**ResNet18 + CBAM** model, and returns the result to a React dashboard.

> **Research prototype. Not a medical device and not a clinical diagnosis.**

| Part | Folder | Tech |
|---|---|---|
| Backend API | `parkinson-backend/` | FastAPI, SQLAlchemy, SQLite/PostgreSQL, JWT (PyJWT, Argon2), PyTorch, nibabel, pydicom |
| Frontend | `parkinson-frontend/` | React, Vite, Recharts |

---

## Features

- **MRI analysis:** upload a `.nii` / `.nii.gz` file, a DICOM series (all `.dcm` files of one scan, or a `.zip` of them), and get a prediction.
- **Automatic format handling:** the backend detects the real file type from its content. NIfTI is used directly; a DICOM series is converted to NIfTI inside the application.
- **Model:** ResNet18 with a CBAM attention block (PyTorch). It scores 12 axial slices of the scan and averages the Parkinson's probability.
- **Authentication:** register and login with JWT tokens and Argon2 password hashing. With login on, each user sees only their own scans.
- **Protection:** file type, size and content checks, zip safety limits, rate limiting (login returns `429` after 5 attempts a minute), and result caching. Redis is used when configured, otherwise an in-memory fallback.
- **Privacy:** only prediction **results** are stored (patient ID, filename, prediction, score, time). MRI files are processed in a temporary folder and deleted immediately.
- **Dashboard:** overview, MRI analysis, patient history and analytics charts.

---

## Requirements

- Python 3.10 or newer (3.12 recommended)
- Node.js LTS (20.19 or newer) and npm
- Git
- The model weights file `new_resnet18_cbam_best.pth` (about 45 MB, not stored in git)

---

## 1. Backend (Terminal 1)

### First time only

```powershell
cd parkinson-backend
python -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
```

The install takes a few minutes because PyTorch is large.

**Add the model weights.** Place the file here (create the folder if needed):

```
parkinson-backend/app/ml/weights/new_resnet18_cbam_best.pth
```

**Create `parkinson-backend/.env`:**

```
APP_NAME=Parkinson MRI API
DEBUG=true
DATABASE_URL=sqlite:///./parkinson.db
CORS_ORIGINS=http://localhost:5173
AUTH_REQUIRED=false
SECRET_KEY=replace-with-a-long-random-string
ACCESS_TOKEN_EXPIRE_MINUTES=60
REDIS_URL=
LOGIN_RATE_LIMIT=5
PREDICT_RATE_LIMIT=30
HISTORY_RATE_LIMIT=60
MAX_UPLOAD_MB=200
MODEL_VERSION=resnet18-cbam-v1
USE_REAL_MODEL=true
MODEL_PATH=app/ml/weights/new_resnet18_cbam_best.pth
MAX_CONCURRENT_PREDICTIONS=1
```

Generate a secret key:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set `USE_REAL_MODEL=false` to run with a random placeholder model (no weights or PyTorch needed at runtime).

### Every time you run it

```powershell
cd parkinson-backend
venv\Scripts\activate
python -m uvicorn app.main:app --reload
```

You should see:

```
[startup] Redis: not used (memory fallback)
[startup] Real model loaded (resnet18-cbam-v1)
Uvicorn running on http://127.0.0.1:8000
```

Mac/Linux: activate with `source venv/bin/activate`.

**Check it works**

- API docs (Swagger): http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health
- Ready: http://127.0.0.1:8000/ready

### Test the model from the command line

```powershell
python scripts\predict_file.py path\to\scan.nii.gz
python scripts\predict_file.py path\to\dicom_series.zip
```

It prints the label, score and `pd_probability`.

---

## 2. Frontend (Terminal 2)

### First time only

```powershell
cd parkinson-frontend
npm install
```

Create `parkinson-frontend/.env`:

```
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_AUTH_REQUIRED=false
```

### Every time you run it

```powershell
cd parkinson-frontend
npm run dev
```

Open http://localhost:5173

- Login: http://localhost:5173/login
- Register: http://localhost:5173/register

After changing a frontend `.env`, stop the server (Ctrl + C) and run `npm run dev` again.

---

## 3. Login mode

| Mode | Backend `.env` | Frontend `.env` |
|---|---|---|
| Demo (no login needed) | `AUTH_REQUIRED=false` | `VITE_AUTH_REQUIRED=false` |
| Login required | `AUTH_REQUIRED=true` | `VITE_AUTH_REQUIRED=true` |

Set both to the same value and restart both servers.

---

## 4. Using the app

1. Open http://localhost:5173 (register and log in if login mode is on).
2. Go to **MRI Analysis** and add a scan:
   - a `.nii` / `.nii.gz` file, **or**
   - **Choose a DICOM folder** (the `.dcm` files of ONE scan), or select all the `.dcm` files, **or**
   - a `.zip` containing the DICOM folder.
3. Optionally enter a Patient ID and click **Run MRI analysis**.
4. View results in **Overview**, **Patient History** and **Analytics**.

Notes:

- A single `.dcm` file is only one slice and is rejected. Upload the whole series.
- JPG and PNG are not accepted by the real model, because it needs a 3D scan.
- Analysis takes a few seconds (reading the scan and scoring 12 slices).
- One request can carry about 1000 files. Use a `.zip` for larger series.

---

## 5. API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/predict` | Upload a scan (form fields: `file` one or many, `patient_id`) |
| GET | `/api/history` | List scan results |
| POST | `/api/v1/auth/register` | Create an account |
| POST | `/api/v1/auth/login` | Get a JWT token |
| GET | `/api/v1/auth/me` | Current user (needs token) |
| GET | `/health` | Server is up |
| GET | `/ready` | Database and Redis status |

Send the token as `Authorization: Bearer <token>`.

The `confidence` value in a result is the model's softmax probability for the predicted class (the Parkinson's probability averaged over 12 slices, or its complement for Healthy). It is a **model score, not a calibrated probability or clinical certainty**.

---

## 6. How a prediction works

```
Upload -> detect real file type (NIfTI / DICOM zip / many .dcm)
       -> DICOM series? convert to a 3D NIfTI volume (pydicom + nibabel)
       -> canonical orientation, intensity normalisation (1st-99th percentile)
       -> select 12 axial slices (20-80% depth, foreground filter)
       -> resize to 160x160, 3-channel grayscale, ImageNet normalisation
       -> ResNet18 + CBAM -> softmax -> average Parkinson's probability over slices
       -> label (>= 0.5 = Parkinson) + score -> save result in the database
       -> temporary files deleted
```

The preprocessing is copied from the training notebooks and must not be changed.

---

## 7. Project structure

```
parkinson-backend/
  app/
    main.py               app entry point
    core/                 settings, security (JWT, Argon2), rate limiter
    db/                   database session, Redis client
    models/               SQLAlchemy tables (users, predictions)
    schemas/              request/response shapes
    routers/              auth, legacy (/api/predict, /api/history), health
    services/             prediction pipeline, cache
    ml/                   model, preprocessing, DICOM conversion, predictor, weights/
  scripts/predict_file.py command-line model test
parkinson-frontend/
  src/
    dashboard.jsx         main dashboard and upload
    pages/                login and register pages
    context/              auth state
    services/             API client
```

---

## 8. Model information

- Architecture: ResNet18 backbone with a CBAM attention block, 2 classes (healthy control, Parkinson's).
- Data: PPMI T1-weighted structural MRI (the dataset is **not** included and must not be redistributed).
- Evaluation on a held-out test set of 46 subjects (35 Parkinson's, 11 healthy): accuracy 80.4%, ROC AUC 0.79, Parkinson's recall 97%, healthy recall 27%, balanced accuracy 62%.

The model finds Parkinson's scans well but misclassifies most healthy scans, and the test set is small. Treat results as a prototype output that needs more data, threshold tuning and clinical validation.

---

## 9. Reset the database

Stop the backend, delete `parkinson-backend/parkinson.db`, and start it again.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `uvicorn` or modules not found | Activate the venv and use `python -m uvicorn` / `python -m pip` |
| Prompt shows `(base)` and Anaconda errors | Run `conda deactivate`, then activate `venv` again |
| `Model weights not found` at startup | Put the `.pth` file at `parkinson-backend/app/ml/weights/` or fix `MODEL_PATH` |
| `Failed to fetch` in the browser | The backend isn't running, or `VITE_API_BASE_URL` is wrong |
| CORS error in the browser console | Check `CORS_ORIGINS=http://localhost:5173` in the backend `.env` |
| "A single DICOM file is only one slice" | Select all `.dcm` files of the scan, use the folder button, or upload a `.zip` |
| "Found only N slices" | The upload is incomplete; include the whole series |
| "needs a 3D MRI scan ... not a 2D image" | Upload NIfTI or a DICOM series instead of JPG/PNG |
| `429 Too many requests` | Wait a minute, or raise the limit in the backend `.env` |
| `psycopg2-binary` fails to install | Remove that line from `requirements.txt` (only needed for PostgreSQL) |
| `react-router-dom` not found | Run `npm install` in `parkinson-frontend` |
| Port already in use | Close the old terminal, or use `--port 8001` and update `VITE_API_BASE_URL` |
| Venv broken after moving the folder | Delete `venv` and recreate it (First time only steps) |

---

## 11. Security notes

- `.env`, model weights (`*.pth`) and scans (`*.nii`, `*.nii.gz`) are git-ignored. Never commit them.
- Use a long random `SECRET_KEY` and keep `AUTH_REQUIRED=true` outside demos.
- Only upload data you are authorised to process.

---

## 12. Roadmap

- PostgreSQL and Alembic migrations (the demo uses SQLite with auto-created tables)
- Background job queue and workers so slow scans don't block the API
- Redis in production for shared rate limiting and caching
- Refresh tokens and token revocation
- Model improvements: more data, threshold tuning, calibrated probabilities, Grad-CAM heatmaps
- Docker Compose, then Kubernetes deployment with CI/CD
- Automated tests (pytest) for upload validation, conversion and auth
