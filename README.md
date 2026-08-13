# NeuroTrackAI

Multimodal AI-powered early neurological screening. Analyses **voice, facial expression, hand
movement and gait** from a five-minute session, fuses them into a single tracked health score, and
builds a weekly/monthly picture of how that score moves over time.

> **NeuroTrackAI is a screening and wellness-tracking aid, not a diagnostic device.** It cannot
> diagnose Parkinson's disease or any other condition. It exists to help someone notice a trend and
> start a conversation with a clinician earlier than they otherwise would.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18 or newer (20+ recommended) | <https://nodejs.org> — `node -v` to check |
| **MongoDB** | 6 or newer | Local install **or** a free MongoDB Atlas cluster (see below) |
| **Browser** | Chrome or Edge | Needed for camera capture and the MediaPipe WASM runtime |
| **Internet** | First run only | MediaPipe downloads ~15 MB of models once, then caches them |

### Getting MongoDB

**Option A — local install** (recommended for development)

- Windows/macOS: [MongoDB Community Server](https://www.mongodb.com/try/download/community). On Windows
  it installs as a service and starts automatically; if not, run `net start MongoDB` as administrator.
- Linux: `sudo apt install mongodb` (or follow the official docs), then `sudo systemctl start mongod`.
- macOS via Homebrew: `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`

Nothing to configure — the default `MONGODB_URI` already points at `mongodb://127.0.0.1:27017/neurotrackai`,
and the database and collections are created automatically on first write.

**Option B — MongoDB Atlas** (no local install)

Create a free M0 cluster at <https://www.mongodb.com/atlas>, add your IP under *Network Access*,
create a database user, then copy the connection string into `MONGODB_URI` in `server/.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/neurotrackai
```

---

## Clone and run

```bash
git clone <repository-url>
cd NeuroTrackAi

npm run install:all                 # root + server + client dependencies

# create your local config (the defaults work as-is for local MongoDB)
cp server/.env.example server/.env  # Windows CMD:        copy server\.env.example server\.env
                                    # Windows PowerShell: Copy-Item server\.env.example server\.env

npm run seed                        # optional: demo account with 6 months of history
npm run dev                         # API on :5000, app on :5173
```

Open <http://localhost:5173>.

**Demo login** (after `npm run seed`):

```
email:    demo@neurotrackai.com
password: Demo1234
```

Or register a fresh account — it starts with an empty dashboard and prompts for a first assessment.

> **`server/.env` is gitignored and is not in the repository.** Every developer creates their own
> from `server/.env.example`. The committed defaults are safe for local development; the JWT secrets
> must be replaced before deploying anywhere real (see [Configuration](#configuration)).

### First-run checklist

1. Is MongoDB running? The server prints `[db] connected -> ...` on success and an explicit hint if not.
2. Allow **camera** and **microphone** when the browser prompts — the assessment cannot run otherwise.
3. Keep an internet connection for the very first assessment so the MediaPipe models can download.

---

## What actually happens during an assessment

This is not a mock. Each test captures a real signal, extracts real measurements in the browser, and
sends only a small numeric feature vector to the server for scoring. **Audio and video never leave
the device.**

| Module | Capture | Measurements extracted |
|---|---|---|
| **Voice** | 8 s sustained vowel + 12 s read sentence, via `MediaRecorder` | Jitter, shimmer, harmonics-to-noise ratio, pitch spread (semitones), pause ratio, speech rate, max phonation time, loudness CV |
| **Face** | 18 s webcam, MediaPipe FaceLandmarker (478 landmarks + 52 blendshapes) | Blink rate, expressivity index, smile/brow amplitude, left–right asymmetry, jaw range, eye aperture symmetry |
| **Hand** | 15 s finger tapping + 12 s postural hold, MediaPipe HandLandmarker | Tap frequency, amplitude, amplitude decrement, inter-tap CV, hesitations, dominant tremor frequency (FFT), 3.5–6.5 Hz band power ratio, postural drift |
| **Gait** | 22 s marching in place, MediaPipe PoseLandmarker | Cadence, step-time CV, step symmetry, arm swing amplitude and asymmetry, trunk sway, forward lean, double-support proxy |

### How a score is produced

1. **Browser** extracts the feature vector (`client/src/lib/`).
   Voice uses a hand-written DSP toolkit — normalised square-difference pitch tracking, Hann-windowed
   radix-2 FFT, peak picking. Vision modules accumulate landmark traces and analyse them
   (`faceFeatures.js`, `handFeatures.js`, `gaitFeatures.js`).
2. **Server** maps each feature onto a 0–100 sub-score using published reference ranges
   (`server/src/services/scoring/`). Praat voice-report norms for jitter/shimmer/HNR; MDS-UPDRS motor
   task descriptions for the hand tasks; gait-lab cadence and variability norms for gait.
3. **Fusion** takes a quality-weighted mean of the completed modules, applies a *weakest-link*
   correction (one poor modality is not washed out by three good ones, because early signs usually
   appear in one domain first), and caps partial assessments.
4. **Recommendations** are generated from the resulting flags and score deltas
   (`server/src/services/recommendations.js`).

Raw feature vectors are stored alongside every score, so historical assessments can be re-scored if
the engine is ever tuned.

---

## Stack

**Frontend** — React 18, Vite, Tailwind CSS, React Router, Recharts, MediaPipe Tasks Vision, Web Audio API
**Backend** — Node.js, Express, MongoDB (Mongoose), JWT with refresh-token rotation, PDFKit, node-cron, Nodemailer, Zod

```
NeuroTrackAi/
├── client/
│   └── src/
│       ├── api/          fetch wrapper with automatic token refresh
│       ├── components/   layout, shared UI, icons
│       ├── context/      auth, theme, toast
│       ├── features/     the four assessment tests
│       ├── hooks/        useVisionRecorder (camera + landmarker + rAF loop)
│       ├── lib/          DSP, audio features, MediaPipe loaders, landmark analysis
│       └── pages/        landing, auth, dashboard, assessment, result, reports, history, profile, settings
└── server/
    ├── scripts/seed.js
    └── src/
        ├── controllers/  auth, user, assessment, dashboard, report
        ├── jobs/         weekly reminder + monthly report cron
        ├── middleware/   auth guard, validation, error handling
        ├── models/       User, Assessment, Report
        ├── routes/
        ├── services/
        │   ├── scoring/  voice, face, hand, gait, fusion
        │   ├── pdf.js    report and assessment PDFs
        │   ├── reports.js
        │   └── mailer.js
        └── validators/
```

---

## Features

**Landing** — product explainer, the four modalities, how it works, disclaimer.
**Auth** — register with age/gender, login with working "Remember me", password strength meter, forgot-password endpoint, JWT access tokens with rotating httpOnly refresh cookies.
**Dashboard** — overall score, risk band, assessments this month, next-assessment countdown, trend chart, per-module scores, top recommendations, recent reports.
**Assessment** — five-step guided flow with live landmark overlays, tracking indicators, per-test retake, skip support, data-quality warnings and a review screen before submission.
**Result** — score ring, risk band, module bars, expandable per-measurement tables showing each value against its typical range, prioritised recommendations, PDF download.
**Reports** — monthly reports with month-over-month chart, expandable summaries, module averages, PDF download.
**History** — filterable, paginated record table, per-module trend chart, PDF download and delete per record.
**Profile** — editable details, DOB→age sync, password change (revokes other sessions), full JSON data export.
**Settings** — dark mode, email/reminder toggles, language, date and time format with live previews, logout, account deletion with typed confirmation.

Extras beyond the original spec: data-quality gating so a bad recording is flagged rather than
silently scored, weakest-link fusion, per-measurement breakdowns with reference ranges, page-numbered
PDFs, GDPR-style export and delete, weakest-module summaries, and a seeder that runs synthetic data
through the real engine so demo history is internally consistent.

---

## API

All routes are under `/api`. Authenticated routes need `Authorization: Bearer <accessToken>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Sign in |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Sign out |
| POST | `/auth/forgot-password` | Request reset link |
| GET | `/auth/me` | Current user |
| GET/PATCH | `/users/profile` | Read/update profile |
| POST | `/users/change-password` | Change password |
| GET/PATCH | `/users/settings` | Read/update settings |
| GET | `/users/export` | Full JSON data export |
| DELETE | `/users/account` | Delete account and all data |
| POST | `/assessments` | Submit feature vectors, get analysis |
| GET | `/assessments` | Paginated history (`page`, `limit`, `riskLevel`, `from`, `to`) |
| GET | `/assessments/latest` | Most recent assessment |
| GET | `/assessments/:id` | One assessment |
| GET | `/assessments/:id/pdf` | Assessment PDF |
| DELETE | `/assessments/:id` | Delete assessment |
| GET | `/dashboard` | Dashboard aggregate |
| GET | `/dashboard/trends` | Per-module score series |
| GET | `/reports` | Monthly reports |
| POST | `/reports/generate` | Regenerate current month |
| POST | `/reports/rebuild` | Rebuild every month |
| GET | `/reports/:id/pdf` | Report PDF |

---

## Configuration

Everything lives in `server/.env` (see `server/.env.example`). The only value you must set for local
development is `MONGODB_URI`, and the default already points at a local MongoDB.

Email is **optional** — leave `SMTP_HOST` empty and the app runs normally, logging skipped mail
instead of sending it. Set it to enable weekly reminders, monthly report emails and password reset.

Before deploying, replace `JWT_SECRET` and `JWT_REFRESH_SECRET` with long random strings:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Scripts

| Command | What it does |
|---|---|
| `npm run install:all` | Install all three package sets |
| `npm run dev` | Run API and client together |
| `npm run dev:server` / `npm run dev:client` | Run one side only |
| `npm run seed` | Reset and reseed the demo account (`-- --keep` preserves existing data) |
| `npm run build` | Production build of the client |
| `npm start` | Run the API alone (serve `client/dist` behind your own web server) |

---

## Browser support and privacy

Chrome or Edge is recommended — camera capture and the MediaPipe WASM runtime are best supported
there. The MediaPipe model files are fetched from Google's CDN the first time an assessment runs and
are cached by the browser afterwards, so the **first** assessment on a new machine needs an internet
connection.

Recordings are never uploaded. Only derived numeric features are sent to the server, and every user
can export or permanently delete all of their data from within the app.
