/**
 * Repository-related routes
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { wsManager } from '../../websocket.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

export function createRepoRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * POST /api/repos
   * Register a new repository
   */
  router.post('/repos', asyncHandler(async (req: Request, res: Response) => {
    const { repoName, repoPath, repoUrl, defaultBranch } = req.body;

    if (!repoName || !repoPath) throw new ValidationError('repoName and repoPath are required');

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(repoName) && !/^[a-z0-9]$/.test(repoName)) {
      throw new ValidationError('repoName must match pattern [a-z0-9-]+ (lowercase alphanumeric and hyphens, no leading/trailing hyphens)');
    }

    if (/[;|&$`]/.test(repoPath)) {
      throw new ValidationError('repoPath must not contain shell metacharacters');
    }

    const result = await reviewManager.registerRepo({
      repoName,
      repoPath,
      repoUrl: repoUrl || undefined,
      defaultBranch: defaultBranch || undefined,
    });

    if (result.success) {
      wsManager.broadcast({
        type: 'repo-changed',
        action: 'created',
        repoName,
        timestamp: Date.now(),
      });
      res.status(201).json(result);
    } else {
      const isDuplicate = result.error && result.error.includes('UNIQUE constraint');
      res.status(isDuplicate ? 409 : 400).json(result);
    }
  }));

  /**
   * GET /api/repos
   * List all registered repositories
   */
  router.get('/repos', asyncHandler(async (_req: Request, res: Response) => {
    const result = await reviewManager.listRepos();
    const reposDict: Record<string, any> = {};
    if (result.success && result.repos) {
      result.repos.forEach(repo => {
        reposDict[repo.repoName] = {
          repoPath: repo.repoPath,
          featureCount: repo.featureCount,
          totalTasks: repo.totalTasks,
          completedTasks: repo.completedTasks,
          lastAccessedAt: repo.lastAccessedAt,
        };
      });
    }
    res.json(reposDict);
  }));

  /**
   * DELETE /api/repos/:repoName
   * Delete a repository and all associated features, tasks, and related data
   */
  router.delete('/repos/:repoName', asyncHandler(async (req: Request, res: Response) => {
    const repoName = req.params.repoName as string;

    if (!repoName || (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(repoName) && !/^[a-z0-9]$/.test(repoName))) {
      throw new ValidationError('Invalid repoName format');
    }

    const result = await reviewManager.deleteRepo(repoName);

    if (result.success) {
      wsManager.broadcast({
        type: 'repo-changed',
        action: 'deleted',
        repoName,
        timestamp: Date.now(),
      });
      res.json(result);
    } else if (result.error && result.error.includes('not found')) {
      res.status(404).json(result);
    } else {
      res.status(500).json(result);
    }
  }));

  return router;
}
