import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import env from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import assessmentRoutes from './routes/assessment.routes.js';
import reportRoutes from './routes/report.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: [env.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    })
  );

  // Feature vectors are small JSON objects, but landmark traces can be chatty.
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!env.isProd) app.use(morgan('dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please slow down.' },
    })
  );

  app.get('/api/health', (req, res) =>
    res.json({ success: true, service: 'neurotrackai-api', time: new Date().toISOString() })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/assessments', assessmentRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
