import 'dotenv/config';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';

import { loadConfig, validateConfig } from './config';
import { Logger } from './services/logger';
import { BrowserService, AIService, ActionExecutor, ScreenshotService } from './services';
import { createErrorHandler, createRequestLogger } from './middleware';
import {
  createAgentRoutes,
  createPageRoutes,
  createScreenshotRoutes,
  createHealthRoutes,
} from './routes';

const app: Express = express();
const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  console.error('Configuration error:', error);
  process.exit(1);
}

const logger = new Logger(config.logLevel);
const browserService = BrowserService.getInstance(config.browser, logger);
const aiService = new AIService(config.openaiApiKey, logger);
const actionExecutor = new ActionExecutor(logger);
const screenshotService = new ScreenshotService(logger);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);

app.use(createRequestLogger(logger));

// Static files
app.use('/screenshots', express.static('screenshots'));

// Routes
app.use('/', createHealthRoutes());
app.use('/', createAgentRoutes(browserService, aiService, actionExecutor, logger));
app.use('/', createPageRoutes(browserService, logger));
app.use(
  '/',
  createScreenshotRoutes(browserService, screenshotService, logger, config.port)
);

// Error handling
const { errorHandler, notFoundHandler } = createErrorHandler(logger);
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);

  try {
    await browserService.shutdown();
    logger.info('Browser service shut down successfully');

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const server = app.listen(config.port, config.host, () => {
  logger.info(`🚀 Server running at http://${config.host}:${config.port}`);
  logger.info(`📱 Frontend: http://localhost:5173`);
  logger.info(`🔗 Health check: http://localhost:${config.port}/health`);
  // Warm up the browser on startup (non-blocking)
  browserService
    .initBrowser()
    .then(() => logger.info('🧊 Browser warm-up complete'))
    .catch(err => logger.error('Browser warm-up failed:', err));
});

export default app;

// Global error handlers for production robustness
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});
