import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { FieldError, PageHeader, Spinner } from '../components/ui.jsx';
import { initialsOf } from '../utils/format.js';

const GENDERS = [
  { value: '', label: 'Not specified' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

export default function Profile() {
  const { user, patchUser } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    age: '',
    gender: '',
    dateOfBirth: '',
    phone: '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      fullName: user.fullName || '',
      email: user.email || '',
      age: user.age ?? '',
      gender: user.gender || '',
      dateOfBirth: toDateInput(user.dateOfBirth),
      phone: user.phone || '',
    });
  }, [user]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((err) => ({ ...err, [key]: undefined, _: undefined }));
  };

  const setPwField = (key) => (e) => {
    setPw((p) => ({ ...p, [key]: e.target.value }));
    setPwErrors((err) => ({ ...err, [key]: undefined, _: undefined }));
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});

    const payload = {
      fullName: form.fullName,
      email: form.email,
      age: form.age === '' ? null : Number(form.age),
      gender: form.gender || null,
      dateOfBirth: form.dateOfBirth || null,
      phone: form.phone || null,
    };

    try {
      const res = await api.patch('/users/profile', payload);
      patchUser(res.data.user);
      toast.success('Profile updated');
    } catch (err) {
      setErrors({ ...(err.details || {}), _: err.details ? undefined : err.message });
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setChangingPw(true);
    setPwErrors({});
    try {
      const res = await api.post('/users/change-password', pw);
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success(res.message);
    } catch (err) {
      setPwErrors({ ...(err.details || {}), _: err.details ? undefined : err.message });
    } finally {
      setChangingPw(false);
    }
  };

  const exportData = async () => {
    try {
      await api.download('/users/export', 'neurotrackai-export.json');
      toast.success('Your data has been exported');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader title="My Profile" subtitle="Manage your personal information." />

      <form onSubmit={saveProfile} className="card p-6 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[auto,1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-100 text-3xl font-extrabold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
              {initialsOf(form.fullName || user?.fullName)}
            </div>
            <p className="text-center text-xs muted">
              Member since
              <br />
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
            </p>
          </div>

          <div>
            {errors._ && (
              <div className="mb-5 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
                {errors._}
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="p-name">Full Name</label>
                <input
                  id="p-name"
                  className={`input ${errors.fullName ? 'input-error' : ''}`}
                  value={form.fullName}
                  onChange={set('fullName')}
                />
                <FieldError>{errors.fullName}</FieldError>
              </div>

              <div>
                <label className="label" htmlFor="p-email">Email</label>
                <input
                  id="p-email"
                  type="email"
                  className={`input ${errors.email ? 'input-error' : ''}`}
                  value={form.email}
                  onChange={set('email')}
                />
                <FieldError>{errors.email}</FieldError>
              </div>

              <div>
                <label className="label" htmlFor="p-age">Age</label>
                <input
                  id="p-age"
                  type="number"
                  min="1"
                  max="120"
                  className={`input ${errors.age ? 'input-error' : ''}`}
                  value={form.age}
                  onChange={set('age')}
                />
                <FieldError>{errors.age}</FieldError>
                <p className="mt-1 text-[11px] muted">Used to age-normalise your scores.</p>
              </div>

              <div>
                <label className="label" htmlFor="p-gender">Gender</label>
                <select id="p-gender" className="input" value={form.gender} onChange={set('gender')}>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="p-dob">Date of Birth</label>
                <input
                  id="p-dob"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  className="input"
                  value={form.dateOfBirth}
                  onChange={set('dateOfBirth')}
                />
                <p className="mt-1 text-[11px] muted">Setting this recalculates your age.</p>
              </div>

              <div>
                <label className="label" htmlFor="p-phone">Phone Number</label>
                <input
                  id="p-phone"
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  className={`input ${errors.phone ? 'input-error' : ''}`}
                  value={form.phone}
                  onChange={set('phone')}
                />
                <FieldError>{errors.phone}</FieldError>
              </div>
            </div>

            <button type="submit" disabled={saving} className="btn-primary mt-7 w-full !py-3">
              {saving ? (<><Spinner className="h-4 w-4" /> Saving…</>) : 'Update Profile'}
            </button>
          </div>
        </div>
      </form>

      {/* Password */}
      <form onSubmit={changePassword} className="card mt-5 p-6 sm:p-8">
        <h2 className="section-title">Password</h2>
        <p className="mt-1 text-sm muted">
          Changing your password signs you out of every other device.
        </p>

        {pwErrors._ && (
          <div className="mt-5 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
            {pwErrors._}
          </div>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              className={`input ${pwErrors.currentPassword ? 'input-error' : ''}`}
              value={pw.currentPassword}
              onChange={setPwField('currentPassword')}
            />
            <FieldError>{pwErrors.currentPassword}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="pw-new">New password</label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              className={`input ${pwErrors.newPassword ? 'input-error' : ''}`}
              value={pw.newPassword}
              onChange={setPwField('newPassword')}
            />
            <FieldError>{pwErrors.newPassword}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="pw-confirm">Confirm new password</label>
            <input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              className={`input ${pwErrors.confirmPassword ? 'input-error' : ''}`}
              value={pw.confirmPassword}
              onChange={setPwField('confirmPassword')}
            />
            <FieldError>{pwErrors.confirmPassword}</FieldError>
          </div>
        </div>

        <button
          type="submit"
          disabled={changingPw || !pw.currentPassword || !pw.newPassword}
          className="btn-outline mt-6"
        >
          {changingPw ? (<><Spinner className="h-4 w-4" /> Updating…</>) : 'Change password'}
        </button>
      </form>

      {/* Data */}
      <div className="card mt-5 p-6 sm:p-8">
        <h2 className="section-title">Your data</h2>
        <p className="mt-1 text-sm muted">
          Download everything NeuroTrackAI stores about you — profile, every assessment with its raw
          feature vectors, and every report — as a single JSON file.
        </p>
        <button onClick={exportData} className="btn-ghost mt-5 border border-slate-200 dark:border-slate-700">
          Export my data
        </button>
      </div>
    </>
  );
}
