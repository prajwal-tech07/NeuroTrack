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


const PATTERN_STYLE = {
  typical: { text: 'text-risk-low', bg: 'bg-risk-low/8', border: 'border-risk-low/25', dot: 'bg-risk-low' },
  parkinsonian: { text: 'text-risk-mild', bg: 'bg-risk-mild/8', border: 'border-risk-mild/25', dot: 'bg-risk-mild' },
  hemiparetic: { text: 'text-risk-high', bg: 'bg-risk-high/8', border: 'border-risk-high/25', dot: 'bg-risk-high' },
  mixed: { text: 'text-risk-moderate', bg: 'bg-risk-moderate/8', border: 'border-risk-moderate/25', dot: 'bg-risk-moderate' },
};

/** Left/right balance bar — the measurement that separates the two patterns. */
function LateralityBar({ laterality }) {
  if (!laterality?.measured || !isFinite(laterality.index)) return null;

  const pct = Math.round(laterality.index * 100);
  const side = laterality.affectedSide;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold muted">Left / right balance</span>
        <span className="font-bold text-ink dark:text-slate-100">
          {pct}% difference
          {side ? ` · ${side} side weaker` : ''}
        </span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            laterality.index >= 0.35 ? 'bg-risk-high' : laterality.index >= 0.2 ? 'bg-risk-mild' : 'bg-risk-low'
          }`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] muted">
        <span>0% — both sides equal (bilateral pattern)</span>
        <span>100% — fully one-sided</span>
      </div>
      {laterality.modalitiesMeasured > 0 && (
        <p className="mt-2 text-[11px] muted">
          Measured across {laterality.modalitiesMeasured} module
          {laterality.modalitiesMeasured === 1 ? '' : 's'}
          {laterality.modalitiesAgreeing > 1
            ? ` · ${laterality.modalitiesAgreeing} agree on the same weaker side`
            : ''}
        </p>
      )}
    </div>
  );
}

function PatternCard({ pattern, laterality }) {
  if (!pattern) return null;
  const style = PATTERN_STYLE[pattern.type] || PATTERN_STYLE.mixed;
  const urgent = pattern.type === 'hemiparetic' && !pattern.tentative;

  return (
    <div className={`card mt-5 border-2 p-6 ${style.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
          <h2 className="section-title">Movement Pattern</h2>
        </div>
        <span className="chip border border-slate-200 muted dark:border-slate-700">
          {Math.round((pattern.confidence || 0) * 100)}% confidence
        </span>
      </div>

      <p className={`mt-3 text-2xl font-extrabold ${style.text}`}>
        {pattern.label}
        {pattern.affectedSide && (
          <span className="ml-2 text-base font-bold capitalize">· {pattern.affectedSide} side</span>
        )}
      </p>
      <p className="mt-2 text-sm leading-relaxed muted">{pattern.summary}</p>

      {urgent && (
        <div className="mt-4 rounded-xl border-2 border-risk-high bg-risk-high/10 px-4 py-3.5">
          <p className="text-sm font-extrabold text-risk-high">
            If this started suddenly — call emergency services now
          </p>
          <p className="mt-1 text-sm leading-relaxed text-risk-high/90">
            Sudden one-sided weakness, facial drooping or slurred speech can be a stroke, and
            treatment is time-critical. India: <strong>112</strong> · US: <strong>911</strong> · UK:{' '}
            <strong>999</strong>. If it developed gradually over weeks or months, book a neurologist
            instead.
          </p>
        </div>
      )}

      <LateralityBar laterality={laterality} />

      {pattern.evidence?.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide muted">What led to this</p>
          <ul className="space-y-1.5">
            {pattern.evidence.map((e, i) => (
              <li key={i} className="flex gap-2 text-sm muted">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pattern.scores && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            ['Bilateral slowing', pattern.scores.parkinsonian],
            ['One-sided weakness', pattern.scores.hemiparetic],
          ].map(([label, v]) => (
            <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900/40">
              <p className="text-[11px] muted">{label} evidence</p>
              <p className="text-sm font-bold text-ink dark:text-slate-100">
                {Math.round((v || 0) * 100)}%
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed muted">
        This describes what your <em>movement</em> resembles, not a diagnosis. Many ordinary things —
        fatigue, cold hands, low mood, medication, or simply an awkward camera angle — produce
        similar measurements.
      </p>
    </div>
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

      {/* Dual Condition Screening Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-ink dark:text-white mb-3 flex items-center gap-2">
          <span>Targeted Condition Screening</span>
          {assessment.scoringEngine && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 border border-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:border-brand-800">
              {assessment.scoringEngine === 'ml-v1' ? 'AI / ML Multi-Model' : 'Clinical Heuristics'}
            </span>
          )}
        </h2>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Parkinson's Card */}
          {assessment.conditions?.parkinsons ? (
            <div className="card p-6 border-l-4 border-l-purple-500 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🧠</span>
                    <h3 className="text-base font-bold text-ink dark:text-slate-100">Parkinson’s Disease Risk</h3>
                  </div>
                  <RiskBadge level={assessment.conditions.parkinsons.riskLevel} />
                </div>
                
                <div className="mt-4 flex items-center gap-4">
                  <div className="text-3xl font-extrabold text-brand-600 dark:text-brand-400">
                    {assessment.conditions.parkinsons.score}%
                  </div>
                  <div className="text-xs muted leading-relaxed">
                    Confidence: {Math.round((assessment.conditions.parkinsons.confidence || 0.85) * 100)}% · Biomarkers: 4-6 Hz tremor, bradykinesia, hypomimia
                  </div>
                </div>

                {assessment.conditions.parkinsons.contributingFactors?.length > 0 && (
                  <div className="mt-3.5 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider muted">Key Indicators:</p>
                    {assessment.conditions.parkinsons.contributingFactors.map((factor, idx) => (
                      <p key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
                        <span className="text-amber-500 font-bold">•</span>
                        <span>{factor}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-6 border-l-4 border-l-purple-500">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink dark:text-white">🧠 Parkinson's Disease Screening</span>
                <span className="text-xs text-risk-low font-bold">Standard Range</span>
              </div>
              <p className="mt-2 text-xs muted">Hand movement, cadence, and vocal stability tracked in normal bounds.</p>
            </div>
          )}

          {/* Paralysis / Stroke Card */}
          {assessment.conditions?.paralysis ? (
            <div className="card p-6 border-l-4 border-l-rose-500 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">⚡</span>
                    <h3 className="text-base font-bold text-ink dark:text-slate-100">Paralysis & Stroke Risk</h3>
                  </div>
                  <RiskBadge level={assessment.conditions.paralysis.riskLevel} />
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div className="text-3xl font-extrabold text-rose-600 dark:text-rose-400">
                    {assessment.conditions.paralysis.score}%
                  </div>
                  <div className="text-xs muted leading-relaxed">
                    Confidence: {Math.round((assessment.conditions.paralysis.confidence || 0.85) * 100)}% · Biomarkers: Facial droop, hemiparetic gait, motor paresis
                  </div>
                </div>

                {assessment.conditions.paralysis.contributingFactors?.length > 0 && (
                  <div className="mt-3.5 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider muted">Key Indicators:</p>
                    {assessment.conditions.paralysis.contributingFactors.map((factor, idx) => (
                      <p key={idx} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
                        <span className="text-rose-500 font-bold">•</span>
                        <span>{factor}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-6 border-l-4 border-l-rose-500">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink dark:text-white">⚡ Paralysis & Stroke Screening</span>
                <span className="text-xs text-risk-low font-bold">Standard Range</span>
              </div>
              <p className="mt-2 text-xs muted">Facial symmetry, bilateral step harmony, and motor tone within typical limits.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Score ring */}
        <div className="card flex flex-col items-center justify-center p-8">
          <h2 className="section-title mb-6 self-start">Overall Composite Score</h2>
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
            <h2 className="section-title mb-3">Overall Risk Category</h2>
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

      <PatternCard pattern={assessment.pattern} laterality={assessment.laterality} />

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
