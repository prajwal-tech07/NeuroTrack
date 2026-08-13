import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { FieldError, Spinner } from '../components/ui.jsx';

const GENDERS = [
  { value: '', label: 'Select gender' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/** Simple strength meter — length plus character-class variety. */
function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const levels = [
    { label: 'Very weak', color: 'bg-risk-high' },
    { label: 'Weak', color: 'bg-risk-high' },
    { label: 'Fair', color: 'bg-risk-mild' },
    { label: 'Good', color: 'bg-risk-mild' },
    { label: 'Strong', color: 'bg-risk-low' },
    { label: 'Very strong', color: 'bg-risk-low' },
  ];
  return { score, ...levels[score] };
}

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    age: '',
    gender: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((err) => ({ ...err, [key]: undefined, _: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const payload = {
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      confirmPassword: form.confirmPassword,
      ...(form.age ? { age: Number(form.age) } : {}),
      ...(form.gender ? { gender: form.gender } : {}),
    };

    try {
      const user = await register(payload);
      toast.success(`Account created — welcome, ${user.fullName.split(' ')[0]}`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setErrors({ ...(err.details || {}), _: err.details ? undefined : err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create Your Account"
      subtitle="Register to start tracking your neurological health."
      footer={
        <p className="text-sm muted">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-brand-600 dark:text-brand-300">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="card p-7 sm:p-8" noValidate>
        <h2 className="mb-6 text-center text-xl font-extrabold text-brand-600 dark:text-brand-300">
          Join NeuroTrackAI
        </h2>

        {errors._ && (
          <div className="mb-5 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
            {errors._}
          </div>
        )}

        <div className="mb-4">
          <label className="label" htmlFor="fullName">
            Full Name
          </label>
          <input
            id="fullName"
            className={`input ${errors.fullName ? 'input-error' : ''}`}
            placeholder="Enter your full name"
            autoComplete="name"
            value={form.fullName}
            onChange={set('fullName')}
            required
          />
          <FieldError>{errors.fullName}</FieldError>
        </div>

        <div className="mb-4">
          <label className="label" htmlFor="reg-email">
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="Enter your email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
          <FieldError>{errors.email}</FieldError>
        </div>

        <div className="mb-4">
          <label className="label" htmlFor="reg-password">
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            className={`input ${errors.password ? 'input-error' : ''}`}
            placeholder="Create a strong password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
          />
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${strength.color}`}
                  style={{ width: `${(strength.score / 5) * 100}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold muted">{strength.label}</span>
            </div>
          )}
          <FieldError>{errors.password}</FieldError>
        </div>

        <div className="mb-5">
          <label className="label" htmlFor="confirmPassword">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            className={`input ${errors.confirmPassword ? 'input-error' : ''}`}
            placeholder="Confirm your password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            required
          />
          <FieldError>{errors.confirmPassword}</FieldError>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="age">
              Age
            </label>
            <input
              id="age"
              type="number"
              min="1"
              max="120"
              className={`input ${errors.age ? 'input-error' : ''}`}
              placeholder="Enter your age"
              value={form.age}
              onChange={set('age')}
            />
            <FieldError>{errors.age}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="gender">
              Gender
            </label>
            <select id="gender" className="input" value={form.gender} onChange={set('gender')}>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <FieldError>{errors.gender}</FieldError>
          </div>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full !py-3">
          {submitting ? (
            <>
              <Spinner className="h-4 w-4" /> Creating account…
            </>
          ) : (
            'Create Account'
          )}
        </button>

        <p className="mt-4 text-center text-[11px] leading-relaxed muted">
          Age and gender are used only to normalise your scores against typical ranges. Your
          recordings are analysed in your browser and never uploaded.
        </p>
      </form>
    </AuthShell>
  );
}
