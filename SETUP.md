# Setup — what you need to do

Everything in this repo is already written and wired together. This file lists the only things that
need a human.

---

## 1. Required (about 2 minutes)

Your machine already has Node 24, npm 11 and MongoDB 7 running as a Windows service, so this is all
that is left:

```bash
cd C:\Users\prajw\OneDrive\Desktop\NeuroTrackAi

npm run install:all         # already done once — re-run only after a fresh clone
copy server\.env.example server\.env
npm run seed                # loads the demo account with 6 months of history
npm run dev
```

Open <http://localhost:5173> and sign in:

```
email:    demo@neurotrackai.com
password: Demo1234
```

Or register your own account — a fresh account starts with an empty dashboard and prompts you to
take your first assessment.

**If MongoDB is not running**, start it as administrator:

```powershell
net start MongoDB
```

---

## 2. Required to actually run an assessment

Browser permissions. The first time you start each test, Chrome/Edge will ask for:

- **Microphone** — voice test
- **Camera** — face, hand and gait tests

Click *Allow*. If you accidentally block them, click the icon at the left of the address bar and
re-enable.

The first assessment also downloads three MediaPipe model files (~15 MB total) from Google's CDN, so
**keep an internet connection for the first run**. They are cached afterwards.

Practical tips for a usable recording:

- **Voice** — quiet room, mic about 15 cm away, no fan or music.
- **Face** — face a window or lamp; even lighting matters more than brightness.
- **Hand** — hand about 40 cm from the camera, whole hand in frame.
- **Gait** — put the laptop on a table and step back 2–3 m so your head, hips and both feet are all
  visible. Have clear space around you.

---

## 3. Optional — email

Everything works without this. Leave `SMTP_HOST` empty and the app logs skipped mail instead of
sending it.

To turn on weekly reminders, monthly report emails and password reset, fill in `server/.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.address@gmail.com
SMTP_PASS=your_16_char_app_password
MAIL_FROM="NeuroTrackAI <your.address@gmail.com>"
```

For Gmail you need an **App Password**, not your normal password: Google Account → Security →
2-Step Verification → App passwords.

---

## 4. Optional — before you deploy or push publicly

1. **Replace the JWT secrets** in `server/.env`. Generate each with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

2. **`server/.env` is gitignored** — keep it that way. Only `.env.example` should be committed.

3. **Note on git**: your home directory `C:\Users\prajw` is itself a git repository, so this project
   currently sits inside it. To give NeuroTrackAI its own history:

   ```bash
   cd C:\Users\prajw\OneDrive\Desktop\NeuroTrackAi
   git init
   git add .
   git commit -m "NeuroTrackAI: multimodal neurological screening"
   ```

   The included `.gitignore` already excludes `node_modules`, `dist` and `.env`.

4. **Production build**:

   ```bash
   npm run build      # outputs client/dist
   npm start          # runs the API; serve client/dist from nginx/Vercel/Netlify
   ```

   Set `NODE_ENV=production` and point `CLIENT_URL` at your deployed frontend origin so CORS and the
   secure cookie flag behave correctly.

---

## 5. Things you might reasonably want to change

| What | Where |
|---|---|
| Assessment interval (default 7 days) | `ASSESSMENT_INTERVAL_DAYS` in `server/.env` |
| Reminder schedule (default Mon 09:00) | `REMINDER_CRON` in `server/.env` |
| Turn cron jobs off | `ENABLE_CRON=false` |
| Risk band thresholds (80 / 65 / 50) | `RISK_BANDS` in `server/src/services/scoring/fusion.js` |
| How modules are weighted in fusion | `BASE_WEIGHTS`, same file |
| Reference ranges for any measurement | the `score*` calls in `server/src/services/scoring/{voice,face,hand,gait}.js` |
| Recommendation wording and rules | `server/src/services/recommendations.js` |
| Test durations | the `*_SEC` constants at the top of each file in `client/src/features/assessment/` |
| Brand colours | `client/tailwind.config.js` |

---

## Troubleshooting

**`[db] connection failed`** — MongoDB is not running. `net start MongoDB` as administrator, or point
`MONGODB_URI` at an Atlas cluster.

**Port 5000 or 5173 already in use** — change `PORT` in `server/.env` (and the proxy target in
`client/vite.config.js`), or `server.port` in `client/vite.config.js`.

**"Could not start the camera or load the AI model"** — permissions were blocked, another app is
using the camera, or the CDN was unreachable on first run. Check the address-bar permission icon and
your connection.

**Tests capture but score low with a "low data" warning** — the subject was hard to track. Improve
lighting, move so your whole face/hand/body is in frame, and re-record.

**Login says "Too many attempts"** — the auth rate limiter allows 30 attempts per 15 minutes per IP.
Wait, or restart the server to reset it.
