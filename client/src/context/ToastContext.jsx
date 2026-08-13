import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

const TONE = {
  success: 'border-risk-low/30 bg-risk-low/10 text-risk-low',
  error: 'border-risk-high/30 bg-risk-high/10 text-risk-high',
  info: 'border-brand-500/30 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200',
  warning: 'border-risk-mild/30 bg-risk-mild/10 text-risk-mild',
};

const ICON = {
  success: 'M20 6L9 17l-5-5',
  error: 'M18 6L6 18M6 6l12 12',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 11-20 0 10 10 0 0120 0z',
  warning: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (message, type = 'info', duration = 4200) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, message, type }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (m, d) => push(m, 'success', d),
      error: (m, d) => push(m, 'error', d ?? 6000),
      info: (m, d) => push(m, 'info', d),
      warning: (m, d) => push(m, 'warning', d),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-card backdrop-blur ${TONE[t.type]}`}
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={ICON[t.type]} />
            </svg>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="opacity-60 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};
