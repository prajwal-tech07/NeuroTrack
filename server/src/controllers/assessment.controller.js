import Assessment from '../models/Assessment.js';
import env from '../config/env.js';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import { analyzeAssessment, MODULE_KEYS } from '../services/scoring/fusion.js';
import { buildRecommendations } from '../services/recommendations.js';
import { regenerateMonthlyReport } from '../services/reports.js';

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export const submitAssessment = asyncHandler(async (req, res) => {
  const modules = {};
  for (const key of MODULE_KEYS) {
    if (req.body[key]) modules[key] = req.body[key];
  }

  let analysis;
  try {
    analysis = await analyzeAssessment({ modules, age: req.user.age });
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }

  const previous = await Assessment.findOne({ user: req.user._id }).sort({ completedAt: -1 });
  const delta = previous ? analysis.overallScore - previous.overallScore : null;

  const recommendations = buildRecommendations({ ...analysis, delta });

  const doc = await Assessment.create({
    user: req.user._id,
    voice: analysis.modules.voice,
    face: analysis.modules.face,
    hand: analysis.modules.hand,
    gait: analysis.modules.gait,
    pattern: analysis.pattern,
    laterality: analysis.laterality,
    overallScore: analysis.overallScore,
    riskLevel: analysis.riskLevel,
    riskLabel: analysis.riskLabel,
    conditions: analysis.conditions || null,
    scoringEngine: analysis.scoringEngine || 'ml-v1',
    delta,
    recommendations,
    flags: analysis.flags,
    engineVersion: analysis.engineVersion || '2.0.0',
    completedAt: new Date(),
  });

  req.user.lastAssessmentAt = doc.completedAt;
  req.user.nextAssessmentAt = addDays(doc.completedAt, env.assessmentIntervalDays);
  await req.user.save({ validateBeforeSave: false });

  // Keep the month's report in sync so the Reports page is never stale.
  await regenerateMonthlyReport(req.user._id, doc.completedAt);

  res.status(201).json({
    success: true,
    message: 'Assessment analysed',
    data: {
      assessment: doc.toPublic(),
      nextAssessmentAt: req.user.nextAssessmentAt,
    },
  });
});

export const listAssessments = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const filter = { user: req.user._id };
  if (req.query.riskLevel) filter.riskLevel = req.query.riskLevel;
  if (req.query.from || req.query.to) {
    filter.completedAt = {};
    if (req.query.from) filter.completedAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.completedAt.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    Assessment.find(filter)
      .sort({ completedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Assessment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      assessments: items.map((a) => a.toPublic()),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const getAssessment = asyncHandler(async (req, res) => {
  const doc = await Assessment.findOne({ _id: req.params.id, user: req.user._id });
  if (!doc) throw ApiError.notFound('Assessment not found');
  res.json({ success: true, data: { assessment: doc.toPublic() } });
});

export const getLatestAssessment = asyncHandler(async (req, res) => {
  const doc = await Assessment.findOne({ user: req.user._id }).sort({ completedAt: -1 });
  if (!doc) throw ApiError.notFound('No assessments yet');
  res.json({ success: true, data: { assessment: doc.toPublic() } });
});

export const deleteAssessment = asyncHandler(async (req, res) => {
  const doc = await Assessment.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!doc) throw ApiError.notFound('Assessment not found');
  await regenerateMonthlyReport(req.user._id, doc.completedAt);
  res.json({ success: true, message: 'Assessment deleted' });
});
