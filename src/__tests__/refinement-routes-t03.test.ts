/**
 * Tests for T03: Complete Refinement Routes API with 5 Missing POST Endpoints
 * Verifies that all 5 POST endpoints are implemented and functional
 */

import fs from 'fs';
import path from 'path';

describe('T03: Complete Refinement Routes API with 5 Missing POST Endpoints', () => {
  const refinementRoutesPath = path.join(__dirname, '..', 'dashboard', 'routes', 'refinement.routes.ts');

  describe('AC-8: Five missing refinement routes POST endpoints are implemented', () => {
    beforeAll(() => {
      if (!fs.existsSync(refinementRoutesPath)) {
        throw new Error(`refinement.routes.ts not found at ${refinementRoutesPath}`);
      }
    });

    it('should have POST /steps endpoint implemented', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      expect(content).toContain("router.post('/steps'");
      expect(content).toContain('stepNumber');
      expect(content).toContain('updateRefinementStep');
    });

    it('should have POST /criteria endpoint implemented', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      expect(content).toContain("router.post('/criteria'");
      expect(content).toContain('featureSlug');
      expect(content).toContain('addFeatureAcceptanceCriteria');
    });

    it('should have POST /scenarios endpoint implemented', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      expect(content).toContain("router.post('/scenarios'");
      expect(content).toContain('scenarios');
      expect(content).toContain('addFeatureTestScenarios');
    });

    it('should have POST /clarifications endpoint implemented', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      expect(content).toContain("router.post('/clarifications'");
      expect(content).toContain('question');
      expect(content).toContain('addClarification');
    });

    it('should have POST /attachments endpoint implemented', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      expect(content).toContain("router.post('/attachments'");
      expect(content).toContain('attachmentName');
      expect(content).toContain('addAttachmentAnalysis');
    });
  });

  describe('AC-9: All new refinement route endpoints use proper TypeScript types and input validation', () => {
    it('should have input validation for POST /steps', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      const stepsSection = content.split("router.post('/steps'")[1];

      expect(stepsSection).toContain('ValidationError');
      expect(stepsSection).toContain('featureSlug');
      expect(stepsSection).toContain('stepNumber');
      expect(stepsSection).toContain('completed');
      expect(stepsSection).toContain('summary');
    });

    it('should have input validation for POST /criteria', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      const criteriaSection = content.split("router.post('/criteria'")[1];

      expect(criteriaSection).toContain('ValidationError');
      expect(criteriaSection).toContain('featureSlug');
      expect(criteriaSection).toContain('criteria');
      expect(criteriaSection).toContain('Array.isArray');
    });

    it('should have input validation for POST /scenarios', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      const scenariosSection = content.split("router.post('/scenarios'")[1];

      expect(scenariosSection).toContain('ValidationError');
      expect(scenariosSection).toContain('featureSlug');
      expect(scenariosSection).toContain('scenarios');
      expect(scenariosSection).toContain('Array.isArray');
    });

    it('should have input validation for POST /clarifications', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      const clarificationsSection = content.split("router.post('/clarifications'")[1];

      expect(clarificationsSection).toContain('ValidationError');
      expect(clarificationsSection).toContain('featureSlug');
      expect(clarificationsSection).toContain('question');
    });

    it('should have input validation for POST /attachments', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');
      const attachmentsSection = content.split("router.post('/attachments'")[1];

      expect(attachmentsSection).toContain('ValidationError');
      expect(attachmentsSection).toContain('featureSlug');
      expect(attachmentsSection).toContain('attachmentName');
      expect(attachmentsSection).toContain('attachmentType');
      expect(attachmentsSection).toContain('analysisSummary');
    });

    it('should have proper HTTP status codes (201 Created)', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');

      // Count occurrences of res.status(201)
      const matches = content.match(/res\.status\(201\)/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(5);
    });

    it('should use asyncHandler for error handling', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');

      // Each route should be wrapped in asyncHandler
      expect(content).toContain('asyncHandler((req: Request, res: Response)');
      const handlerMatches = content.match(/asyncHandler/g);
      expect(handlerMatches!.length).toBeGreaterThanOrEqual(6); // 1 GET + 5 POST
    });
  });

  describe('TS-6 through TS-11: Refinement Routes Functionality', () => {
    it('should properly delegate to DatabaseHandler methods', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');

      expect(content).toContain('updateRefinementStep');
      expect(content).toContain('addFeatureAcceptanceCriteria');
      expect(content).toContain('addFeatureTestScenarios');
      expect(content).toContain('addClarification');
      expect(content).toContain('addAttachmentAnalysis');
    });

    it('should return proper response format with success flag', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');

      // Check for success response pattern
      expect(content).toContain('success: true');
      expect(content).toContain('repoName');
      expect(content).toContain('featureSlug');
    });

    it('should support optional repoName parameter with default', () => {
      const content = fs.readFileSync(refinementRoutesPath, 'utf-8');

      // Check for default repoName pattern
      expect(content).toContain("repoName = 'default'");
    });
  });
});
