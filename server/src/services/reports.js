import Assessment from '../models/Assessment.js';
import Report from '../models/Report.js';
import { riskFromScore, mean, MODULE_KEYS } from './scoring/fusion.js';
import { buildRecommendations } from './recommendations.js';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function monthBounds(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  const period = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const periodLabel = `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  return { start, end, period, periodLabel };
}

function trendLabel(delta) {
  if (delta === null) return 'baseline';
  if (delta >= 3) return 'improving';
  if (delta <= -3) return 'declining';
  return 'stable';
}

function buildSummary({ periodLabel, count, score, risk, delta, moduleAverages }) {
  if (count === 0) return `No assessments were recorded in ${periodLabel}.`;

  const weakest = MODULE_KEYS.filter((k) => moduleAverages[k] !== null).sort(
    (a, b) => moduleAverages[a] - moduleAverages[b]
  )[0];

  const labels = { voice: 'voice', face: 'facial', hand: 'hand movement', gait: 'gait' };
  const parts = [
    `${count} assessment${count === 1 ? '' : 's'} completed in ${periodLabel}, averaging ${score}% (${risk.label}).`,
  ];

  if (delta !== null) {
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';
    parts.push(
      dir === 'unchanged'
        ? 'That is unchanged from the previous month.'
        : `That is ${dir} ${Math.abs(delta)} point${Math.abs(delta) === 1 ? '' : 's'} on the previous month.`
    );
  }

  if (weakest) {
    parts.push(
      `The ${labels[weakest]} module scored lowest this month at ${moduleAverages[weakest]}%.`
    );
  }

  return parts.join(' ');
}

/**
 * Recomputes (or removes) the monthly report covering `date` for a user.
 * Called after every assessment write so reports never drift out of sync.
 */
export async function regenerateMonthlyReport(userId, date = new Date()) {
  const { start, end, period, periodLabel } = monthBounds(date);

  const assessments = await Assessment.find({
    user: userId,
    completedAt: { $gte: start, $lte: end },
  }).sort({ completedAt: 1 });

  if (assessments.length === 0) {
    await Report.deleteOne({ user: userId, period });
    return null;
  }

  const overallScore = Math.round(mean(assessments.map((a) => a.overallScore)));
  const risk = riskFromScore(overallScore);

  const moduleAverages = {};
  for (const key of MODULE_KEYS) {
    const vals = assessments.filter((a) => a[key]?.completed).map((a) => a[key].score);
    moduleAverages[key] = vals.length ? Math.round(mean(vals)) : null;
  }

  // Compare against the most recent earlier report.
  const previous = await Report.findOne({ user: userId, periodStart: { $lt: start } }).sort({
    periodStart: -1,
  });
  const trend = previous ? overallScore - previous.overallScore : null;

  const latest = assessments[assessments.length - 1];
  const flags = [...new Set(assessments.flatMap((a) => a.flags))];
  const recommendations = buildRecommendations({
    flags,
    overallScore,
    riskLevel: risk.level,
    completedModules: MODULE_KEYS.filter((k) => moduleAverages[k] !== null),
    delta: trend,
    modules: {},
  });

  const series = assessments.map((a) => ({ date: a.completedAt, score: a.overallScore }));

  const payload = {
    user: userId,
    period,
    periodLabel,
    periodStart: start,
    periodEnd: end,
    assessmentCount: assessments.length,
    overallScore,
    riskLevel: risk.level,
    riskLabel: risk.label,
    moduleAverages,
    trend,
    trendLabel: trendLabel(trend),
    series,
    summary: buildSummary({
      periodLabel,
      count: assessments.length,
      score: overallScore,
      risk,
      delta: trend,
      moduleAverages,
    }),
    recommendations: recommendations.length ? recommendations : latest.recommendations,
    generatedAt: new Date(),
  };

  return Report.findOneAndUpdate({ user: userId, period }, payload, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

/** Rebuilds every month that has at least one assessment. Used by the seeder. */
export async function regenerateAllReports(userId) {
  const assessments = await Assessment.find({ user: userId }).select('completedAt').lean();
  const periods = new Set(assessments.map((a) => monthBounds(a.completedAt).period));
  for (const period of periods) {
    const [year, month] = period.split('-').map(Number);
    await regenerateMonthlyReport(userId, new Date(year, month - 1, 15));
  }
  return periods.size;
}
