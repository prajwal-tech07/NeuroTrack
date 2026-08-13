import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  EmptyState,
  PageHeader,
  PageLoader,
  RiskBadge,
  ScoreBar,
  Spinner,
} from '../components/ui.jsx';
import { IconDownload, IconReports, IconTrend } from '../components/Icons.jsx';
import { MODULE_META, formatDate, scoreColor } from '../utils/format.js';

function TrendChip({ trend, label }) {
  if (trend === null || trend === undefined) {
    return <span className="chip muted">Baseline</span>;
  }
  const up = trend > 0;
  const flat = trend === 0;
  const cls = flat ? 'muted' : up ? 'text-risk-low' : 'text-risk-high';
  return (
    <span className={`chip ${cls}`}>
      {flat ? '→' : up ? '↑' : '↓'} {Math.abs(trend)} pts · {label}
    </span>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const toast = useToast();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const dateFormat = user?.settings?.dateFormat || 'dd/mm/yyyy';

  const load = async () => {
    try {
      const res = await api.get('/reports');
      setReports(res.data.reports);
      if (res.data.reports.length) setExpanded((e) => e ?? res.data.reports[0].id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    setBusy('generate');
    try {
      await api.post('/reports/generate');
      toast.success('Report generated for this month');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const download = async (report) => {
    setBusy(report.id);
    try {
      await api.download(
        `/reports/${report.id}/pdf`,
        `neurotrackai-report-${report.periodLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`
      );
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <PageLoader label="Loading your reports" />;

  return (
    <>
      <PageHeader
        title="Monthly Reports"
        subtitle="Review your health trends and download detailed reports."
        actions={
          <button onClick={generate} disabled={busy === 'generate'} className="btn-outline">
            {busy === 'generate' ? <Spinner className="h-4 w-4" /> : <IconTrend className="h-4 w-4" />}
            Regenerate this month
          </button>
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={IconReports}
          title="No reports yet"
          description="A monthly report is generated automatically once you have completed at least one assessment in a calendar month."
          action={
            <Link to="/assessment" className="btn-primary">
              Complete an assessment
            </Link>
          }
        />
      ) : (
        <>
          {/* Overview chart across all months */}
          {reports.length > 1 && (
            <div className="card mb-5 p-6">
              <h2 className="section-title mb-5">Month-over-month overall score</h2>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={[...reports].reverse().map((r) => ({
                      label: r.periodLabel,
                      score: r.overallScore,
                    }))}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5B2BD9" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#5B2BD9" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid #E2E8F0',
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v}%`, 'Overall']}
                    />
                    <Area type="monotone" dataKey="score" stroke="#5B2BD9" strokeWidth={2.5} fill="url(#repGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-100 dark:border-slate-800">
                  <tr className="text-xs font-bold uppercase tracking-wide muted">
                    <th className="px-6 py-4">Month</th>
                    <th className="px-6 py-4">Overall Score</th>
                    <th className="px-6 py-4">Risk Level</th>
                    <th className="px-6 py-4">Trend</th>
                    <th className="px-6 py-4">Generated On</th>
                    <th className="px-6 py-4 text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reports.map((r) => (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                        className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-6 py-4 font-semibold text-ink dark:text-slate-100">
                          {r.periodLabel}
                          <span className="ml-2 text-[11px] font-normal muted">
                            {r.assessmentCount} assessment{r.assessmentCount === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-bold" style={{ color: scoreColor(r.overallScore) }}>
                            {r.overallScore}%
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <RiskBadge level={r.riskLevel} label={r.riskLabel} size="sm" />
                        </td>
                        <td className="px-6 py-4">
                          <TrendChip trend={r.trend} label={r.trendLabel} />
                        </td>
                        <td className="px-6 py-4 muted">{formatDate(r.generatedAt, dateFormat)}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              download(r);
                            }}
                            disabled={busy === r.id}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 transition hover:text-brand-700 dark:text-brand-300"
                          >
                            {busy === r.id ? <Spinner className="h-3.5 w-3.5" /> : <IconDownload className="h-3.5 w-3.5" />}
                            Download PDF
                          </button>
                        </td>
                      </tr>

                      {expanded === r.id && (
                        <tr className="bg-slate-50/60 dark:bg-slate-900/30">
                          <td colSpan={6} className="px-6 py-5">
                            <div className="grid gap-6 lg:grid-cols-2">
                              <div>
                                <h3 className="mb-2 text-sm font-bold text-ink dark:text-slate-100">
                                  Summary
                                </h3>
                                <p className="text-sm leading-relaxed muted">{r.summary}</p>

                                {r.recommendations?.length > 0 && (
                                  <>
                                    <h3 className="mb-2 mt-5 text-sm font-bold text-ink dark:text-slate-100">
                                      Key recommendations
                                    </h3>
                                    <ul className="space-y-2">
                                      {r.recommendations.slice(0, 3).map((rec, i) => (
                                        <li key={i} className="flex gap-2 text-sm muted">
                                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                                          <span>
                                            <strong className="font-semibold text-ink dark:text-slate-200">
                                              {rec.title}.
                                            </strong>{' '}
                                            {rec.detail}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                )}
                              </div>

                              <div>
                                <h3 className="mb-2 text-sm font-bold text-ink dark:text-slate-100">
                                  Module averages
                                </h3>
                                {Object.entries(MODULE_META).map(([key, meta]) => (
                                  <ScoreBar
                                    key={key}
                                    label={meta.label}
                                    score={r.moduleAverages?.[key] ?? null}
                                    color={meta.color}
                                  />
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-xs muted">
            Reports refresh automatically whenever you complete an assessment. A new month's report
            is created on the 1st.
          </p>
        </>
      )}
    </>
  );
}
