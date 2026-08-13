import PDFDocument from 'pdfkit';
import { MODULE_LABELS } from './scoring/fusion.js';

const BRAND = '#5B2BD9';
const INK = '#1E1B33';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';

const RISK_COLORS = {
  low: '#16A34A',
  mild: '#F59E0B',
  moderate: '#EA580C',
  high: '#DC2626',
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function header(doc, title, subtitle) {
  doc.fillColor(BRAND).fontSize(20).font('Helvetica-Bold').text('NeuroTrackAI', 50, 45);
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .font('Helvetica')
    .text('AI-powered neurological screening', 50, 68);

  doc.moveTo(50, 88).lineTo(545, 88).strokeColor(LINE).lineWidth(1).stroke();

  doc.fillColor(INK).fontSize(22).font('Helvetica-Bold').text(title, 50, 106);
  if (subtitle) doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(subtitle, 50, 134);

  return 158;
}

/**
 * Stamps the disclaimer footer and page numbers onto every buffered page.
 *
 * This runs once at the end rather than per page: writing near the bottom edge
 * mid-document makes PDFKit insert an automatic page break, which produced a
 * blank page after every footer. Dropping the bottom margin for the stamp
 * suppresses that break.
 */
function stampFooters(doc) {
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const savedMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - 62;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();

    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .font('Helvetica')
      .text(
        'NeuroTrackAI is a screening and wellness-tracking aid. It does not diagnose any medical ' +
          'condition. Discuss any concern about your health with a qualified clinician.',
        50,
        y + 8,
        { width: 430 }
      );

    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .font('Helvetica-Bold')
      .text(`${i - range.start + 1} / ${range.count}`, 490, y + 8, { width: 55, align: 'right' });

    doc.page.margins.bottom = savedMargin;
  }

  doc.flushPages();
}

/** Content must stop above this to leave room for the stamped footer. */
const CONTENT_BOTTOM = 700;

/** A rounded stat card. Returns the y coordinate below it. */
function statCard(doc, x, y, w, h, label, value, valueColor = INK, caption = '') {
  doc.roundedRect(x, y, w, h, 8).strokeColor(LINE).lineWidth(1).stroke();
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label, x + 12, y + 12, { width: w - 24 });
  doc
    .fillColor(valueColor)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(String(value), x + 12, y + 28, { width: w - 24 });
  if (caption) {
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica').text(caption, x + 12, y + h - 20, {
      width: w - 24,
    });
  }
  return y + h;
}

/** Horizontal score bar. */
function scoreBar(doc, x, y, w, label, score, color) {
  doc.fillColor(INK).fontSize(9).font('Helvetica').text(label, x, y, { width: 130 });

  const barX = x + 140;
  const barW = w - 190;
  doc.roundedRect(barX, y + 1, barW, 8, 4).fillColor('#EFF0F6').fill();

  if (typeof score === 'number') {
    const filled = Math.max(6, (barW * score) / 100);
    doc.roundedRect(barX, y + 1, filled, 8, 4).fillColor(color).fill();
    doc
      .fillColor(color)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(`${score}%`, barX + barW + 10, y, { width: 40 });
  } else {
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('n/a', barX + barW + 10, y, { width: 40 });
  }

  return y + 20;
}

/** Simple line chart of a score series. */
function sparkline(doc, x, y, w, h, series) {
  doc.roundedRect(x, y, w, h, 8).strokeColor(LINE).lineWidth(1).stroke();
  if (!series || series.length < 2) {
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font('Helvetica')
      .text('Not enough assessments yet to draw a trend.', x + 14, y + h / 2 - 6);
    return y + h;
  }

  const padX = 24;
  const padY = 22;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const scores = series.map((s) => s.score);
  const min = Math.max(0, Math.min(...scores) - 8);
  const max = Math.min(100, Math.max(...scores) + 8);
  const span = max - min || 1;

  const pt = (i, score) => ({
    px: x + padX + (innerW * i) / (series.length - 1),
    py: y + padY + innerH - (innerH * (score - min)) / span,
  });

  // Gridlines
  for (let g = 0; g <= 3; g++) {
    const gy = y + padY + (innerH * g) / 3;
    doc.moveTo(x + padX, gy).lineTo(x + w - padX, gy).strokeColor('#F1F2F7').lineWidth(1).stroke();
  }

  doc.strokeColor(BRAND).lineWidth(2);
  series.forEach((s, i) => {
    const { px, py } = pt(i, s.score);
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  });
  doc.stroke();

  series.forEach((s, i) => {
    const { px, py } = pt(i, s.score);
    doc.circle(px, py, 2.6).fillColor(BRAND).fill();
  });

  doc
    .fillColor(MUTED)
    .fontSize(7)
    .font('Helvetica')
    .text(`${Math.round(max)}%`, x + 6, y + padY - 4)
    .text(`${Math.round(min)}%`, x + 6, y + padY + innerH - 4);

  return y + h;
}

function recommendationsBlock(doc, y, recommendations) {
  if (!recommendations?.length) return y;

  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text('Recommendations', 50, y);
  let cursor = y + 22;

  for (const rec of recommendations.slice(0, 5)) {
    if (cursor > CONTENT_BOTTOM) {
      doc.addPage();
      cursor = 60;
    }
    const dot = { high: '#DC2626', medium: '#F59E0B', low: '#16A34A' }[rec.priority] || MUTED;
    doc.circle(56, cursor + 5, 3).fillColor(dot).fill();
    doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(rec.title, 68, cursor, { width: 477 });
    cursor = doc.y + 2;
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(rec.detail, 68, cursor, { width: 477 });
    cursor = doc.y + 12;
  }
  return cursor;
}

/** Monthly report PDF. Returns a readable stream. */
export function buildReportPDF(user, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

  let y = header(doc, 'Monthly Health Report', `${report.periodLabel} · ${user.fullName}`);

  const riskColor = RISK_COLORS[report.riskLevel] || INK;
  const cardW = 155;
  const gap = 15;

  statCard(doc, 50, y, cardW, 74, 'OVERALL SCORE', `${report.overallScore}%`, riskColor);
  statCard(doc, 50 + cardW + gap, y, cardW, 74, 'RISK LEVEL', report.riskLabel, riskColor);
  statCard(
    doc,
    50 + (cardW + gap) * 2,
    y,
    cardW,
    74,
    'ASSESSMENTS',
    report.assessmentCount,
    INK,
    report.trend === null
      ? 'First reporting period'
      : `${report.trend >= 0 ? '+' : ''}${report.trend} pts vs last month`
  );
  y += 74 + 24;

  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text('Summary', 50, y);
  y += 20;
  doc.fillColor(MUTED).fontSize(9.5).font('Helvetica').text(report.summary, 50, y, { width: 495 });
  y = doc.y + 22;

  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text('Module averages', 50, y);
  y += 22;
  const moduleColors = { voice: BRAND, face: '#16A34A', hand: '#F59E0B', gait: '#2563EB' };
  for (const key of ['voice', 'face', 'hand', 'gait']) {
    y = scoreBar(doc, 50, y, 495, MODULE_LABELS[key], report.moduleAverages?.[key] ?? null, moduleColors[key]);
  }
  y += 12;

  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text('Score trend', 50, y);
  y += 20;
  y = sparkline(doc, 50, y, 495, 130, report.series) + 24;

  recommendationsBlock(doc, y, report.recommendations);

  stampFooters(doc);
  doc.end();
  return doc;
}

/** Single-assessment PDF, including the per-indicator breakdown. */
export function buildAssessmentPDF(user, assessment) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

  let y = header(
    doc,
    'AI Analysis Result',
    `${fmtDate(assessment.completedAt)} · ${user.fullName}`
  );

  const riskColor = RISK_COLORS[assessment.riskLevel] || INK;
  const cardW = 155;
  const gap = 15;

  statCard(doc, 50, y, cardW, 74, 'OVERALL SCORE', `${assessment.overallScore}%`, riskColor);
  statCard(doc, 50 + cardW + gap, y, cardW, 74, 'RISK LEVEL', assessment.riskLabel, riskColor);
  statCard(
    doc,
    50 + (cardW + gap) * 2,
    y,
    cardW,
    74,
    'CHANGE',
    assessment.delta === null ? 'Baseline' : `${assessment.delta >= 0 ? '+' : ''}${assessment.delta} pts`,
    assessment.delta === null ? INK : assessment.delta >= 0 ? RISK_COLORS.low : RISK_COLORS.high,
    'vs previous assessment'
  );
  y += 74 + 24;

  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text('Module scores', 50, y);
  y += 22;
  const moduleColors = { voice: BRAND, face: '#16A34A', hand: '#F59E0B', gait: '#2563EB' };
  for (const key of ['voice', 'face', 'hand', 'gait']) {
    const m = assessment[key];
    y = scoreBar(doc, 50, y, 495, MODULE_LABELS[key], m?.completed ? m.score : null, moduleColors[key]);
  }
  y += 14;

  // Per-indicator detail, module by module.
  for (const key of ['voice', 'face', 'hand', 'gait']) {
    const m = assessment[key];
    if (!m?.completed || !m.indicators?.length) continue;

    if (y > CONTENT_BOTTOM - 60) {
      doc.addPage();
      y = 60;
    }

    doc.fillColor(INK).fontSize(11).font('Helvetica-Bold').text(`${MODULE_LABELS[key]} detail`, 50, y);
    y += 18;

    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Bold');
    doc.text('MEASURE', 50, y, { width: 200 });
    doc.text('VALUE', 255, y, { width: 70 });
    doc.text('TYPICAL', 330, y, { width: 110 });
    doc.text('STATUS', 450, y, { width: 95 });
    y += 12;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(0.7).stroke();
    y += 7;

    for (const ind of m.indicators) {
      if (y > CONTENT_BOTTOM) {
        doc.addPage();
        y = 60;
      }
      const statusColor =
        ind.status === 'normal' ? RISK_COLORS.low : ind.status === 'borderline' ? RISK_COLORS.mild : RISK_COLORS.high;

      doc.fillColor(INK).fontSize(8.5).font('Helvetica').text(ind.label, 50, y, { width: 200 });
      doc.text(ind.value === null ? '—' : `${ind.value}${ind.unit ? ` ${ind.unit}` : ''}`, 255, y, {
        width: 70,
      });
      doc.fillColor(MUTED).text(ind.normal || '—', 330, y, { width: 110 });
      doc
        .fillColor(statusColor)
        .font('Helvetica-Bold')
        .text(ind.status, 450, y, { width: 95 });
      y += 16;
    }
    y += 14;
  }

  if (y > CONTENT_BOTTOM - 80) {
    doc.addPage();
    y = 60;
  }
  recommendationsBlock(doc, y, assessment.recommendations);

  stampFooters(doc);
  doc.end();
  return doc;
}
