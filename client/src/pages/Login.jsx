import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { FieldError, Spinner } from '../components/ui.jsx';
import api from '../api/client.js';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((err) => ({ ...err, [key]: undefined, _: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    try {
      const user = await login({ ...form, remember });
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`);
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      setErrors({ ...(err.details || {}), _: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = async () => {
    setForm({ email: 'demo@neurotrackai.com', password: 'Demo1234' });
    setErrors({});
  };

  const forgot = async () => {
    if (!form.email) {
      setErrors({ email: 'Enter your email first, then click again' });
      return;
    }
    try {
      const res = await api.post('/auth/forgot-password', { email: form.email });
      toast.info(res.note ? `${res.message} (${res.note})` : res.message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <AuthShell
      title="Welcome Back!"
      subtitle="Sign in to continue to your NeuroTrackAI dashboard."
      footer={
        <p className="text-sm muted">
          Don't have an account?{' '}
          <Link to="/register" className="font-bold text-brand-600 dark:text-brand-300">
            Register
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="card p-7 sm:p-8" noValidate>
        <h2 className="mb-6 text-center text-xl font-extrabold text-brand-600 dark:text-brand-300">
          Sign in
        </h2>

        {errors._ && (
          <div className="mb-5 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
            {errors._}
          </div>
        )}

        <div className="mb-4">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="Enter your email"
            value={form.email}
            onChange={set('email')}
            required
          />
          <FieldError>{errors.email}</FieldError>
        </div>

        <div className="mb-4">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={`input ${errors.password ? 'input-error' : ''}`}
            placeholder="Enter your password"
            value={form.password}
            onChange={set('password')}
            required
          />
          <FieldError>{errors.password}</FieldError>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Remember me
          </label>
          <button type="button" onClick={forgot} className="text-sm font-bold text-brand-600 dark:text-brand-300">
            Forgot Password?
          </button>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full !py-3">
          {submitting ? (
            <>
              <Spinner className="h-4 w-4" /> Signing in…
            </>
          ) : (
            'Login'
          )}
        </button>

        <button
          type="button"
          onClick={fillDemo}
          className="mt-3 w-full text-center text-xs font-semibold muted transition hover:text-brand-600"
        >
          Use the demo account
        </button>
      </form>
    </AuthShell>
  );
}
