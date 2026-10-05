import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHeader, Spinner, Toggle } from '../components/ui.jsx';
import { LANGUAGES, formatDate, formatTime } from '../utils/format.js';

const DATE_FORMATS = [
  { value: 'dd/mm/yyyy', label: 'dd/mm/yyyy' },
  { value: 'mm/dd/yyyy', label: 'mm/dd/yyyy' },
  { value: 'yyyy-mm-dd', label: 'yyyy-mm-dd' },
];

const TIME_FORMATS = [
  { value: '12h', label: '12 Hour' },
  { value: '24h', label: '24 Hour' },
];

function Row({ label, description, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0 dark:border-slate-800">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink dark:text-slate-100">{label}</p>
        {description && <p className="mt-0.5 text-xs muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card mb-5 p-6 sm:p-7">
      <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide text-brand-600 dark:text-brand-300">
        {title}
      </h2>
      <div>{children}</div>
    </div>
  );
}

const DIAGNOSES = [
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  { value: 'none', label: 'No neurological diagnosis' },
  { value: 'parkinsons', label: "Diagnosed with Parkinson's" },
  { value: 'stroke', label: 'Had a stroke / facial palsy' },
  { value: 'other', label: 'Another neurological condition' },
];

/**
 * Opt-in donation of measured features (never video or audio) so the models'
 * real-world accuracy can be measured. Opting out deletes donated samples.
 */
function ResearchSection({ user, patchUser, toast }) {
  const [research, setResearch] = useState(user?.research || { consented: false, diagnosis: 'prefer_not_to_say' });
  const [samples, setSamples] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/users/research')
      .then((res) => {
        setResearch(res.data.research);
        setSamples(res.data.samples);
      })
      .catch(() => {});
  }, []);

  const save = async (patch) => {
    if (patch.consented === false && research.consented) {
      const ok = window.confirm('Stop contributing and permanently delete the samples you have donated?');
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.patch('/users/research', { consented: research.consented, ...patch });
      setResearch(res.data.research);
      setSamples(res.data.samples);
      patchUser({ research: res.data.research });
      toast.success(res.message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Help improve accuracy">
      <p className="mt-2 text-xs leading-relaxed muted">
        Our face and hand checks have not yet been validated on real patients, and the voice model has not been
        tested on home microphones. If you agree, each assessment you complete also stores a{' '}
        <strong>pseudonymous copy of the measured numbers</strong> (for example blink rate or tapping speed), your age
        range, gender and the diagnosis you choose below. It contains <strong>no video, no audio, no name and no email</strong>.
        It is used only to measure and improve the accuracy of these checks. You can stop at any time, and stopping
        deletes everything you donated.
      </p>
      <Row
        label="Contribute my measurements"
        description={
          research.consented
            ? `Contributing${samples != null ? ` · ${samples} sample${samples === 1 ? '' : 's'} donated` : ''}`
            : 'Off. Nothing is shared.'
        }
      >
        <Toggle
          checked={Boolean(research.consented)}
          onChange={(v) => save({ consented: v })}
          label="Contribute measurements for research"
        />
      </Row>
      <Row
        label="Diagnosis (self-reported)"
        description="Used as the label the checks are evaluated against. Only stored with your donated samples."
      >
        <select
          className="input !w-auto !py-2 text-sm"
          value={research.diagnosis || 'prefer_not_to_say'}
          disabled={busy}
          onChange={(e) => save({ diagnosis: e.target.value })}
        >
          {DIAGNOSES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  );
}

export default function Settings() {
  const { user, patchUser, logout } = useAuth();
  const { setTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [settings, setSettings] = useState(user?.settings || {});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (user?.settings) setSettings(user.settings);
  }, [user]);

  /** Optimistically applies a change, then persists it. */
  const update = async (patch) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    if ('darkMode' in patch) setTheme(patch.darkMode ? 'dark' : 'light');

    setSaving(true);
    try {
      const res = await api.patch('/users/settings', patch);
      patchUser({ settings: res.data.settings });
    } catch (err) {
      setSettings(previous);
      if ('darkMode' in patch) setTheme(previous.darkMode ? 'dark' : 'light');
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete('/users/account');
      toast.success('Your account and all data have been deleted');
      await logout();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  };

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Manage your preferences and account settings."
        actions={
          saving ? (
            <span className="inline-flex items-center gap-2 text-xs muted">
              <Spinner className="h-3.5 w-3.5" /> Saving…
            </span>
          ) : null
        }
      />

      <Section title="General">
        <Row label="Dark Mode" description="Switches the whole app to a dark palette.">
          <Toggle
            checked={Boolean(settings.darkMode)}
            onChange={(v) => update({ darkMode: v })}
            label="Dark mode"
          />
        </Row>
      </Section>

      <Section title="Notifications">
        <Row
          label="Email Notifications"
          description="Monthly report summaries and account emails."
        >
          <Toggle
            checked={Boolean(settings.emailNotifications)}
            onChange={(v) => update({ emailNotifications: v })}
            label="Email notifications"
          />
        </Row>
        <Row
          label="Weekly Reminder"
          description="A nudge when your next assessment becomes due."
        >
          <Toggle
            checked={Boolean(settings.weeklyReminder)}
            onChange={(v) => update({ weeklyReminder: v })}
            disabled={!settings.emailNotifications}
            label="Weekly reminder"
          />
        </Row>
        {!settings.emailNotifications && (
          <p className="pt-3 text-xs text-risk-mild">
            Weekly reminders need email notifications switched on.
          </p>
        )}
      </Section>

      <Section title="Preferences">
        <Row label="Language" description="Interface language.">
          <select
            className="input !w-auto !py-2 text-sm"
            value={settings.language || 'en'}
            onChange={(e) => update({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Date Format" description={`Preview: ${formatDate(now, settings.dateFormat)}`}>
          <select
            className="input !w-auto !py-2 text-sm"
            value={settings.dateFormat || 'dd/mm/yyyy'}
            onChange={(e) => update({ dateFormat: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Time Format" description={`Preview: ${formatTime(now, settings.timeFormat)}`}>
          <select
            className="input !w-auto !py-2 text-sm"
            value={settings.timeFormat || '12h'}
            onChange={(e) => update({ timeFormat: e.target.value })}
          >
            {TIME_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <ResearchSection user={user} patchUser={patchUser} toast={toast} />

      <Section title="Account">
        <Row label="Sign out" description="End this session on this device.">
          <button onClick={handleLogout} className="btn-ghost border border-slate-200 !py-2 text-risk-high dark:border-slate-700">
            Logout
          </button>
        </Row>
        <Row
          label="Delete account"
          description="Permanently removes your profile, every assessment and every report."
        >
          <button onClick={() => setShowDelete(true)} className="btn-ghost !py-2 text-risk-high">
            Delete account
          </button>
        </Row>
      </Section>

      {showDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={() => setShowDelete(false)} />
          <div className="relative w-full max-w-md animate-fade-up rounded-2xl bg-white p-7 shadow-card dark:bg-surface-cardDark">
            <h3 className="text-lg font-extrabold text-risk-high">Delete your account?</h3>
            <p className="mt-2 text-sm muted">
              This permanently deletes your profile and every assessment and report. It cannot be
              undone. Consider exporting your data from the Profile page first.
            </p>
            <label className="label mt-5" htmlFor="confirm-delete">
              Type <span className="font-mono text-risk-high">DELETE</span> to confirm
            </label>
            <input
              id="confirm-delete"
              className="input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowDelete(false)} className="btn-ghost">
                Cancel
              </button>
              <button
                onClick={deleteAccount}
                disabled={confirmText !== 'DELETE' || deleting}
                className="btn-danger"
              >
                {deleting ? <Spinner className="h-4 w-4" /> : null}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
