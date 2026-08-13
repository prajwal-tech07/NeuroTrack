import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
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
  PageHeader,
  PageLoader,
  RiskBadge,
  Spinner,
} from '../components/ui.jsx';
import { IconChevronRight, IconDownload, IconHistory } from '../components/Icons.jsx';
import { MODULE_META, formatDate, formatTime, scoreColor } from '../utils/format.js';

const RISK_FILTERS = [
  { value: '', label: 'All risk levels' },
  { value: 'low', label: 'Low Risk' },
  { value: 'mild', label: 'Mild Risk' },
  { value: 'moderate', label: 'Moderate Risk' },
  { value: 'high', label: 'High Risk' },
];

export default function History() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [assessments, setAssessments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState('');
  const [busy, setBusy] = useState(null);

  const settings = user?.settings || {};

  const load = async (page = 1, risk = riskFilter) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '15' });
      if (risk) query.set('riskLevel', risk);

      const [list, trend] = await Promise.all([
        api.get(`/assessments?${query}`),
        api.get('/dashboard/trends?limit=16'),
      ]);
      setAssessments(list.data.assessments);
      setPagination(list.data.pagination);
      setTrends(trend.data.series);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, riskFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskFilter]);

  const chartData = useMemo(
    () =>
      trends.map((t) => ({
        ...t,
        label: formatDate(t.date, settings.dateFormat),
      })),
    [trends, settings.dateFormat]
  );

  const download = async (a) => {
    setBusy(a.id);
    try {
      const date = new Date(a.completedAt).toISOString().slice(0, 10);
      await api.download(`/assessments/${a.id}/pdf`, `neurotrackai-assessment-${date}.pdf`);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a) => {
    if (!window.confirm('Delete this assessment? This cannot be undone.')) return;
    setBusy(a.id);
    try {
      await api.delete(`/assessments/${a.id}`);
      toast.success('Assessment deleted');
      await load(pagination.page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading && assessments.length === 0) return <PageLoader label="Loading your history" />;

  return (
    <>
      <PageHeader
        title="Assessment History"
        subtitle="View your previous assessment records and compare progress."
        actions={
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="input !w-auto !py-2 text-sm"
          >
            {RISK_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        }
      />

      {assessments.length === 0 ? (
        <EmptyState
          icon={IconHistory}
          title={riskFilter ? 'No assessments match that filter' : 'No assessments yet'}
          description={
            riskFilter
              ? 'Try a different risk level.'
              : 'Your assessment records will appear here once you complete your first one.'
          }
          action={
            <Link to="/assessment" className="btn-primary">
              Start an assessment
            </Link>
          }
        />
      ) : (
        <>
          {/* Per-module trend chart */}
          {chartData.length > 1 && (
            <div className="card mb-5 p-6">
              <h2 className="section-title mb-5">Module scores over time</h2>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="4 4" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    <Line type="monotone" dataKey="overall" name="Overall" stroke="#1E1B33" strokeWidth={2.6} dot={false} />
                    {Object.entries(MODULE_META).map(([key, meta]) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={meta.short}
                        stroke={meta.color}
                        strokeWidth={1.8}
                        dot={false}
                        strokeDasharray="4 3"
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Records table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-slate-100 dark:border-slate-800">
                  <tr className="text-xs font-bold uppercase tracking-wide muted">
                    <th className="px-6 py-4">Date</th>
                    <th className="px-4 py-4">Voice</th>
                    <th className="px-4 py-4">Face</th>
                    <th className="px-4 py-4">Hand</th>
                    <th className="px-4 py-4">Gait</th>
                    <th className="px-4 py-4">Overall</th>
                    <th className="px-4 py-4">Risk Level</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {assessments.map((a) => (
                    <tr key={a.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-ink dark:text-slate-100">
                          {formatDate(a.completedAt, settings.dateFormat)}
                        </p>
                        <p className="text-[11px] muted">
                          {formatTime(a.completedAt, settings.timeFormat)}
                        </p>
                      </td>
                      {['voice', 'face', 'hand', 'gait'].map((key) => (
                        <td key={key} className="px-4 py-4">
                          {a[key]?.completed ? (
                            <span className="font-semibold" style={{ color: scoreColor(a[key].score) }}>
                              {a[key].score}%
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-4">
                        <span className="font-extrabold" style={{ color: scoreColor(a.overallScore) }}>
                          {a.overallScore}%
                        </span>
                        {a.delta !== null && (
                          <span
                            className={`ml-1.5 text-[11px] font-semibold ${a.delta >= 0 ? 'text-risk-low' : 'text-risk-high'}`}
                          >
                            {a.delta >= 0 ? '+' : ''}
                            {a.delta}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <RiskBadge level={a.riskLevel} label={a.riskLabel} size="sm" />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => download(a)}
                            disabled={busy === a.id}
                            title="Download PDF"
                            className="text-slate-400 transition hover:text-brand-600"
                          >
                            {busy === a.id ? <Spinner className="h-4 w-4" /> : <IconDownload className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => remove(a)}
                            disabled={busy === a.id}
                            title="Delete"
                            className="text-slate-400 transition hover:text-risk-high"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                            </svg>
                          </button>
                          <button
                            onClick={() => navigate(`/result/${a.id}`)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 dark:text-brand-300"
                          >
                            View
                            <IconChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pagination.pages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs muted">
                Page {pagination.page} of {pagination.pages} · {pagination.total} assessments
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => load(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="btn-ghost !px-4 !py-2 text-xs"
                >
                  Previous
                </button>
                <button
                  onClick={() => load(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages}
                  className="btn-ghost !px-4 !py-2 text-xs"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
