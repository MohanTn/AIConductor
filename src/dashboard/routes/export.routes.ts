/**
 * Export routes — PDF download endpoints for PRD and Architecture documents.
 * GET /api/features/:featureSlug/export/prd?repoName=<repo>
 * GET /api/features/:featureSlug/export/architecture?repoName=<repo>
 */
import { Router, Request, Response } from 'express';
import { AIConductor } from '../../AIConductor.js';
import { PDFExportService } from '../../services/PDFExportService.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

/** Strip non-safe characters from a string for use in a Content-Disposition filename */
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').slice(0, 80);
}

/** ISO date suffix for filenames e.g. 2026-03-30 */
function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createExportRoutes(reviewManager: AIConductor): Router {
  const router = Router();
  const pdfService = new PDFExportService((reviewManager as any).db || (reviewManager as any).dbHandler);

  /**
   * GET /api/features/:featureSlug/export/prd?repoName=<repo>
   * Download PRD as PDF
   */
  router.get('/features/:featureSlug/export/prd', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!SLUG_PATTERN.test(featureSlug) || !SLUG_PATTERN.test(repoName)) {
      throw new ValidationError('Invalid characters in feature slug or repo name');
    }

    const features = reviewManager.getAllFeatures(repoName);
    const feature = features.find((f: any) => f.featureSlug === featureSlug);
    if (!feature) throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    const buffer = await pdfService.generatePRDPdf(featureSlug, repoName);
    const filename = `${safeFilename(feature.featureName || featureSlug)}-prd-${isoDate()}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  }));

  /**
   * GET /api/features/:featureSlug/export/architecture?repoName=<repo>
   * Download Architecture document as PDF
   */
  router.get('/features/:featureSlug/export/architecture', asyncHandler(async (req: Request, res: Response) => {
    const featureSlug = req.params.featureSlug as string;
    const repoName = (req.query.repoName as string) || 'default';

    if (!SLUG_PATTERN.test(featureSlug) || !SLUG_PATTERN.test(repoName)) {
      throw new ValidationError('Invalid characters in feature slug or repo name');
    }

    const features = reviewManager.getAllFeatures(repoName);
    const feature = features.find((f: any) => f.featureSlug === featureSlug);
    if (!feature) throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    const buffer = await pdfService.generateArchitecturePdf(featureSlug, repoName);
    const filename = `${safeFilename(feature.featureName || featureSlug)}-architecture-${isoDate()}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  }));

  return router;
}
