import { shutdownTelemetry } from './telemetry'; // Must be first — patches Express/http before any other import
import 'dotenv/config';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';

import { loadConfig, validateConfig } from './config';
import { Logger, RedisService, DatabaseService } from './services';
import { createErrorHandler, createRequestLogger } from './middleware';
import { createHealthRoutes, createEventsRoutes, createSessionsRoutes, createTracesRoutes, createAnalyticsRoutes } from './routes';

const app: Express = express();
const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  console.error('Configuration error:', error);
  process.exit(1);
}

const logger = new Logger(config.logLevel);

// Service instances — populated during initialization
let redisService: RedisService | null = null;
let databaseService: DatabaseService | null = null;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(createRequestLogger(logger));

// Routes
app.use('/', createHealthRoutes());
app.use('/api/v1/sessions', createSessionsRoutes(() => databaseService, logger));
app.use(
  '/api/v1/events',
  createEventsRoutes(
    () => databaseService,
    () => redisService,
    logger
  )
);
app.use(
  '/api/v1/traces',
  createTracesRoutes(() => databaseService, logger)
);
app.use(
  '/api/v1/analytics',
  createAnalyticsRoutes(() => databaseService, logger)
);

// Error handling
const { errorHandler, notFoundHandler } = createErrorHandler(logger);
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    if (redisService) {
      try {
        await redisService.disconnect();
      } catch (error) {
        logger.error('Error closing Redis:', error);
      }
    }

    if (databaseService) {
      try {
        await databaseService.disconnect();
      } catch (error) {
        logger.error('Error closing database:', error);
      }
    }

    await shutdownTelemetry();
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown stalls
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
  redisService = new RedisService(logger);
  try {
    await redisService.initialize();
  } catch (error) {
    logger.warn('Redis initialization failed, continuing without it:', error);
    redisService = null;
  }

  databaseService = new DatabaseService(logger);
  try {
    await databaseService.initialize();
  } catch (error) {
    logger.warn('Database initialization failed, continuing without it:', error);
    databaseService = null;
  }

  logger.info(
    `Services: Redis=${!!redisService}, DB=${!!databaseService}`
  );
}

const server = app.listen(config.port, config.host, () => {
  void initializeServices().catch((error) => {
    logger.error('Fatal: service initialization failed:', error);
    process.exit(1);
  });

  logger.info(`Server running at http://${config.host}:${config.port}`);
  logger.info(`Health: http://localhost:${config.port}/health`);
  logger.info(`Traces: POST http://localhost:${config.port}/api/v1/traces`);
  logger.info(`Query:  GET  http://localhost:${config.port}/api/v1/sessions`);
});

export default app;
