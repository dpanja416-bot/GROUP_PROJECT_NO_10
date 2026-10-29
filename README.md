# Parkinson MRI Analysis

Attention-based deep learning framework for early detection of Parkinson's disease from brain MRI images.

| Part | Folder | Tech |
|---|---|---|
| Backend API | `parkinson-backend/` | FastAPI, SQLAlchemy, SQLite/PostgreSQL, JWT |
| Frontend | `parkinson-frontend/` | React, Vite |

> **Status:** the model is currently a **dummy placeholder** (results are random but repeatable).
> The real model plugs into `parkinson-backend/app/ml/predictor.py`.

---

## Requirements

- Python 3.10 or newer
- Node.js LTS (20.19 or newer) and npm
- Git

---

## 1. Backend (run in Terminal 1)

### First time only

```powershell
cd parkinson-backend
python -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
```

Create a file named `.env` inside `parkinson-backend/` (copy the template below):

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
MAX_UPLOAD_MB=50
MODEL_VERSION=dummy-0.1
```

Generate a secret key:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Every time you run it

```powershell
cd parkinson-backend
venv\Scripts\activate
python -m uvicorn app.main:app --reload
```

You should see:

```
[startup] Redis: not used (memory fallback)
Uvicorn running on http://127.0.0.1:8000
```

Mac/Linux: activate with `source venv/bin/activate` instead.

**Check it works**

- API docs (Swagger): http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health
- Ready: http://127.0.0.1:8000/ready

---

## 2. Frontend (run in Terminal 2)

### First time only

```powershell
cd parkinson-frontend
npm install
```

Create a file named `.env` inside `parkinson-frontend/`:

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

- Login page: http://localhost:5173/login
- Register page: http://localhost:5173/register

After changing a frontend `.env`, stop the server (Ctrl + C) and run `npm run dev` again.

---

## 3. Login mode

| Mode | Backend `.env` | Frontend `.env` |
|---|---|---|
| Demo (no login needed) | `AUTH_REQUIRED=false` | `VITE_AUTH_REQUIRED=false` |
| Login required | `AUTH_REQUIRED=true` | `VITE_AUTH_REQUIRED=true` |

Set both to the same value, then restart both servers. With login on, each user sees only their own scans.

---

## 4. Using the app

1. Open http://localhost:5173 (register and log in if login mode is on).
2. Go to **MRI Analysis**, choose a JPG, PNG, DICOM or NIfTI file, optionally enter a Patient ID, and run the analysis.
3. View results in **Patient History** and **Analytics**.

Only prediction **results** are stored. MRI files are never saved.

---

## 5. Main API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/predict` | Upload a scan (form fields: `file`, `patient_id`) |
| GET | `/api/history` | List scan results |
| POST | `/api/v1/auth/register` | Create an account |
| POST | `/api/v1/auth/login` | Get a JWT token |
| GET | `/api/v1/auth/me` | Current user (needs token) |
| GET | `/health`, `/ready` | Server status |

Protection: file type and size checks, rate limiting (login returns `429` after too many attempts), and result caching.

---

## 6. Reset the database

Stop the backend, delete `parkinson-backend/parkinson.db`, and start it again.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `uvicorn` or modules not found | Activate the venv and use `python -m uvicorn` / `python -m pip` |
| Prompt shows `(base)` and Anaconda errors | Run `conda deactivate`, then activate `venv` again |
| `Failed to fetch` in the browser | The backend isn't running, or `VITE_API_BASE_URL` is wrong |
| CORS error in the browser console | Check `CORS_ORIGINS=http://localhost:5173` in the backend `.env` |
| `react-router-dom` not found | Run `npm install` in `parkinson-frontend` |
| Port already in use | Close the old terminal, or use `--port 8001` and update `VITE_API_BASE_URL` |
| Venv broken after moving the folder | Delete `venv`, then recreate it (First time only steps) |

---

## 8. Roadmap

- Integrate the trained attention-based CNN model
- PostgreSQL and Alembic migrations
- Redis (rate limiting and cache) and an async job queue with workers
- Docker Compose, then Kubernetes deployment with CI/CD