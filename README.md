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
| **Face** | 24 s webcam, MediaPipe FaceLandmarker (478 landmarks + 52 blendshapes). Four cues: rest, smile, brow raise, eyes shut | Blink rate, expressivity index, smile/brow amplitude, left–right asymmetry, jaw range, **per-side** expressivity/smile/brow, **eye-closure residual per side** |
| **Hand** | 38 s, MediaPipe HandLandmarker. Tap + hold on the **left** hand, then the **right** | Per hand: tap frequency, amplitude, amplitude decrement, inter-tap CV, hesitations, dominant tremor frequency (FFT), 3.5–6.5 Hz band power ratio, postural drift and downward drift |
| **Gait** | 22 s marching in place, MediaPipe PoseLandmarker | Cadence, step-time CV, step symmetry, arm swing amplitude and asymmetry, trunk sway, forward lean, double-support proxy, **per-leg step interval and per-arm swing** |

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
4. **Laterality and pattern** are computed separately from severity: `laterality.js`
   compares each paired left/right measurement, and `pattern.js` classifies the result as
   typical, Parkinsonian, one-sided weakness or mixed. See
   [Movement pattern detection](#movement-pattern-detection).
5. **Recommendations** are generated from the pattern, flags and score deltas
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
    ├── scripts/
    │   ├── seed.js       demo account with 6 months of history
    │   └── validate.js   pattern-classifier regression harness
    └── src/
        ├── controllers/  auth, user, assessment, dashboard, report
        ├── jobs/         weekly reminder + monthly report cron
        ├── middleware/   auth guard, validation, error handling
        ├── models/       User, Assessment, Report
        ├── routes/
        ├── services/
        │   ├── scoring/  voice, face, hand, gait, laterality, pattern, fusion
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
| POST | `/assessments/voice-audio` | Score the sustained-vowel WAV with the voice model (multipart `audio`) |
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

## Movement pattern detection

Beyond "how impaired" (the 0-100 score), the engine reports **what kind** of
impairment the measurements resemble. This is how a clinician reasons: localise
the pattern first, diagnose second.

| Pattern | What it means | Signature |
|---|---|---|
| **Typical** | Everything in reference range | Symmetric, all measures normal |
| **Parkinsonian** | Bilateral hypokinesia | Both sides slowed together, amplitude decrement, 4-6 Hz rest tremor, reduced expression on both sides |
| **One-sided weakness** (hemiparetic) | Unilateral weakness | One side consistently weaker across modalities, incomplete eye closure, arm drift, **no** rest tremor |
| **Mixed** | Impaired but unclear | Outside normal ranges without a consistent picture |

The discriminating measurement is the **laterality index**: a normalised
left/right difference computed per modality and aggregated. Parkinsonian
slowing is broadly symmetric (low index); hemiparesis is not (high index, with
the same side weak across modalities).

This is why the hand test captures **both hands** and the face test includes an
eyes-shut cue — laterality is unmeasurable from one side, and incomplete eye
closure (lagophthalmos) is highly specific to facial weakness and does not occur
in Parkinsonian hypomimia.

Patterns are reported at two tiers. Above the confidence threshold the pattern
is stated plainly; below it, the result is flagged as a *possible early* pattern
with low confidence and framed as "re-test next week" rather than a finding.
Forcing weak signals to "typical" would be a false negative on exactly the early
cases screening exists to catch.

### Safety behaviour

A confident one-sided-weakness result triggers an **interrupting emergency
notice**, not a dashboard number, in both the UI and the PDF: sudden unilateral
weakness or facial droop can indicate a stroke, where treatment is time-critical.
The weekly-tracking framing is deliberately broken for this one case.

### Validation

```bash
npm run validate                    # full severity range
npm --prefix server run validate -- --hard      # mild/early cases only
npm --prefix server run validate -- --n 500 --seed 7 --verbose
```

Measured on **synthetic labelled profiles** (300 per class):

| Test set | Accuracy | Notes |
|---|---|---|
| Full severity range | **99.9%** | All classes >= 99.7% recall |
| Mild / early only (`--hard`) | **94.1%** | 93.2-94.8% across seeds; the number worth trusting |
| Affected-side identification | **100%** | Which side, given a one-sided result |

> **This is a regression test, not clinical validation.** The cases are
> simulated and we assigned the labels ourselves, so the number says "the
> classifier separates the patterns it was designed to separate, and this change
> did not break it". It does **not** say how often it is right about a real
> patient — that needs real labelled patients, which this project does not have.
> Quote it as *accuracy on synthetic profiles*, never as diagnostic accuracy.


## Voice model (trained on real recordings)

The 8-second sustained "Aaah" from the voice test is scored by a model trained on **real patients**,
not on simulated data. It runs in the Python service (`ml-service/`) and contributes 35% of the voice
module score; the other 65% stays with the clinical heuristics.

- **Training data:** Sakar et al. 2018 (UCI #470), 756 recordings from 252 people (188 Parkinson's,
  64 healthy).
- **Features:** Praat voice-report measures (shimmer, harmonicity, pitch period) plus formants,
  normalised by sex. They are extracted with the same Praat engine at training and at inference.
  Jitter is measured and shown to the user but left out of the model: its value changes 5-14x between
  microphones.
- **Model:** gradient-boosted trees (XGBoost), chosen over logistic regression and a blend of both.

Measured with **subject-grouped cross-validation**: every person's recordings sit entirely in train or
entirely in test (5 folds x 10 repeats).

| Metric | Value |
|---|---|
| AUC | **0.82** (95% CI 0.77-0.89) |
| Balanced accuracy | **0.74** (95% CI 0.69-0.81) |
| Sensitivity / specificity | 0.74 / 0.73 |

> These are honest but **in-domain** numbers: the training audio was recorded on studio equipment.
> On a second public dataset (8 kHz telephone-quality audio) the model did no better than chance, and
> neither did any single feature, so that recording quality carries no usable signal. Browser
> microphones are untested. Two safeguards follow from that. The model's output is ignored whenever a
> recording does not resemble the training data (an out-of-distribution gate). And its weight in the
> voice score is kept moderate. Real browser-recorded data from healthy volunteers and patients is the
> next step for reliable accuracy.
>
> Older figures such as "92%" or "95%" came from random row splits (the same person in train and
> test) or from synthetic data. Do not quote them.

Reproduce (from `ml-service/`):

```bash
pip install -r requirements.txt
python scripts/download_voice_data.py   # public datasets -> data/raw/ (gitignored)
python scripts/train_voice_model.py     # trains, evaluates, writes app/models/voice_pd_model*.{joblib,json}
python -m pytest tests -q               # set PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 if a global plugin breaks pytest
```

The other ML-service classifiers (Parkinson's, paralysis) are transparent rule engines. Their
"confidence" is the share of relevant tests completed, weighted by recording quality. It is not an
accuracy. The face-photo model is trained on synthetic data and is labelled as such.

## Gait rules measured on real walking data

`ml-service/scripts/evaluate_gait_rules.py` checks the app's gait rules (`gait.js`, unchanged) against
PhysioNet's *Gait in Parkinson's Disease* database: 165 people (93 with Parkinson's, 72 controls),
with timing taken from foot-pressure sensors. Every evaluation keeps each person entirely in train or
entirely in test:

| | AUC | Balanced accuracy |
|---|---|---|
| Current gait rules | 0.74 | 0.60. At the app's "score below 80" cutoff they flag 30% of patients and 10% of controls |
| Logistic regression on the same 4 timing features | 0.84 | 0.77 |

The rules point the right way but are too lenient. Double-support time is the strongest single signal
(AUC 0.79). These are upper bounds, because the app would estimate gait timing from a webcam, not
force plates. The gait test is currently not part of the assessment flow.

## Research data (opt-in)

The face and hand checks have no real-patient validation yet, and the voice model has not been
tested on home microphones. Real accuracy figures can only come from real users, so
**Settings → Help improve accuracy** lets a user opt in to donating their measurements.

- **What is stored:** the numeric features of each assessment, a 5-year age band, gender and a
  self-reported diagnosis. No video, audio, name, email or user id is stored. Samples are linked by an
  HMAC pseudonym (`RESEARCH_SECRET`), so one person's samples can be grouped and deleted.
- **Opting out, or deleting the account,** permanently deletes every donated sample.
- **Evaluate:**

  ```bash
  npm --prefix server run research:export              # -> ml-service/data/research/samples.jsonl
  python ml-service/scripts/evaluate_research_data.py  # subject-grouped CV per test
  ```

  The evaluator reports nothing until each class has at least 20 participants. Labels are
  self-reported, so confirm against clinician diagnoses before quoting any result.

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
| `npm run dev:ml` | Run the Python ML service (voice model) on :8000 |
| `npm --prefix server test` | Server unit tests (voice-model blending, WAV encoder) |
| `npm start` | Run the API alone (serve `client/dist` behind your own web server) |

---

## Browser support and privacy

Chrome or Edge is recommended — camera capture and the MediaPipe WASM runtime are best supported
there. The MediaPipe model files are fetched from Google's CDN the first time an assessment runs and
are cached by the browser afterwards, so the **first** assessment on a new machine needs an internet
connection.

Video is never uploaded, and neither is most of the audio. The one exception is the 8-second sustained
"Aaah" from the voice test: it is sent as a WAV file to the voice model, processed in memory, and
discarded without being stored. Everything else is analysed on the device, and only derived numeric
features reach the server. Every user can export or permanently delete all of their data from within
the app.
