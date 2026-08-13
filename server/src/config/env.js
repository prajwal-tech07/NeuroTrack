import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${key}. Copy server/.env.example to server/.env and fill it in.`
    );
  }
  return value;
};

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/neurotrackai'),

  jwtSecret: required('JWT_SECRET', 'dev_only_insecure_secret_please_change_me_now'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev_only_insecure_refresh_secret_change_me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  assessmentIntervalDays: Number(process.env.ASSESSMENT_INTERVAL_DAYS || 7),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'NeuroTrackAI <no-reply@neurotrackai.local>',
  },

  reminderCron: process.env.REMINDER_CRON || '0 9 * * 1',
  enableCron: String(process.env.ENABLE_CRON || 'true') === 'true',
};

export default env;
