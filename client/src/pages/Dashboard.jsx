import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  EmptyState,
  PageLoader,
  RiskBadge,
  ScoreBar,
  StatCard,
} from '../components/ui.jsx';
import {
  IconAssessment,
  IconChevronRight,
  IconReports,
  IconSparkle,
  IconTrend,
} from '../components/Icons.jsx';
import {
  MODULE_META,
  formatDate,
  greeting,
  relativeDays,
  riskStyle,
  scoreColor,
} from '../utils/format.js';

function ChartTooltip({ active, payload, dateFormat }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-card dark:border-slate-700 dark:bg-surface-cardDark">
      <p className="text-xs font-semibold text-ink dark:text-slate-100">{point.score}%</p>
      <p className="text-[11px] muted">{formatDate(point.date, dateFormat)}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const dateFormat = user?.settings?.dateFormat || 'dd/mm/yyyy';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/dashboard');
        if (!cancelled) setData(res.data);
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
  }, []);

  if (loading) return <PageLoader label="Loading your dashboard" />;
  if (!data) return null;

  const firstName = user?.fullName?.split(' ')[0] || 'there';

  if (!data.hasData) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-white sm:text-3xl">
            {greeting()}, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm muted">Let's establish your baseline.</p>
        </div>
        <EmptyState
          icon={IconSparkle}
          title="No assessments yet"
          description="Your first assessment takes about five minutes and sets the baseline that every future reading is compared against."
          action={
            <Link to="/assessment" className="btn-primary !px-7 !py-3">
              Start your first assessment
            </Link>
          }
        />
      </>
    );
  }

  const risk = data.risk;
  const style = riskStyle(risk?.level);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink dark:text-white sm:text-3xl">
          {greeting()}, {firstName} 👋
        </h1>
        <p className="mt-1 text-sm muted">
          Track your health, stay consistent, and take control of your well-being.
        </p>
      </div>

      {data.assessmentDue && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 dark:border-brand-800 dark:bg-brand-900/25">
          <div className="flex items-center gap-3">
            <IconAssessment className="h-5 w-5 text-brand-600 dark:text-brand-300" />
            <div>
              <p className="text-sm font-bold text-brand-800 dark:text-brand-200">
                Your weekly assessment is due
              </p>
              <p className="text-xs text-brand-700/80 dark:text-brand-300/80">
                Last completed {relativeDays(data.lastAssessmentAt)}.
              </p>
            </div>
          </div>
          <Link to="/assessment" className="btn-primary !py-2">
            Start now
          </Link>
        </div>
      )}

      {/* Stat row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Overall Health Score"
          value={`${data.overallScore}%`}
          caption={risk?.tone}
          tone={risk?.level}
        />
        <StatCard
          label="Risk Level"
          value={risk?.label || '—'}
          caption={
            data.delta === null
              ? 'Baseline reading'
              : `${data.delta >= 0 ? '+' : ''}${data.delta} pts since last time`
          }
          tone={risk?.level}
        />
        <StatCard
          label="Assessments"
          value={data.assessmentsThisMonth}
          caption={`This month · ${data.assessmentsTotal} total`}
          tone="brand"
        />
        <StatCard
          label="Next Assessment"
          value={data.daysRemaining === 0 ? 'Due now' : `${data.daysRemaining} Days`}
          caption={data.daysRemaining === 0 ? 'Ready to start' : 'Remaining'}
          tone="blue"
        />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        {/* Trend chart */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="section-title">Score Overview · Last {data.series.length} assessments</h2>
            <IconTrend className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          </div>

          {data.series.length < 2 ? (
            <p className="py-14 text-center text-sm muted">
              Complete one more assessment to see your trend.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="4 4" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip content={<ChartTooltip dateFormat={dateFormat} />} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#5B2BD9"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#5B2BD9', strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Module scores */}
        <div className="card p-6">
          <h2 className="section-title mb-3">Module Scores</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(MODULE_META).map(([key, meta]) => (
              <ScoreBar
                key={key}
                label={meta.label}
                score={data.moduleScores[key]?.current ?? null}
                color={meta.color}
              />
            ))}
          </div>
          <p className="mt-4 text-[11px] muted">
            Latest reading per module. Averages across recent assessments are on the History page.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Recommendations */}
        <div className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">AI Recommendations</h2>
            <Link
              to={`/history`}
              className="text-xs font-bold text-brand-600 dark:text-brand-300"
            >
              View all
            </Link>
          </div>

          {data.recommendations.length === 0 ? (
            <p className="py-8 text-center text-sm muted">
              No recommendations right now — everything is within typical ranges.
            </p>
          ) : (
            <ul className="space-y-4">
              {data.recommendations.map((rec, i) => {
                const dot =
                  rec.priority === 'high'
                    ? 'bg-risk-high'
                    : rec.priority === 'medium'
                      ? 'bg-risk-mild'
                      : 'bg-risk-low';
                return (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <div>
                      <p className="text-sm font-bold text-ink dark:text-slate-100">{rec.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed muted">{rec.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent reports */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">Recent Reports</h2>
            <IconReports className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          </div>

          {data.recentReports.length === 0 ? (
            <p className="py-8 text-center text-sm muted">Reports appear at the end of the month.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentReports.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => navigate('/reports')}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink dark:text-slate-100">
                        {r.periodLabel}
                      </p>
                      <p className="text-[11px] muted">{formatDate(r.generatedAt, dateFormat)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: scoreColor(r.overallScore) }}>
                        {r.overallScore}%
                      </span>
                      <IconChevronRight className="h-3.5 w-3.5 text-slate-300" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Link to="/reports" className="btn-outline mt-4 w-full !py-2 text-xs">
            All reports
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-surface-cardDark">
        <div className="flex items-center gap-3">
          <RiskBadge level={risk?.level} label={risk?.label} />
          <p className="text-sm muted">
            Last assessed {formatDate(data.lastAssessmentAt, dateFormat)}
          </p>
        </div>
        <Link to="/assessment" className="btn-primary !py-2.5">
          Start weekly assessment
        </Link>
      </div>
    </>
  );
}
