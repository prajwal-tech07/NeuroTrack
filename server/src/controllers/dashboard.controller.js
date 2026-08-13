import Assessment from '../models/Assessment.js';
import Report from '../models/Report.js';
import env from '../config/env.js';
import { asyncHandler } from '../utils/ApiError.js';
import { MODULE_KEYS, mean, riskFromScore } from '../services/scoring/fusion.js';
import { monthBounds } from '../services/reports.js';

const DAY = 86400000;

export const getDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const now = new Date();
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const [latest, recent, monthCount, totalCount, reports] = await Promise.all([
    Assessment.findOne({ user: userId }).sort({ completedAt: -1 }),
    Assessment.find({ user: userId }).sort({ completedAt: -1 }).limit(12),
    Assessment.countDocuments({ user: userId, completedAt: { $gte: monthStart, $lte: monthEnd } }),
    Assessment.countDocuments({ user: userId }),
    Report.find({ user: userId }).sort({ periodStart: -1 }).limit(4),
  ]);

  // Trend series runs oldest -> newest so charts read left to right.
  const series = [...recent].reverse().map((a, i) => ({
    id: a._id.toString(),
    label: `Week ${i + 1}`,
    date: a.completedAt,
    score: a.overallScore,
    riskLevel: a.riskLevel,
  }));

  const moduleScores = {};
  for (const key of MODULE_KEYS) {
    const values = recent.filter((a) => a[key]?.completed).map((a) => a[key].score);
    moduleScores[key] = {
      current: latest?.[key]?.completed ? latest[key].score : null,
      average: values.length ? Math.round(mean(values)) : null,
    };
  }

  const next = req.user.nextAssessmentAt;
  const daysRemaining = next ? Math.max(0, Math.ceil((next.getTime() - now.getTime()) / DAY)) : 0;

  const overallScore = latest?.overallScore ?? null;
  const risk = overallScore === null ? null : riskFromScore(overallScore);

  res.json({
    success: true,
    data: {
      hasData: totalCount > 0,
      overallScore,
      risk: risk ? { level: risk.level, label: risk.label, tone: risk.tone } : null,
      delta: latest?.delta ?? null,
      assessmentsThisMonth: monthCount,
      assessmentsTotal: totalCount,
      lastAssessmentAt: latest?.completedAt ?? null,
      nextAssessmentAt: next,
      daysRemaining,
      assessmentDue: daysRemaining === 0,
      intervalDays: env.assessmentIntervalDays,
      series,
      moduleScores,
      recommendations: latest?.recommendations?.slice(0, 3) ?? [],
      recentReports: reports.map((r) => ({
        id: r._id.toString(),
        periodLabel: r.periodLabel,
        overallScore: r.overallScore,
        riskLabel: r.riskLabel,
        riskLevel: r.riskLevel,
        generatedAt: r.generatedAt,
      })),
    },
  });
});

/** Per-module score history for the History page charts. */
export const getTrends = asyncHandler(async (req, res) => {
  const limit = Math.min(52, Math.max(4, Number(req.query.limit) || 12));

  const rows = await Assessment.find({ user: req.user._id })
    .sort({ completedAt: -1 })
    .limit(limit)
    .select('overallScore riskLevel completedAt voice.score face.score hand.score gait.score');

  const series = [...rows].reverse().map((a) => ({
    date: a.completedAt,
    overall: a.overallScore,
    riskLevel: a.riskLevel,
    voice: a.voice?.score ?? null,
    face: a.face?.score ?? null,
    hand: a.hand?.score ?? null,
    gait: a.gait?.score ?? null,
  }));

  res.json({ success: true, data: { series } });
});
