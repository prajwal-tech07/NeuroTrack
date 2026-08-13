import env from './config/env.js';
import connectDB from './config/db.js';
import createApp from './app.js';
import startScheduler from './jobs/scheduler.js';

async function main() {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[api] NeuroTrackAI listening on http://localhost:${env.port} (${env.nodeEnv})`);
    console.log(`[api] allowing browser origin ${env.clientUrl}`);
  });

  startScheduler();

  const shutdown = (signal) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[api] unhandled rejection:', reason);
  });
}

main();
