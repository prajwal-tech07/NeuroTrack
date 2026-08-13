import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { releaseLandmarkers } from '../lib/mediapipe.js';
import VoiceTest from '../features/assessment/VoiceTest.jsx';
import FaceTest from '../features/assessment/FaceTest.jsx';
import HandTest from '../features/assessment/HandTest.jsx';
import GaitTest from '../features/assessment/GaitTest.jsx';
import { DisclaimerNote, Spinner } from '../components/ui.jsx';
import { IconAlert, IconCheck, IconSparkle } from '../components/Icons.jsx';
import { MODULE_META } from '../utils/format.js';

const STEPS = [
  { key: 'voice', label: 'Voice Test', Component: VoiceTest },
  { key: 'face', label: 'Face Test', Component: FaceTest },
  { key: 'hand', label: 'Hand Test', Component: HandTest },
  { key: 'gait', label: 'Gait Test', Component: GaitTest },
  { key: 'result', label: 'Result', Component: null },
];

function Stepper({ current, results }) {
  return (
    <ol className="mb-8 flex items-start justify-between gap-1">
      {STEPS.map((step, i) => {
        const done = i < current || (step.key !== 'result' && results[step.key]);
        const active = i === current;
        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : done || active ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-800'}`} />
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition ${
                  active
                    ? 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900/50'
                    : done
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'
                }`}
              >
                {done && !active ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? 'bg-transparent' : done ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-800'}`} />
            </div>
            <span
              className={`mt-2 truncate text-center text-[11px] font-semibold sm:text-xs ${
                active ? 'text-brand-600 dark:text-brand-300' : 'muted'
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Assessment() {
  const navigate = useNavigate();
  const toast = useToast();

  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState({});
  const [warnings, setWarnings] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Free the GPU/WASM landmarkers when leaving the flow.
  useEffect(() => releaseLandmarkers, []);

  // Warn before an accidental refresh mid-assessment.
  useEffect(() => {
    const handler = (e) => {
      if (Object.keys(results).length > 0 && current < STEPS.length - 1) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [results, current]);

  const step = STEPS[current];

  const handleModuleComplete = useCallback(
    (key) => (payload, warning) => {
      setResults((r) => ({ ...r, [key]: payload }));
      setWarnings((w) => ({ ...w, [key]: warning || null }));
      if (warning === 'lowData') {
        toast.warning(
          'That capture was short or the subject was hard to track. You can record again for a more reliable score.'
        );
      }
    },
    [toast]
  );

  const skip = (key) => {
    setResults((r) => {
      const next = { ...r };
      delete next[key];
      return next;
    });
    setCurrent((c) => Math.min(c + 1, STEPS.length - 1));
  };

  const completedCount = useMemo(
    () => STEPS.filter((s) => s.key !== 'result' && results[s.key]).length,
    [results]
  );

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {};
      for (const key of ['voice', 'face', 'hand', 'gait']) {
        if (results[key]) payload[key] = results[key];
      }
      const res = await api.post('/assessments', payload);
      toast.success('Analysis complete');
      navigate(`/result/${res.data.assessment.id}`, { replace: true });
    } catch (err) {
      setSubmitError(err.message);
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-white sm:text-3xl">
          Weekly Assessment
        </h1>
        <p className="mt-1 text-sm muted">
          Complete all four tests to generate your AI health result.
        </p>
      </div>

      <Stepper current={current} results={results} />

      {step.key === 'result' ? (
        <div className="card p-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
              <IconSparkle className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-extrabold text-ink dark:text-white">
              {completedCount === 4 ? 'All four tests complete' : `${completedCount} of 4 tests complete`}
            </h2>
            <p className="mt-2 text-sm muted">
              {completedCount === 4
                ? 'Submit to run the fusion engine and generate your score, risk level and recommendations.'
                : 'You can submit now, but a partial assessment is capped below 100% because there is less evidence behind it.'}
            </p>

            <ul className="mx-auto mt-7 max-w-sm space-y-2 text-left">
              {STEPS.filter((s) => s.key !== 'result').map((s) => {
                const done = Boolean(results[s.key]);
                const warn = warnings[s.key];
                return (
                  <li
                    key={s.key}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800"
                  >
                    <span className="text-sm font-semibold text-ink dark:text-slate-100">
                      {MODULE_META[s.key].label}
                    </span>
                    {done ? (
                      <span className={`chip ${warn ? 'text-risk-mild' : 'text-risk-low'}`}>
                        {warn ? <IconAlert className="h-3.5 w-3.5" /> : <IconCheck className="h-3.5 w-3.5" />}
                        {warn ? 'Low data' : 'Captured'}
                      </span>
                    ) : (
                      <span className="chip muted">Skipped</span>
                    )}
                  </li>
                );
              })}
            </ul>

            {submitError && (
              <div className="mt-6 rounded-xl border border-risk-high/25 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
                {submitError}
              </div>
            )}

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button onClick={() => setCurrent(0)} className="btn-ghost !px-6 !py-3">
                Back to tests
              </button>
              <button
                onClick={submit}
                disabled={submitting || completedCount === 0}
                className="btn-primary !px-8 !py-3"
              >
                {submitting ? (
                  <>
                    <Spinner className="h-4 w-4" /> Analysing…
                  </>
                ) : (
                  'Generate AI analysis'
                )}
              </button>
            </div>

            {completedCount === 0 && (
              <p className="mt-4 text-xs font-medium text-risk-mild">
                Complete at least one test before submitting.
              </p>
            )}

            <div className="mt-8 text-left">
              <DisclaimerNote />
            </div>
          </div>
        </div>
      ) : (
        <>
          <step.Component
            key={step.key}
            initial={results[step.key]}
            onComplete={handleModuleComplete(step.key)}
            onSkip={() => skip(step.key)}
          />

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
              className="btn-ghost !px-6"
            >
              Back
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs muted">
                {results[step.key] ? 'Captured — you can continue' : 'Record this test to continue'}
              </span>
              <button
                onClick={() => setCurrent((c) => Math.min(c + 1, STEPS.length - 1))}
                disabled={!results[step.key]}
                className="btn-primary !px-7"
              >
                {current === STEPS.length - 2 ? 'Review & submit' : 'Next test'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
