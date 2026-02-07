import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import {
  generateDailyInsights,
  detectAnomalies,
  refreshMaterializedViews,
} from '../services/insight.service.js';

/**
 * Register all background cron jobs.
 * Called once on app startup.
 */
export function registerJobs(): void {
  // Refresh materialized views every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Job started: refreshMaterializedViews');
    try {
      await refreshMaterializedViews();
      logger.info('Job completed: refreshMaterializedViews');
    } catch (error) {
      logger.error('Job failed: refreshMaterializedViews', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Detect anomalies every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.info('Job started: detectAnomalies');
    try {
      const count = await detectAnomalies();
      logger.info('Job completed: detectAnomalies', { detected: count });
    } catch (error) {
      logger.error('Job failed: detectAnomalies', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Generate daily insights at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('Job started: generateDailyInsights');
    try {
      const count = await generateDailyInsights();
      logger.info('Job completed: generateDailyInsights', { generated: count });
    } catch (error) {
      logger.error('Job failed: generateDailyInsights', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.info('Background jobs registered', {
    jobs: [
      'refreshMaterializedViews (hourly)',
      'detectAnomalies (every 6h)',
      'generateDailyInsights (daily 2:00 AM)',
    ],
  });
}
