import Report from '../models/Report.js';
import Assessment from '../models/Assessment.js';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import { regenerateMonthlyReport, regenerateAllReports } from '../services/reports.js';
import { buildReportPDF, buildAssessmentPDF } from '../services/pdf.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const listReports = asyncHandler(async (req, res) => {
  const reports = await Report.find({ user: req.user._id }).sort({ periodStart: -1 }).limit(24);
  res.json({ success: true, data: { reports: reports.map((r) => r.toPublic()) } });
});

export const getReport = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, user: req.user._id });
  if (!report) throw ApiError.notFound('Report not found');
  res.json({ success: true, data: { report: report.toPublic() } });
});

/** Force-rebuild every month that has data. Handy after importing old records. */
export const rebuildReports = asyncHandler(async (req, res) => {
  const count = await regenerateAllReports(req.user._id);
  const reports = await Report.find({ user: req.user._id }).sort({ periodStart: -1 });
  res.json({
    success: true,
    message: `Rebuilt ${count} monthly report${count === 1 ? '' : 's'}`,
    data: { reports: reports.map((r) => r.toPublic()) },
  });
});

/** Generates the current month's report on demand. */
export const generateCurrentReport = asyncHandler(async (req, res) => {
  const report = await regenerateMonthlyReport(req.user._id, new Date());
  if (!report) throw ApiError.badRequest('Complete at least one assessment this month first');
  res.json({ success: true, message: 'Report generated', data: { report: report.toPublic() } });
});

export const downloadReportPDF = asyncHandler(async (req, res) => {
  const report = await Report.findOne({ _id: req.params.id, user: req.user._id });
  if (!report) throw ApiError.notFound('Report not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="neurotrackai-report-${slug(report.periodLabel)}.pdf"`
  );

  const doc = buildReportPDF(req.user, report);
  doc.pipe(res);
});

export const downloadAssessmentPDF = asyncHandler(async (req, res) => {
  const assessment = await Assessment.findOne({ _id: req.params.id, user: req.user._id });
  if (!assessment) throw ApiError.notFound('Assessment not found');

  const date = new Date(assessment.completedAt).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="neurotrackai-assessment-${date}.pdf"`);

  const doc = buildAssessmentPDF(req.user, assessment);
  doc.pipe(res);
});
