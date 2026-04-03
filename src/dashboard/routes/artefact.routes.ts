/**
 * Feature artefact routes — supplementary content added post-refinement.
 *
 * POST   /api/features/:featureSlug/artefacts          — add an artefact
 * GET    /api/features/:featureSlug/artefacts           — list artefacts (optional ?type= filter)
 * DELETE /api/features/:featureSlug/artefacts/:id       — delete an artefact
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const ALLOWED_TYPES = ['diagram', 'api_contract', 'data_model', 'note'] as const;

export function createArtefactRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * POST /api/features/:featureSlug/artefacts
   * Body: { repoName?, artefactType, title, content }
   */
  router.post('/features/:featureSlug/artefacts', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const { repoName = 'default', artefactType, title, content } = req.body;

    if (!SLUG_PATTERN.test(featureSlug)) throw new ValidationError('Invalid characters in feature slug');
    if (!SLUG_PATTERN.test(repoName)) throw new ValidationError('Invalid characters in repo name');
    if (!artefactType) throw new ValidationError('artefactType is required');
    if (!ALLOWED_TYPES.includes(artefactType)) {
      throw new ValidationError(`artefactType must be one of: ${ALLOWED_TYPES.join(', ')}`);
    }
    if (!title || typeof title !== 'string' || title.trim() === '') {
      throw new ValidationError('title is required');
    }
    if (!content || typeof content !== 'string') {
      throw new ValidationError('content is required');
    }

    const result = reviewManager.addFeatureArtefact(repoName, featureSlug, artefactType, title.trim(), content);
    res.status(201).json({ success: true, artefactId: result.artefactId });
  }));

  /**
   * GET /api/features/:featureSlug/artefacts?repoName=&type=
   */
  router.get('/features/:featureSlug/artefacts', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoNameRaw = req.query.repoName;
    const repoName = (typeof repoNameRaw === 'string' ? repoNameRaw : 'default') || 'default';
    const typeRaw = req.query.type;
    const type = typeof typeRaw === 'string' ? typeRaw : undefined;

    if (!SLUG_PATTERN.test(featureSlug)) throw new ValidationError('Invalid characters in feature slug');
    if (!SLUG_PATTERN.test(repoName)) throw new ValidationError('Invalid characters in repo name');
    if (type && !ALLOWED_TYPES.includes(type as any)) {
      throw new ValidationError(`type filter must be one of: ${ALLOWED_TYPES.join(', ')}`);
    }

    const artefacts = reviewManager.getFeatureArtefacts(repoName, featureSlug, type);
    res.json({ success: true, artefacts });
  }));

  /**
   * DELETE /api/features/:featureSlug/artefacts/:id?repoName=
   */
  router.delete('/features/:featureSlug/artefacts/:id', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoNameRaw = req.query.repoName;
    const repoName = (typeof repoNameRaw === 'string' ? repoNameRaw : 'default') || 'default';
    const id = parseInt(req.params.id as string, 10);

    if (!SLUG_PATTERN.test(featureSlug)) throw new ValidationError('Invalid characters in feature slug');
    if (!SLUG_PATTERN.test(repoName)) throw new ValidationError('Invalid characters in repo name');
    if (isNaN(id) || id < 1) throw new ValidationError('Artefact id must be a positive integer');

    const deleted = reviewManager.deleteFeatureArtefact(repoName, featureSlug, id);
    if (!deleted) throw new NotFoundError(`Artefact ${id} not found for feature '${featureSlug}'`);

    res.json({ success: true });
  }));

  return router;
}
