import cron from 'node-cron';
import User from '../models/User.js';
import env from '../config/env.js';
import { sendWeeklyReminder, sendMonthlyReportEmail, mailEnabled } from '../services/mailer.js';
import { regenerateMonthlyReport } from '../services/reports.js';

/** Users whose next assessment is due today or overdue, and who want reminders. */
async function dueUsers() {
  return User.find({
    'settings.weeklyReminder': true,
    'settings.emailNotifications': true,
    $or: [{ nextAssessmentAt: { $lte: new Date() } }, { nextAssessmentAt: null }],
  }).limit(500);
}

export function startScheduler() {
  if (!env.enableCron) {
    console.log('[cron] disabled (ENABLE_CRON=false)');
    return;
  }

  // Weekly assessment reminders.
  cron.schedule(env.reminderCron, async () => {
    try {
      const users = await dueUsers();
      console.log(`[cron] weekly reminder -> ${users.length} user(s)`);
      for (const user of users) {
        await sendWeeklyReminder(user).catch((e) =>
          console.error('[cron] reminder failed for', user.email, e.message)
        );
      }
    } catch (err) {
      console.error('[cron] reminder job failed:', err.message);
    }
  });

  // Month-end report generation: 1st of each month at 02:00, covering the month just ended.
  cron.schedule('0 2 1 * *', async () => {
    try {
      const lastMonth = new Date();
      lastMonth.setDate(0); // last day of the previous month

      const users = await User.find({}).select('email fullName settings').limit(1000);
      console.log(`[cron] monthly reports -> ${users.length} user(s)`);

      for (const user of users) {
        const report = await regenerateMonthlyReport(user._id, lastMonth);
        if (report && user.settings?.emailNotifications && mailEnabled()) {
          await sendMonthlyReportEmail(user, report).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[cron] monthly report job failed:', err.message);
    }
  });

  console.log(
    `[cron] scheduled — reminders "${env.reminderCron}", monthly reports "0 2 1 * *"` +
      (mailEnabled() ? '' : ' (email delivery disabled, jobs still run)')
  );
}

export default startScheduler;
