/**
 * Task-related routes
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { wsManager } from '../../websocket.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

export function createTaskRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * GET /api/tasks?featureSlug=<slug>&repoName=<repo>
   * Get all tasks from a feature
   */
  router.get('/tasks', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug) throw new ValidationError('Feature slug is required');

    const summary = await reviewManager.getReviewSummary(repoName, featureSlug);
    res.json(summary);
  }));

  /**
   * POST /api/tasks
   * Add a task to a feature
   */
  router.post('/tasks', asyncHandler(async (req: Request, res: Response) => {
    const { featureSlug, task, repoName } = req.body;

    if (!featureSlug || !task) throw new ValidationError('Feature slug and task data are required');

    reviewManager['dbHandler'].addTask(featureSlug, task, repoName || 'default');
    wsManager.broadcast({
      type: 'task-status-changed',
      action: 'created',
      featureSlug,
      taskId: task.taskId || task.id,
      repoName: repoName || 'default',
      timestamp: Date.now(),
    });
    res.json({ success: true, message: 'Task added successfully' });
  }));

  /**
   * GET /api/task?featureSlug=<slug>&id=<taskId>&repoName=<repo>
   * Get detailed information about a specific task
   */
  router.get('/task', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const taskId = req.query.id as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug || !taskId) throw new ValidationError('Feature slug and task ID are required');

    const status = await reviewManager.getTaskStatus(repoName, featureSlug, taskId);
    res.json(status);
  }));

  /**
   * GET /api/task/full?featureSlug=<slug>&id=<taskId>&repoName=<repo>
   * Get full task object (with description, transitions, criteria, etc.)
   */
  router.get('/task/full', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const taskId = req.query.id as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug || !taskId) throw new ValidationError('Feature slug and task ID are required');

    const taskFile = await reviewManager['dbHandler'].loadByFeatureSlug(featureSlug, repoName);
    const task = taskFile.tasks.find((t: { taskId: string }) => t.taskId === taskId);

    if (!task) throw new NotFoundError(`Task not found: ${taskId}`);

    res.json(task);
  }));

  /**
   * PUT /api/tasks/:taskId
   * Update an existing task
   */
  router.put('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
    const { featureSlug, updates, repoName } = req.body;
    const taskId = req.params.taskId as string;

    if (!featureSlug || !updates) throw new ValidationError('Feature slug and updates are required');

    const result = await reviewManager.updateTask({
      repoName: repoName || 'default',
      featureSlug,
      taskId,
      updates,
    });

    if (result.success) {
      wsManager.broadcast({
        type: 'task-status-changed',
        action: 'updated',
        featureSlug,
        taskId,
        repoName: repoName || 'default',
        newStatus: updates?.status,
        timestamp: Date.now(),
      });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  }));

  /**
   * DELETE /api/tasks/:taskId?featureSlug=<slug>&repoName=<repo>
   * Delete a task
   */
  router.delete('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';
    const taskId = req.params.taskId as string;

    if (!featureSlug) throw new ValidationError('Feature slug is required');

    const result = await reviewManager.deleteTask(repoName, featureSlug, taskId);

    if (result.success) {
      wsManager.broadcast({
        type: 'task-status-changed',
        action: 'deleted',
        featureSlug,
        taskId,
        repoName,
        timestamp: Date.now(),
      });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  }));

  /**
   * POST /api/tasks/:taskId/transition
   * Transition a task status — used by the inline quick-action buttons on task cards.
   * Security: 'system' actor is rejected from client requests per Security Officer review.
   */
  router.post('/tasks/:taskId/transition', asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const { featureSlug, repoName, fromStatus, toStatus, actor } = req.body;

    if (!featureSlug || !toStatus || !fromStatus) {
      throw new ValidationError('featureSlug, fromStatus, and toStatus are required');
    }

    // Reject privileged actor values from client-originated requests
    const allowedClientActors = ['developer', 'codeReviewer', 'qa'];
    const resolvedActor = allowedClientActors.includes(actor) ? actor : 'developer';

    const result = await reviewManager.transitionTaskStatus({
      repoName: repoName || 'default',
      featureSlug,
      taskId,
      fromStatus,
      toStatus,
      actor: resolvedActor,
    });

    if (result.success) {
      wsManager.broadcast({
        type: 'task-status-changed',
        action: 'transitioned',
        featureSlug,
        taskId,
        repoName: repoName || 'default',
        newStatus: toStatus,
        timestamp: Date.now(),
      });
      res.json(result);
    } else {
      // Return generic error — do not expose internal details (Security Officer AC)
      res.status(400).json({ success: false, message: 'Transition failed' });
    }
  }));

  /**
   * GET /api/tasks/by-status?featureSlug=<slug>&status=<status>&repoName=<repo>
   * Get tasks filtered by status
   */
  router.get('/tasks/by-status', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const status = req.query.status as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug || !status) throw new ValidationError('Feature slug and status are required');

    const result = await reviewManager.getTasksByStatus({
      repoName,
      featureSlug,
      status: status as any,
    });

    res.json(result);
  }));

  /**
   * GET /api/verify-complete?featureSlug=<slug>&repoName=<repo>
   * Check if all tasks are complete
   */
  router.get('/verify-complete', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug) throw new ValidationError('Feature slug is required');

    const result = await reviewManager.verifyAllTasksComplete({
      repoName,
      featureSlug,
    });

    res.json(result);
  }));

  return router;
}
