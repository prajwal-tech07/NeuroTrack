import { Link } from 'react-router-dom';
import { riskStyle, scoreColor, scoreTone } from '../utils/format.js';
import { IconAlert } from './Icons.jsx';

export function Logo({ className = '', showText = true }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-brand-600/20" />
        <span className="h-3.5 w-3.5 rounded-full bg-brand-600 ring-4 ring-brand-600/25" />
      </span>
      {showText && (
        <span className="text-lg font-extrabold tracking-tight text-brand-600 dark:text-brand-300">
          NeuroTrackAI
        </span>
      )}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.2" className="opacity-20" />
      <path
        d="M22 12a10 10 0 00-10-10"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-brand-600">
      <Spinner className="h-8 w-8" />
      <p className="text-sm font-medium muted">{label}…</p>
    </div>
  );
}

export function RiskBadge({ level, label, size = 'md' }) {
  const style = riskStyle(level);
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs';
  return (
    <span className={`chip border ${pad} ${style.bg} ${style.border} ${style.text}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label || style.label}
    </span>
  );
}

export function StatCard({ label, value, caption, tone = 'ink', icon: Icon, className = '' }) {
  const toneClass =
    {
      ink: 'text-ink dark:text-slate-100',
      brand: 'text-brand-600 dark:text-brand-300',
      low: 'text-risk-low',
      mild: 'text-risk-mild',
      moderate: 'text-risk-moderate',
      high: 'text-risk-high',
      blue: 'text-blue-600',
    }[tone] || 'text-ink dark:text-slate-100';

  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-300 dark:text-slate-600" />}
      </div>
      <p className={`mt-2 text-3xl font-extrabold leading-tight ${toneClass}`}>{value}</p>
      {caption && <p className="mt-1 text-xs muted">{caption}</p>}
    </div>
  );
}

/** Circular score gauge, matching the Result page mockup. */
export function ScoreRing({ score, size = 200, stroke = 16, label, sublabel }) {
  const safe = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - safe / 100);
  const color = scoreColor(score);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-extrabold" style={{ color }}>
          {typeof score === 'number' ? `${score}%` : '—'}
        </span>
        {label && (
          <span className="mt-1 text-sm font-bold" style={{ color }}>
            {label}
          </span>
        )}
        {sublabel && <span className="mt-0.5 text-[11px] muted">{sublabel}</span>}
      </div>
    </div>
  );
}

/** Labelled horizontal score bar used on the dashboard and result pages. */
export function ScoreBar({ label, score, color, showValue = true }) {
  const tone = scoreTone(score);
  const barColor = color || riskStyle(tone).hex;

  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
        {showValue && (
          <span className="text-sm font-bold" style={{ color: score === null ? '#94A3B8' : barColor }}>
            {score === null || score === undefined ? 'n/a' : `${score}%`}
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score ?? 0}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
        {Icon ? <Icon className="h-7 w-7" /> : <IconAlert className="h-7 w-7" />}
      </div>
      <h3 className="text-lg font-bold text-ink dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-slate-50 sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs font-medium text-risk-high">{children}</p>;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export function DisclaimerNote({ className = '' }) {
  return (
    <p className={`text-xs leading-relaxed muted ${className}`}>
      <strong className="font-semibold">Important:</strong> NeuroTrackAI is a screening and
      wellness-tracking aid, not a diagnostic device. It cannot diagnose Parkinson's disease or any
      other condition. Always discuss health concerns with a qualified clinician.
    </p>
  );
}

export function LinkButton({ to, children, variant = 'primary', className = '', ...rest }) {
  const cls = { primary: 'btn-primary', outline: 'btn-outline', ghost: 'btn-ghost' }[variant];
  return (
    <Link to={to} className={`${cls} ${className}`} {...rest}>
      {children}
    </Link>
  );
}
