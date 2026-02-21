/**
 * Queue API Routes — Endpoints for inspecting and managing the dev queue.
 *
 * T05: Dashboard API routes for queue and settings
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

export function createQueueRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  // ─── Queue Items ────────────────────────────────────────────────────

  /**
   * GET /api/queue
   * List queue items with optional filters:
   *   ?repoName=...&featureSlug=...&status=pending|running|completed|failed
   */
  router.get('/queue', asyncHandler((req: Request, res: Response) => {
    const { repoName, featureSlug, status } = req.query;
    const items = reviewManager.getQueueItems(
      repoName as string | undefined,
      featureSlug as string | undefined,
      status as string | undefined,
    );
    res.json({ success: true, items, total: items.length });
  }));

  /**
   * GET /api/queue/stats
   * Returns aggregate counts: pending, running, completed, failed, total.
   */
  router.get('/queue/stats', asyncHandler((_req: Request, res: Response) => {
    const stats = reviewManager.getQueueStats();
    res.json({ success: true, ...stats });
  }));

  /**
   * GET /api/queue/:id
   * Get a single queue item by ID.
   */
  router.get('/queue/:id', asyncHandler((req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid item ID: must be a positive integer');
    const item = reviewManager.getQueueItem(id);
    if (!item) throw new NotFoundError(`Queue item ${id} not found`);
    res.json({ success: true, item });
  }));

  /**
   * POST /api/queue/:id/reenqueue
   * Re-enqueue a failed queue item: reset to pending with retry_count=0.
   */
  router.post('/queue/:id/reenqueue', asyncHandler((req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid item ID: must be a positive integer');
    const result = reviewManager.reenqueueItem(id);
    if (!result.success) {
      const statusCode = result.error?.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, item: result.item });
  }));

  /**
   * DELETE /api/queue/:id
   * Cancel (remove) a pending queue item.
   */
  router.delete('/queue/:id', asyncHandler((req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid item ID: must be a positive integer');
    const result = reviewManager.cancelQueueItem(id);
    if (!result.success) {
      const statusCode = result.error?.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  }));

  /**
   * POST /api/queue/prune
   * Remove completed/failed items older than N days (default 7).
   * Body: { olderThanDays?: number }
   */
  router.post('/queue/prune', asyncHandler((req: Request, res: Response) => {
    const days = req.body?.olderThanDays;
    if (days !== undefined && (typeof days !== 'number' || days < 1)) {
      throw new ValidationError('olderThanDays must be a positive number');
    }
    const removed = reviewManager.pruneQueueItems(days);
    res.json({ success: true, removed });
  }));

  return router;
}
