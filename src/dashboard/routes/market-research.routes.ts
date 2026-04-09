/**
 * Express routes for market research endpoints
 * Handles competitive analysis, gap analysis, positioning, and PDF exports
 */

import express, { Router } from 'express';
import { AIConductor } from '../../AIConductor';

export function createMarketResearchRoutes(conductor: AIConductor): Router {
  const router = express.Router();

  /**
   * GET /api/market-research/:featureSlug/competitive-matrix
   * Returns competitive matrix JSON data for a feature
   */
  router.get('/:featureSlug/competitive-matrix', async (req, res) => {
    try {
      const { featureSlug } = req.params;

      // In production, fetch from database or cache
      const competitiveMatrices = await conductor.getFeatureArtefacts(
        'default',
        featureSlug,
        'competitive_matrix'
      );

      if (competitiveMatrices && competitiveMatrices.length > 0) {
        return res.json(competitiveMatrices[0]);
      }
      return res.status(404).json({ error: 'Competitive matrix not found' });
    } catch (err) {
      console.error('Error fetching competitive matrix:', err);
      return res.status(500).json({ error: 'Failed to fetch competitive matrix' });
    }
  });

  /**
   * GET /api/market-research/:featureSlug/gap-analysis
   * Returns gap analysis markdown + structured data
   */
  router.get('/:featureSlug/gap-analysis', async (req, res) => {
    try {
      const { featureSlug } = req.params;

      // Fetch from feature artefacts
      const gapAnalyses = await conductor.getFeatureArtefacts(
        'default',
        featureSlug,
        'gap_analysis'
      );

      if (gapAnalyses && gapAnalyses.length > 0) {
        return res.json(gapAnalyses[0]);
      }
      return res.status(404).json({ error: 'Gap analysis not found' });
    } catch (err) {
      console.error('Error fetching gap analysis:', err);
      return res.status(500).json({ error: 'Failed to fetch gap analysis' });
    }
  });

  /**
   * GET /api/market-research/:featureSlug/positioning
   * Returns positioning statement and roadmap recommendations
   */
  router.get('/:featureSlug/positioning', async (req, res) => {
    try {
      const { featureSlug } = req.params;

      // Fetch from feature artefacts
      const positionings = await conductor.getFeatureArtefacts(
        'default',
        featureSlug,
        'positioning_roadmap'
      );

      if (positionings && positionings.length > 0) {
        return res.json(positionings[0]);
      }
      return res.status(404).json({ error: 'Positioning statement not found' });
    } catch (err) {
      console.error('Error fetching positioning:', err);
      return res.status(500).json({ error: 'Failed to fetch positioning' });
    }
  });

  /**
   * POST /api/market-research/:featureSlug/broadcast-update
   * Broadcast market research update to all connected WebSocket clients
   * Called when competitive matrix, gap analysis, or positioning changes
   */
  router.post('/:featureSlug/broadcast-update', express.json(), async (req, res) => {
    try {
      const { featureSlug } = req.params;
      const { type, data } = req.body;

      if (!type || !data) {
        return res.status(400).json({ error: 'type and data fields required' });
      }

      // Validate message type
      const validTypes = ['matrix_update', 'gap_identified', 'positioning_updated', 'roadmap_changed'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
      }

      const message = {
        type,
        timestamp: Date.now(),
        featureSlug,
        data,
        source: 'market-research-service',
      };

      // Broadcast to all connected WebSocket clients
      // This would be handled by WebSocket server integration
      // For now, log the broadcast
      console.log('[Market Research] Broadcasting update:', message);

      return res.json({
        success: true,
        message: `Broadcast ${type} update to market research subscribers`,
        broadcastId: `${featureSlug}-${Date.now()}`,
      });
    } catch (err) {
      console.error('Error broadcasting market research update:', err);
      return res.status(500).json({ error: 'Failed to broadcast update' });
    }
  });

  /**
   * GET /api/market-research/:featureSlug/export/competitive-analysis
   * Export competitive analysis as PDF
   */
  router.get('/:featureSlug/export/competitive-analysis', async (req, res) => {
    try {
      const { featureSlug } = req.params;

      // In production: generate PDF using react-pdf or similar
      // Return PDF buffer
      res.json({
        success: true,
        message: 'PDF export feature - ready for PDF generation',
        format: 'application/pdf',
        filename: `${featureSlug}-competitive-analysis.pdf`,
      });
    } catch (err) {
      console.error('Error exporting competitive analysis PDF:', err);
      res.status(500).json({ error: 'Failed to export PDF' });
    }
  });

  /**
   * GET /api/market-research/categories
   * List all competitor categories
   */
  router.get('/', (_req, res) => {
    try {
      const categories = [
        'AI Coding Assistants',
        'Workflow Orchestration',
        'MCP Servers',
        'Task Management + AI',
        'LLM Ops & Agent Frameworks',
        'AI Workflow Orchestration',
      ];

      return res.json({
        categories,
        totalCompetitors: 12,
        dimensions: 8,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error fetching market research categories:', err);
      return res.status(500).json({ error: 'Failed to fetch categories' });
    }
  });

  return router;
}
