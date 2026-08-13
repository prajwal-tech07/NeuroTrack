import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transporter = null;

/** Returns a transporter, or null when SMTP is not configured (email is optional). */
function getTransporter() {
  if (!env.smtp.host) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

export const mailEnabled = () => Boolean(env.smtp.host);

async function send({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[mail] skipped (SMTP not configured) -> ${to}: ${subject}`);
    return { skipped: true };
  }
  const info = await tx.sendMail({ from: env.smtp.from, to, subject, html, text });
  console.log(`[mail] sent ${info.messageId} -> ${to}`);
  return info;
}

const shell = (title, body, cta) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#F5F6FA;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px">
    <div style="color:#5B2BD9;font-weight:700;font-size:20px;margin-bottom:4px">NeuroTrackAI</div>
    <div style="color:#6B7280;font-size:12px;margin-bottom:24px">AI-powered neurological screening</div>
    <h1 style="color:#1E1B33;font-size:20px;margin:0 0 12px">${title}</h1>
    <div style="color:#4B5563;font-size:14px;line-height:1.6">${body}</div>
    ${
      cta
        ? `<a href="${cta.url}" style="display:inline-block;margin-top:24px;background:#5B2BD9;color:#fff;
             text-decoration:none;padding:12px 24px;border-radius:9px;font-weight:600;font-size:14px">${cta.label}</a>`
        : ''
    }
    <div style="color:#9CA3AF;font-size:11px;margin-top:28px;border-top:1px solid #E5E7EB;padding-top:16px">
      NeuroTrackAI is a screening aid, not a diagnostic tool. You can turn these emails off in Settings.
    </div>
  </div>
</div>`;

export function sendWeeklyReminder(user) {
  return send({
    to: user.email,
    subject: 'Your weekly NeuroTrackAI assessment is ready',
    text: `Hi ${user.fullName}, your weekly assessment is due. Sign in at ${env.clientUrl} to complete it.`,
    html: shell(
      `Hi ${user.fullName.split(' ')[0]}, your weekly check-in is due`,
      `<p>Your next assessment window is open. It takes about five minutes and covers voice, face, hand movement and gait.</p>
       <p>Consistency is what makes the trend meaningful, so try to test at roughly the same time of day each week.</p>`,
      { url: `${env.clientUrl}/assessment`, label: 'Start assessment' }
    ),
  });
}

export function sendMonthlyReportEmail(user, report) {
  return send({
    to: user.email,
    subject: `Your ${report.periodLabel} NeuroTrackAI report is ready`,
    text: `Your ${report.periodLabel} report: ${report.overallScore}% (${report.riskLabel}).`,
    html: shell(
      `Your ${report.periodLabel} report is ready`,
      `<p><strong>Overall score:</strong> ${report.overallScore}% &middot; <strong>${report.riskLabel}</strong></p>
       <p>${report.summary}</p>`,
      { url: `${env.clientUrl}/reports`, label: 'View report' }
    ),
  });
}

export function sendPasswordResetEmail(user, resetUrl) {
  return send({
    to: user.email,
    subject: 'Reset your NeuroTrackAI password',
    text: `Reset your password: ${resetUrl}`,
    html: shell(
      'Reset your password',
      `<p>Use the button below to choose a new password. The link expires shortly.</p>
       <p>If you did not request this, you can safely ignore this email.</p>`,
      { url: resetUrl, label: 'Reset password' }
    ),
  });
}

export default { sendWeeklyReminder, sendMonthlyReportEmail, sendPasswordResetEmail, mailEnabled };
