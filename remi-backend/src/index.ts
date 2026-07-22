import { shutdownTelemetry } from './telemetry'; // Must be first — patches Express/http before any other import
import 'dotenv/config';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';

import { loadConfig, validateConfig } from './config';
import { Logger, DatabaseService, ClickHouseService } from './services';
import { createErrorHandler, createRequestLogger, createRequireApiKey } from './middleware';
import { createHealthRoutes, createEventsRoutes, createSessionsRoutes, createAnalyticsRoutes, createAdminRoutes } from './routes';

const app: Express = express();
const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  console.error('Configuration error:', error);
  process.exit(1);
}

const logger = new Logger(config.logLevel);

let databaseService: DatabaseService | null = null;
let clickhouseService: ClickHouseService | null = null;

const requireApiKey = createRequireApiKey(() => databaseService);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(createRequestLogger(logger));

app.use('/', createHealthRoutes());
app.use('/api/v1/sessions', createSessionsRoutes(() => clickhouseService, () => databaseService, requireApiKey, logger));
app.use('/api/v1/events', createEventsRoutes(() => clickhouseService, () => databaseService, requireApiKey, logger));
app.use('/api/v1/analytics', createAnalyticsRoutes(() => clickhouseService, requireApiKey, logger));
app.use('/api/v1/admin', createAdminRoutes(() => databaseService, requireApiKey, logger));

const { errorHandler, notFoundHandler } = createErrorHandler(logger);
app.use(notFoundHandler);
app.use(errorHandler);

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await Promise.allSettled([
      databaseService?.disconnect(),
      clickhouseService?.disconnect(),
    ]);
    await shutdownTelemetry();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection:', reason));
process.on('uncaughtException', (err) => { logger.error('Uncaught exception:', err); process.exit(1); });

async function initializeServices(): Promise<void> {
  databaseService = new DatabaseService(logger);
  clickhouseService = new ClickHouseService(config.clickhouse, logger);

  const results = await Promise.allSettled([
    databaseService.initialize(),
    clickhouseService.initialize(),
  ]);

  if (results[0]?.status === 'rejected') {
    logger.warn('PostgreSQL initialization failed:', results[0].reason);
    databaseService = null;
  }
  if (results[1]?.status === 'rejected') {
    logger.warn('ClickHouse initialization failed:', results[1].reason);
    clickhouseService = null;
  }

  logger.info(`Services: DB=${!!databaseService} CH=${!!clickhouseService}`);
}

const server = app.listen(config.port, config.host, () => {
  void initializeServices().catch((error) => {
    logger.error('Fatal: service initialization failed:', error);
    process.exit(1);
  });

  logger.info(`Server running at http://${config.host}:${config.port}`);
  logger.info(`Health: http://localhost:${config.port}/health`);
  logger.info(`Query:  GET  http://localhost:${config.port}/api/v1/sessions`);
});

export default app;
