/**
 * Refinement-related routes
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

export function createRefinementRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * GET /api/refinement-status?featureSlug=<slug>&repoName=<repo>
   * Get refinement progress for a feature
   */
  router.get('/refinement-status', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.query.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!featureSlug) throw new ValidationError('featureSlug is required');

    const status = reviewManager['dbHandler'].getRefinementStatus(repoName, featureSlug);
    res.json({ success: true, ...status });
  }));

  return router;
}
