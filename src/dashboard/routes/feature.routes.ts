/**
 * Feature-related routes
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { wsManager } from '../../websocket.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

export function createFeatureRoutes(reviewManager: AIConductor): Router {
  const router = Router();

  /**
   * GET /api/features?repoName=<repo>
   * Get all features for a repository
   */
  router.get('/features', asyncHandler((req: Request, res: Response) => {
    const repoName = (req.query.repoName as string) || 'default';
    const features = reviewManager.getAllFeatures(repoName);
    res.json({ success: true, features });
  }));

  /**
   * POST /api/features
   * Create a new feature
   */
  router.post('/features', asyncHandler(async (req: Request, res: Response) => {
    const { featureSlug, featureName, repoName } = req.body;

    if (!featureSlug || !featureName) throw new ValidationError('Feature slug and name are required');

    reviewManager.createFeatureRecord(featureSlug, featureName, repoName || 'default');
    wsManager.broadcast({
      type: 'feature-changed',
      action: 'created',
      featureSlug,
      repoName: repoName || 'default',
      timestamp: Date.now(),
    });
    res.json({ success: true, message: 'Feature created successfully' });
  }));

  /**
   * POST /api/features/:repoName/:featureSlug/reset-dev
   * Reset all tasks in a feature to ReadyForDevelopment so the dev-workflow
   * can be re-run after post-release fixes.
   */
  router.post('/features/:repoName/:featureSlug/reset-dev', asyncHandler(async (req: Request, res: Response) => {
    const repoName = req.params.repoName as string;
    const featureSlug = req.params.featureSlug as string;

    // Security: validate path params (alphanumeric + hyphens/underscores only, max 100 chars)
    const slugPattern = /^[a-zA-Z0-9_-]{1,100}$/;
    if (!slugPattern.test(repoName) || !slugPattern.test(featureSlug)) {
      throw new ValidationError('Invalid characters in repo name or feature slug');
    }

    // 404 guard — verify feature exists before attempting bulk transition
    const features = reviewManager.getAllFeatures(repoName);
    const feature = features.find((f: any) => f.featureSlug === featureSlug);
    if (!feature) {
      throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);
    }

    const result = await reviewManager.resetDevWorkflow(repoName, featureSlug);

    wsManager.broadcast({
      type: 'task-status-changed',
      action: 'reset-dev',
      featureSlug,
      repoName,
      timestamp: Date.now(),
    });

    res.json({ success: true, tasksReset: result.tasksReset });
  }));

  /**
   * GET /api/features/:featureSlug/snapshot?repoName=<repo>
   * Compressed workflow snapshot: blocked tasks, next role, high-rework items, recommendations.
   * Used by the WhatNextBanner component in the dashboard.
   * MUST come before the wildcard :featureSlug route.
   */
  router.get('/features/:featureSlug/snapshot', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    // Allowlist validation to prevent path traversal / SQL injection (Security Officer AC)
    const slugPattern = /^[a-zA-Z0-9_-]+$/;
    if (!slugPattern.test(featureSlug) || !slugPattern.test(repoName)) {
      throw new ValidationError('Invalid characters in feature slug or repo name');
    }

    const result = await reviewManager.getWorkflowSnapshot(repoName, featureSlug);

    if (!result.success) {
      throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);
    }

    // Map statuses to human-readable role labels (UX Expert requirement)
    const statusToRoleLabel: Record<string, string> = {
      PendingProductDirector: 'Product Director',
      PendingArchitect: 'Architect',
      PendingUiUxExpert: 'UI/UX Expert',
      PendingSecurityOfficer: 'Security Officer',
      InReview: 'Code Reviewer',
      InQA: 'QA Engineer',
    };

    const enrichedBlockages = (result.blockages || []).map((b: any) => ({
      ...b,
      roleLabel: statusToRoleLabel[b.status] ?? b.status,
    }));

    res.json({ ...result, blockages: enrichedBlockages });
  }));

  /**
   * GET /api/features/:featureSlug/details?repoName=<repo>
   * Get feature details including AC, test scenarios, refinement steps, clarifications
   * MUST come before the wildcard :featureSlug route
   */
  router.get('/features/:featureSlug/details', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    const acceptanceCriteria = reviewManager.getFeatureAcceptanceCriteria(repoName, featureSlug);
    const testScenarios = reviewManager.getFeatureTestScenarios(repoName, featureSlug);
    const refinementSteps = reviewManager.getRefinementSteps(repoName, featureSlug);
    const clarifications = reviewManager.getClarifications(repoName, featureSlug);
    const attachments = reviewManager.getAttachments(repoName, featureSlug);
    const refinementStatus = reviewManager.getRefinementStatusRecord(repoName, featureSlug);

    const features = reviewManager.getAllFeatures(repoName);
    const feature = features.find((f: any) => f.featureSlug === featureSlug);

    if (!feature) throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    res.json({
      success: true,
      feature: {
        featureSlug: feature.featureSlug,
        featureName: feature.featureName,
        description: feature.description || '',
        intention: feature.intention || '',
        lastModified: feature.lastModified,
        totalTasks: feature.totalTasks,
      },
      acceptanceCriteria,
      testScenarios,
      refinementSteps,
      clarifications,
      attachments: attachments || [],
      refinementStatus,
    });
  }));

  /**
   * GET /api/features/:featureSlug?repoName=<repo>
   * Get a specific feature by slug
   */
  router.get('/features/:featureSlug', asyncHandler((req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    const features = reviewManager.getAllFeatures(repoName);
    const feature = features.find((f: any) => f.featureSlug === featureSlug);

    if (!feature) throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    res.json({
      success: true,
      featureSlug: feature.featureSlug,
      title: feature.featureName,
      description: feature.description || '',
      intention: feature.intention || '',
      repoName: repoName,
      createdAt: feature.lastModified || new Date().toISOString(),
      totalTasks: feature.totalTasks || 0,
    });
  }));

  /**
   * DELETE /api/features/:featureSlug?repoName=<repo>
   * Delete a feature
   */
  router.delete('/features/:featureSlug', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    reviewManager.deleteFeatureRecord(featureSlug, repoName);
    wsManager.broadcast({
      type: 'feature-changed',
      action: 'deleted',
      featureSlug,
      repoName,
      timestamp: Date.now(),
    });
    res.json({ success: true, message: 'Feature deleted successfully' });
  }));

  return router;
}
