/**
 * PDFExportService — generates PRD and Architecture PDFs from stored feature data.
 *
 * Uses @react-pdf/renderer for server-side PDF generation.
 * Mermaid diagrams are rendered to SVG via mermaid-isomorphic (playwright-core + system Chromium).
 * Falls back to displaying Mermaid source text when Chromium is unavailable.
 */
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { DatabaseHandler } from '../DatabaseHandler.js';
import { PRDDocument, PRDDocumentProps, PRDStakeholderReview, PRDArtefact } from '../pdf-templates/PRDDocument.js';
import { ArchitectureDocument, ArchitectureDocumentProps, DiagramField, ArchArtefact } from '../pdf-templates/ArchitectureDocument.js';

const ROLE_ORDER = ['productDirector', 'architect', 'uiUxExpert', 'securityOfficer'] as const;
const ROLE_LABELS: Record<string, string> = {
  productDirector: 'Product Director',
  architect: 'Architect',
  uiUxExpert: 'UI/UX Expert',
  securityOfficer: 'Security Officer',
};

/**
 * Render a Mermaid diagram source string to a PNG buffer using mermaid-isomorphic.
 * Uses Playwright with system Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) when available.
 * Returns null and logs a warning if rendering fails (e.g. Chromium not installed).
 */
async function renderMermaidToPng(source: string): Promise<Buffer | null> {
  try {
    const { createMermaidRenderer } = await import('mermaid-isomorphic');
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const renderer = createMermaidRenderer(executablePath ? { launchOptions: { executablePath } } : {});
    const results = await renderer([source], { screenshot: true });
    const result = results[0];
    if (result.status === 'fulfilled' && result.value.screenshot) {
      return result.value.screenshot;
    }
    console.warn('[PDFExportService] Mermaid render rejected or no screenshot:', result.status === 'rejected' ? result.reason : 'no screenshot buffer');
    return null;
  } catch (err) {
    console.warn('[PDFExportService] Mermaid render unavailable (Chromium not installed?):', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Build a DiagramField from a raw Mermaid string.
 * Attempts PNG rendering via mermaid-isomorphic; falls back to source text display.
 */
async function buildDiagramField(source: string | undefined, caption: string): Promise<DiagramField> {
  if (!source || !source.trim()) {
    return { type: 'pending', caption };
  }
  const png = await renderMermaidToPng(source);
  if (png) {
    return { type: 'png', png: png.toString('base64'), caption };
  }
  return { type: 'mermaid', source, caption };
}

export class PDFExportService {
  constructor(private db: DatabaseHandler) {}

  /**
   * Generate a PRD PDF for the given feature.
   * Returns a Buffer containing the PDF bytes.
   */
  async generatePRDPdf(featureSlug: string, repoName: string): Promise<Buffer> {
    const exportDate = new Date().toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Fetch feature metadata
    const features = this.db.getAllFeatures(repoName);
    const feature = features.find((f) => f.featureSlug === featureSlug);
    if (!feature) throw new Error(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    // Fetch feature-level AC, test scenarios, clarifications
    const acceptanceCriteria = this.db.getFeatureAcceptanceCriteria(repoName, featureSlug);
    const testScenarios = this.db.getFeatureTestScenarios(repoName, featureSlug);
    const clarifications = this.db.getClarifications(repoName, featureSlug);

    // Load tasks with stakeholder reviews embedded
    const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);
    const tasks = taskFile.tasks;

    // Aggregate stakeholder review data across all tasks
    const reviewsByRole: Record<string, { decision: 'approved' | 'rejected' | 'pending'; notes: string[] }> = {};

    for (const task of tasks) {
      for (const role of ROLE_ORDER) {
        const review = task.stakeholderReview[role];
        if (!review) continue;
        if (!reviewsByRole[role]) {
          reviewsByRole[role] = { decision: 'pending', notes: [] };
        }
        if (review.approved) {
          reviewsByRole[role].decision = 'approved';
        } else if (reviewsByRole[role].decision !== 'approved') {
          reviewsByRole[role].decision = 'rejected';
        }
        if (review.notes && !reviewsByRole[role].notes.includes(review.notes)) {
          reviewsByRole[role].notes.push(review.notes);
        }
      }
    }

    const stakeholderReviews: PRDStakeholderReview[] = ROLE_ORDER
      .filter(role => reviewsByRole[role])
      .map(role => ({
        role: ROLE_LABELS[role],
        decision: reviewsByRole[role].decision,
        notes: reviewsByRole[role].notes.slice(0, 3).join('\n\n'),
      }));

    // Fetch supplementary artefacts — notes and api_contracts go into the PRD
    const allArtefacts = this.db.getFeatureArtefacts(repoName, featureSlug);
    const prdArtefacts: PRDArtefact[] = allArtefacts
      .filter(a => a.artefactType === 'note' || a.artefactType === 'api_contract')
      .map(a => ({ title: a.title.slice(0, 200), content: a.content.slice(0, 10000), type: a.artefactType as PRDArtefact['type'] }));

    const props: PRDDocumentProps = {
      featureName: feature.featureName || featureSlug,
      description: (feature.description || '').slice(0, 10000),
      intention: (feature.intention || '').slice(0, 2000),
      exportDate,
      acceptanceCriteria: (acceptanceCriteria || []).map((ac: any) => ({
        id: ac.criterionId || ac.id || '',
        criterion: (ac.criterion || '').slice(0, 500),
        priority: ac.priority || 'Could Have',
        verified: ac.verified || false,
      })),
      testScenarios: (testScenarios || []).map((ts: any) => ({
        id: ts.scenarioId || ts.id || '',
        title: (ts.title || '').slice(0, 200),
        description: (ts.description || '').slice(0, 1000),
        priority: ts.priority || 'P2',
        type: ts.automated === false ? 'manual' : 'automated',
      })),
      clarifications: (clarifications || []).map((c: any) => ({
        question: (c.question || '').slice(0, 500),
        answer: c.answer ? c.answer.slice(0, 2000) : undefined,
      })),
      stakeholderReviews,
      supplementaryArtefacts: prdArtefacts,
    };

    const element = React.createElement(PRDDocument, props);
    const buffer = await renderToBuffer(element as any);
    return Buffer.from(buffer);
  }

  /**
   * Generate an Architecture PDF for the given feature.
   * Returns a Buffer containing the PDF bytes.
   */
  async generateArchitecturePdf(featureSlug: string, repoName: string): Promise<Buffer> {
    const exportDate = new Date().toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Fetch feature metadata
    const features = this.db.getAllFeatures(repoName);
    const feature = features.find((f) => f.featureSlug === featureSlug);
    if (!feature) throw new Error(`Feature '${featureSlug}' not found in repo '${repoName}'`);

    // Load tasks with stakeholder reviews embedded
    const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);
    const tasks = taskFile.tasks;

    // Aggregate architect and security data across all tasks
    const architectData: {
      notes: string;
      technologyRecommendations: string[];
      designPatterns: string[];
      flowDiagram?: string;
      sequentialCallsDiagram?: string;
      apiContracts?: string;
      authDetails?: string;
    } = { notes: '', technologyRecommendations: [], designPatterns: [] };

    const securityData: {
      securityRequirements: string[];
      complianceNotes: string;
    } = { securityRequirements: [], complianceNotes: '' };

    for (const task of tasks) {
      const arch = task.stakeholderReview.architect;
      if (arch) {
        if (arch.notes && !architectData.notes) architectData.notes = arch.notes;
        if (arch.technologyRecommendations?.length) {
          architectData.technologyRecommendations = [
            ...new Set([...architectData.technologyRecommendations, ...arch.technologyRecommendations]),
          ];
        }
        if (arch.designPatterns?.length) {
          architectData.designPatterns = [
            ...new Set([...architectData.designPatterns, ...arch.designPatterns]),
          ];
        }
        if (arch.flowDiagram && !architectData.flowDiagram) architectData.flowDiagram = arch.flowDiagram;
        if (arch.sequentialCallsDiagram && !architectData.sequentialCallsDiagram) architectData.sequentialCallsDiagram = arch.sequentialCallsDiagram;
        if (arch.apiContracts && !architectData.apiContracts) architectData.apiContracts = arch.apiContracts;
        if (arch.authDetails && !architectData.authDetails) architectData.authDetails = arch.authDetails;
      }

      const sec = task.stakeholderReview.securityOfficer;
      if (sec) {
        if (sec.securityRequirements?.length) {
          securityData.securityRequirements = [
            ...new Set([...securityData.securityRequirements, ...sec.securityRequirements]),
          ];
        }
        if (sec.complianceNotes && !securityData.complianceNotes) securityData.complianceNotes = sec.complianceNotes;
      }
    }

    const [flowDiagram, sequentialCallsDiagram] = await Promise.all([
      buildDiagramField(architectData.flowDiagram, 'Figure 1: System Architecture Flow'),
      buildDiagramField(architectData.sequentialCallsDiagram, 'Figure 2: Sequential Calls'),
    ]);

    // Fetch supplementary artefacts — diagrams, api_contracts, and data_models go into Architecture
    const allArtefacts = this.db.getFeatureArtefacts(repoName, featureSlug);
    const archArtefacts: ArchArtefact[] = allArtefacts
      .filter(a => a.artefactType === 'diagram' || a.artefactType === 'api_contract' || a.artefactType === 'data_model')
      .map(a => ({ title: a.title.slice(0, 200), content: a.content.slice(0, 10000), type: a.artefactType as ArchArtefact['type'] }));

    const props: ArchitectureDocumentProps = {
      featureName: feature.featureName || featureSlug,
      description: (feature.description || '').slice(0, 10000),
      intention: (feature.intention || '').slice(0, 2000),
      exportDate,
      technologyRecommendations: architectData.technologyRecommendations,
      designPatterns: architectData.designPatterns,
      flowDiagram,
      sequentialCallsDiagram,
      apiContracts: (architectData.apiContracts || '').slice(0, 10000),
      authDetails: (architectData.authDetails || '').slice(0, 10000),
      securityRequirements: securityData.securityRequirements,
      complianceNotes: (securityData.complianceNotes || '').slice(0, 5000),
      architectNotes: (architectData.notes || '').slice(0, 5000),
      supplementaryArtefacts: archArtefacts,
    };

    const element = React.createElement(ArchitectureDocument, props);
    const buffer = await renderToBuffer(element as any);
    return Buffer.from(buffer);
  }
}
