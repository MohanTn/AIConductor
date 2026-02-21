/**
 * Dashboard Server - Web interface for viewing task progress in real-time
 * Includes WebSocket server for real-time updates (T01)
 * Includes Cron Scanner and Queue Worker for automated dev (T07)
 */
import express from 'express';
import { AIConductor } from './AIConductor.js';
import { wsManager } from './websocket.js';
import { CronScanner } from './cron-scanner.js';
import { QueueWorker } from './queue-worker.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { createRepoRoutes } from './dashboard/routes/repo.routes.js';
import { createFeatureRoutes } from './dashboard/routes/feature.routes.js';
import { createTaskRoutes } from './dashboard/routes/task.routes.js';
import { createRefinementRoutes } from './dashboard/routes/refinement.routes.js';
import { createSettingsRoutes } from './dashboard/routes/settings.routes.js';
import { createQueueRoutes } from './dashboard/routes/queue.routes.js';
import { errorMiddleware } from './dashboard/middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Start the dashboard server
 * @param port Port number (default: 5111)
 * @returns Express app instance
 */
export function startDashboard(port: number = 5111) {
  const app = express();
  const PORT = process.env.PORT || port;

  // Initialize AIConductor
  const reviewManager = new AIConductor();

  // Middleware
  app.use(express.json());

  // Serve static files from Vite build output
  app.use(express.static(path.join(__dirname, 'client')));

  // API Route Modules
  app.use('/api', createRepoRoutes(reviewManager));
  app.use('/api', createFeatureRoutes(reviewManager));
  app.use('/api', createTaskRoutes(reviewManager));
  app.use('/api', createRefinementRoutes(reviewManager));
  app.use('/api', createSettingsRoutes(reviewManager));
  app.use('/api', createQueueRoutes(reviewManager));

  /**
   * Serve the dashboard HTML (for SPA routing)
   */
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      websocket: 'enabled',
      connections: wsManager.getConnectionCount(),
    });
  });

  // Internal broadcast endpoint — called by the MCP process (separate docker exec
  // process) to push task-change events to browser WebSocket clients held by this
  // process.  Intentionally bound to localhost only at the application level; it
  // should not be exposed publicly.
  app.post('/api/ws/broadcast', (req, res) => {
    const event = req.body;
    if (!event || typeof event !== 'object' || !event.type) {
      res.status(400).json({ error: 'Missing or invalid event body' });
      return;
    }
    wsManager.broadcast(event);
    res.json({ success: true, connections: wsManager.getConnectionCount() });
  });

  // Centralized error handling middleware — must be registered AFTER all routes
  app.use(errorMiddleware);

  // Create HTTP server to support both Express and WebSocket
  const httpServer = createServer(app);

  // Gracefully handle port conflicts: when the MCP exec process starts inside
  // the container alongside the already-running main dashboard process, port
  // 5111 is already taken.  In that case, skip the dashboard server — the MCP
  // process will instead POST task-change events to the main process via the
  // /api/ws/broadcast endpoint (see src/broadcast.ts).
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Dashboard] Port ${PORT} already in use — skipping dashboard startup. ` +
        `Task-change events will be forwarded to the running dashboard process.`
      );
      return; // Non-fatal: MCP broadcast will use HTTP POST to the main process
    }
    throw err; // Re-throw unexpected errors
  });

  // Initialize WebSocket server (T01)
  wsManager.initialize(httpServer);

  // ── Dev Queue: Cron Scanner + Worker (T07) ───────────────────────
  const cronScanner = new CronScanner(reviewManager);
  const queueWorker = new QueueWorker(reviewManager);

  // Auto-start if workerEnabled is already true in settings
  const queueSettings = reviewManager.getQueueSettings();
  if (queueSettings.workerEnabled) {
    cronScanner.start();
    queueWorker.start();
  }

  // Expose a method so the settings PUT route can toggle at runtime
  (app as any)._cronScanner = cronScanner;
  (app as any)._queueWorker = queueWorker;

  // Health check endpoint for queue status
  app.get('/api/queue/health', (_req, res) => {
    res.json({
      success: true,
      cronRunning: cronScanner.isRunning,
      workerRunning: queueWorker.isRunning,
      workerBusy: queueWorker.isBusy,
    });
  });

  // Note: Task status change events will be broadcast via WebSocket
  // when implemented in AIConductor (T04)

  // Start HTTP server
  httpServer.listen(PORT, () => {
    console.error(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   AIConductor Dashboard                                ║
║                                                                ║
║   🚀 Server running on http://localhost:${PORT}                   ║
║   🔌 WebSocket server on ws://localhost:${PORT}                   ║
║                                                                ║
║   API Endpoints:                                               ║
║   • GET /api/tasks?featureSlug=<slug>                          ║
║   • GET /api/task?featureSlug=<slug>&id=<taskId>               ║
║   • GET /api/tasks/by-status?featureSlug=<slug>&status=<...>   ║
║   • GET /api/verify-complete?featureSlug=<slug>                ║
║                                                                ║
║   WebSocket Events:                                            ║
║   • connection: Welcome message with connectionId              ║
║   • presence-update: User presence tracking                    ║
║   • task-status-changed: Real-time task updates                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  });

  // Expose servers on app for test cleanup
  (app as any)._server = httpServer;
  (app as any)._wsManager = wsManager;

  // ── Graceful shutdown (T07) ──────────────────────────────────────
  const gracefulShutdown = (signal: string) => {
    console.error(`\n[Dashboard] Received ${signal} — shutting down gracefully…`);
    queueWorker.stop();
    cronScanner.stop();
    wsManager.shutdown();
    httpServer.close(() => {
      console.error('[Dashboard] Server closed');
      process.exit(0);
    });
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('[Dashboard] Forced exit after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return app;
}

// Start dashboard if run directly
if (import.meta.url.endsWith('dashboard.js') || process.argv[1]?.endsWith('dashboard.js')) {
  startDashboard();
}
