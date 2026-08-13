import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  DisclaimerNote,
  EmptyState,
  PageLoader,
  RiskBadge,
  ScoreBar,
  ScoreRing,
  Spinner,
} from '../components/ui.jsx';
import { IconDownload, IconHistory } from '../components/Icons.jsx';
import { MODULE_META, formatDateTime, riskStyle } from '../utils/format.js';

const STATUS_STYLE = {
  normal: 'text-risk-low bg-risk-low/10 border-risk-low/25',
  borderline: 'text-risk-mild bg-risk-mild/10 border-risk-mild/25',
  atypical: 'text-risk-high bg-risk-high/10 border-risk-high/25',
  unknown: 'muted bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700',
};

function IndicatorTable({ moduleKey, module }) {
  const meta = MODULE_META[moduleKey];
  if (!module?.completed) return null;

  return (
    <details className="group border-t border-slate-100 py-4 first:border-t-0 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="text-sm font-bold text-ink dark:text-slate-100">{meta.label}</span>
          <span className="text-sm font-extrabold" style={{ color: meta.color }}>
            {module.score}%
          </span>
        </div>
        <span className="text-xs font-semibold text-brand-600 transition group-open:rotate-180 dark:text-brand-300">
          ▾
        </span>
      </summary>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide muted">
              <th className="pb-2 font-bold">Measure</th>
              <th className="pb-2 font-bold">Value</th>
              <th className="pb-2 font-bold">Typical</th>
              <th className="pb-2 font-bold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {module.indicators?.map((ind) => (
              <tr key={ind.key}>
                <td className="py-2.5 pr-4">
                  <p className="font-medium text-ink dark:text-slate-100">{ind.label}</p>
                  {ind.note && <p className="mt-0.5 text-[11px] muted">{ind.note}</p>}
                </td>
                <td className="py-2.5 pr-4 font-semibold text-ink dark:text-slate-100">
                  {ind.value === null ? '—' : `${ind.value}${ind.unit ? ` ${ind.unit}` : ''}`}
                </td>
                <td className="py-2.5 pr-4 muted">{ind.normal || '—'}</td>
                <td className="py-2.5">
                  <span className={`chip border ${STATUS_STYLE[ind.status]}`}>{ind.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function Result() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();

  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const settings = user?.settings || {};

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/assessments/${id}`);
        if (!cancelled) setAssessment(res.data.assessment);
      } catch (err) {
        if (!cancelled) toast.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const download = async () => {
    setDownloading(true);
    try {
      const date = new Date(assessment.completedAt).toISOString().slice(0, 10);
      await api.download(`/assessments/${id}/pdf`, `neurotrackai-assessment-${date}.pdf`);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <PageLoader label="Loading your result" />;
  if (!assessment)
    return (
      <EmptyState
        title="Result not found"
        description="This assessment may have been deleted."
        action={
          <Link to="/history" className="btn-primary">
            Back to history
          </Link>
        }
      />
    );

  const style = riskStyle(assessment.riskLevel);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-white sm:text-3xl">
            AI Analysis Result
          </h1>
          <p className="mt-1 text-sm muted">
            {formatDateTime(assessment.completedAt, settings.dateFormat, settings.timeFormat)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/history" className="btn-ghost">
            <IconHistory className="h-4 w-4" />
            View history
          </Link>
          <button onClick={download} disabled={downloading} className="btn-primary">
            {downloading ? <Spinner className="h-4 w-4" /> : <IconDownload className="h-4 w-4" />}
            Download Report
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Score ring */}
        <div className="card flex flex-col items-center justify-center p-8">
          <h2 className="section-title mb-6 self-start">Overall Health Score</h2>
          <ScoreRing
            score={assessment.overallScore}
            label={style.label}
            sublabel={
              assessment.delta === null
                ? 'Baseline assessment'
                : `${assessment.delta >= 0 ? '+' : ''}${assessment.delta} pts vs last time`
            }
          />
        </div>

        <div className="flex flex-col gap-5">
          {/* Risk */}
          <div className="card p-6">
            <h2 className="section-title mb-3">Risk Level</h2>
            <p className={`text-3xl font-extrabold ${style.text}`}>{assessment.riskLabel}</p>
            <p className="mt-1.5 text-sm muted">
              {assessment.riskLevel === 'low'
                ? 'Continue regular monitoring.'
                : assessment.riskLevel === 'mild'
                  ? 'Worth watching — repeat next week and compare.'
                  : assessment.riskLevel === 'moderate'
                    ? 'Increase testing frequency and review the recommendations below.'
                    : 'Consider taking this report to a clinician.'}
            </p>
          </div>

          {/* Module scores */}
          <div className="card flex-1 p-6">
            <h2 className="section-title mb-2">Module Scores</h2>
            {Object.entries(MODULE_META).map(([key, meta]) => (
              <ScoreBar
                key={key}
                label={meta.label}
                score={assessment[key]?.completed ? assessment[key].score : null}
                color={meta.color}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detailed indicators */}
      <div className="card mt-5 p-6">
        <h2 className="section-title mb-2">Measurement Detail</h2>
        <p className="mb-4 text-sm muted">
          Expand any module to see the individual measurements behind its score and how they compare
          to published typical ranges.
        </p>
        {Object.keys(MODULE_META).map((key) => (
          <IndicatorTable key={key} moduleKey={key} module={assessment[key]} />
        ))}
      </div>

      {/* Recommendations */}
      <div className="card mt-5 p-6">
        <h2 className="section-title mb-4">AI Recommendations</h2>
        {assessment.recommendations.length === 0 ? (
          <p className="text-sm muted">No specific recommendations for this assessment.</p>
        ) : (
          <ul className="space-y-5">
            {assessment.recommendations.map((rec, i) => {
              const tone =
                rec.priority === 'high'
                  ? 'border-risk-high/25 bg-risk-high/5'
                  : rec.priority === 'medium'
                    ? 'border-risk-mild/25 bg-risk-mild/5'
                    : 'border-risk-low/25 bg-risk-low/5';
              const dot =
                rec.priority === 'high'
                  ? 'bg-risk-high'
                  : rec.priority === 'medium'
                    ? 'bg-risk-mild'
                    : 'bg-risk-low';
              return (
                <li key={i} className={`rounded-xl border px-5 py-4 ${tone}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <p className="text-sm font-bold text-ink dark:text-slate-100">{rec.title}</p>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wide muted">
                      {rec.priority}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed muted">{rec.detail}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card mt-5 p-6">
        <DisclaimerNote />
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/dashboard" className="btn-ghost !px-6">
          Back to dashboard
        </Link>
        <Link to="/history" className="btn-outline !px-6">
          Compare with history
        </Link>
      </div>
    </>
  );
}
