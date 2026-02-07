import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { closePool } from './db/client.js';
import { registerJobs } from './jobs/scheduler.js';

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
});

logger.info(`Expense API server started`, {
  port: env.PORT,
  environment: env.NODE_ENV,
});

// Start background jobs
registerJobs();

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    logger.info('HTTP server closed');
  });

  await closePool();

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});
