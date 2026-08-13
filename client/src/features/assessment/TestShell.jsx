import { Spinner } from '../../components/ui.jsx';
import { IconAlert, IconCheck } from '../../components/Icons.jsx';

/** Circular countdown ring shown while a test is capturing. */
export function CaptureRing({ progress, remaining, size = 76 }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-brand-100 dark:stroke-slate-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#5B2BD9"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
        />
      </svg>
      <span className="absolute text-lg font-extrabold text-brand-600 dark:text-brand-300">{remaining}</span>
    </div>
  );
}

/** Live tracking indicator — tells the user whether the model can see them. */
export function TrackingPill({ detecting, label = 'subject' }) {
  return (
    <span
      className={`chip border ${
        detecting
          ? 'border-risk-low/30 bg-risk-low/10 text-risk-low'
          : 'border-risk-mild/30 bg-risk-mild/10 text-risk-mild'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${detecting ? 'bg-risk-low' : 'bg-risk-mild animate-pulse'}`} />
      {detecting ? `Tracking ${label}` : `Looking for ${label}…`}
    </span>
  );
}

/**
 * Common chrome for the four test screens: title, instructions, capture panel,
 * error surface and the skip/continue controls.
 */
export default function TestShell({
  title,
  intro,
  instructions = [],
  children,
  error,
  status,
  loadingLabel = 'Loading AI model and camera',
  onSkip,
  footer,
}) {
  return (
    <div className="card p-6 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[1fr,minmax(300px,420px)]">
        <div>
          <h2 className="text-xl font-extrabold text-ink dark:text-white">{title}</h2>
          {intro && <p className="mt-2 text-sm leading-relaxed muted">{intro}</p>}

          {instructions.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {instructions.map((line, i) => (
                <li key={i} className="flex gap-2.5 text-sm muted">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="mt-5 flex gap-3 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-risk-high" />
              <p className="text-sm font-medium text-risk-high">{error}</p>
            </div>
          )}

          {status === 'loading' && (
            <div className="mt-5 flex items-center gap-2.5 text-sm text-brand-600 dark:text-brand-300">
              <Spinner className="h-4 w-4" />
              {loadingLabel}… (first run downloads the model, this can take a moment)
            </div>
          )}

          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="mt-6 text-xs font-semibold muted underline-offset-2 transition hover:text-ink hover:underline dark:hover:text-slate-200"
            >
              Skip this test
            </button>
          )}
        </div>

        <div className="flex flex-col">{children}</div>
      </div>

      {footer && <div className="mt-8 border-t border-slate-100 pt-6 dark:border-slate-800">{footer}</div>}
    </div>
  );
}
