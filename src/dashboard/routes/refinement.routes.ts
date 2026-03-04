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

    const status = reviewManager.getRefinementStatusRecord(repoName, featureSlug);
    res.json({ success: true, ...status });
  }));

  /**
   * POST /api/refinement/steps
   * Create a refinement step for a feature
   */
  router.post('/steps', asyncHandler((req: Request, res: Response) => {
    const { repoName = 'default', featureSlug, stepNumber, completed, summary, data } = req.body;

    if (!featureSlug) throw new ValidationError('featureSlug is required');
    if (stepNumber === undefined) throw new ValidationError('stepNumber is required');
    if (completed === undefined) throw new ValidationError('completed is required');
    if (!summary) throw new ValidationError('summary is required');

    const result = reviewManager.updateRefinementStepRecord(
      repoName, featureSlug, stepNumber, completed, summary, data
    );

    res.status(201).json(result);
  }));

  /**
   * POST /api/refinement/criteria
   * Add feature-level acceptance criteria
   */
  router.post('/criteria', asyncHandler((req: Request, res: Response) => {
    const { repoName = 'default', featureSlug, criteria } = req.body;

    if (!featureSlug) throw new ValidationError('featureSlug is required');
    if (!criteria || !Array.isArray(criteria)) throw new ValidationError('criteria array is required');

    const count = reviewManager.addFeatureAcceptanceCriteriaRecord(
      repoName, featureSlug, criteria
    );

    res.status(201).json({
      success: true,
      repoName,
      featureSlug,
      criteriaAdded: count,
      message: `Added ${count} acceptance criteria to feature '${featureSlug}'`
    });
  }));

  /**
   * POST /api/refinement/scenarios
   * Add feature-level test scenarios
   */
  router.post('/scenarios', asyncHandler((req: Request, res: Response) => {
    const { repoName = 'default', featureSlug, scenarios } = req.body;

    if (!featureSlug) throw new ValidationError('featureSlug is required');
    if (!scenarios || !Array.isArray(scenarios)) throw new ValidationError('scenarios array is required');

    const count = reviewManager.addFeatureTestScenariosRecord(
      repoName, featureSlug, scenarios
    );

    res.status(201).json({
      success: true,
      repoName,
      featureSlug,
      scenariosAdded: count,
      message: `Added ${count} test scenarios to feature '${featureSlug}'`
    });
  }));

  /**
   * POST /api/refinement/clarifications
   * Add a clarification question
   */
  router.post('/clarifications', asyncHandler((req: Request, res: Response) => {
    const { repoName = 'default', featureSlug, question, answer, askedBy = 'llm' } = req.body;

    if (!featureSlug) throw new ValidationError('featureSlug is required');
    if (!question) throw new ValidationError('question is required');

    const result = reviewManager.addClarificationRecord(
      repoName, featureSlug, question, answer, askedBy as 'llm' | 'user' | undefined
    );

    res.status(201).json({
      success: true,
      repoName,
      featureSlug,
      clarificationId: result,
      message: `Added clarification question to feature '${featureSlug}'`
    });
  }));

  /**
   * POST /api/refinement/attachments
   * Add attachment analysis metadata
   */
  router.post('/attachments', asyncHandler((req: Request, res: Response) => {
    const {
      repoName = 'default',
      featureSlug,
      attachmentName,
      attachmentType,
      filePath,
      fileUrl,
      analysisSummary,
      extractedData
    } = req.body;

    if (!featureSlug) throw new ValidationError('featureSlug is required');
    if (!attachmentName) throw new ValidationError('attachmentName is required');
    if (!attachmentType) throw new ValidationError('attachmentType is required');
    if (!analysisSummary) throw new ValidationError('analysisSummary is required');

    const result = reviewManager.addAttachmentAnalysisRecord(
      repoName, featureSlug, attachmentName, attachmentType, analysisSummary, filePath, fileUrl, extractedData
    );

    res.status(201).json({
      success: true,
      repoName,
      featureSlug,
      attachmentId: result,
      message: `Added attachment analysis to feature '${featureSlug}'`
    });
  }));

  return router;
}
