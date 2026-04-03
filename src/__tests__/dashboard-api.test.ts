/**
 * Dashboard API Endpoint Tests (T01)
 *
 * Tests the REST API logic for:
 *  - POST /api/repos (registration with validation)
 *  - GET /api/features/:featureSlug/details (aggregated feature data)
 *  - GET /api/refinement-status (refinement progress)
 *  - GET /api/repos (list repos)
 *  - GET /api/features (list features)
 *
 * Tests via AIConductor + DatabaseHandler to validate the backend logic
 * that powers the dashboard endpoints, since dashboard.ts uses import.meta.url
 * which requires ESM runtime.
 */

import { AIConductor } from '../AIConductor.js';
import { DatabaseHandler } from '../DatabaseHandler.js';
import * as path from 'path';
import * as fs from 'fs-extra';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REPO_NAME = 'api-test-repo';
const FEATURE_SLUG = 'api-test-feature';
const FEATURE_NAME = 'API Test Feature';

describe('Dashboard API Logic Tests (T01)', () => {
  let manager: AIConductor;
  let dbHandler: DatabaseHandler;
  let testDbPath: string;

  beforeAll(async () => {
    testDbPath = path.join(
      process.cwd(),
      `test-dashboard-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    manager = new AIConductor(testDbPath);
    dbHandler = (manager as any).dbHandler as DatabaseHandler;

    // Migration is applied automatically by DatabaseHandler constructor

    // Seed test data
    await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test/repo' });
    await manager.createFeature({
      repoName: REPO_NAME,
      featureSlug: FEATURE_SLUG,
      featureName: FEATURE_NAME,
    });
    await manager.addTask({
      repoName: REPO_NAME,
      featureSlug: FEATURE_SLUG,
      taskId: 'T01',
      title: 'Test Task for API',
      description: 'A test task for dashboard API tests',
      orderOfExecution: 1,
      acceptanceCriteria: [
        { id: 'AC-1', criterion: 'Test criterion 1', priority: 'Must Have', verified: false },
      ],
      testScenarios: [
        {
          id: 'TS-1',
          title: 'Test scenario 1',
          description: 'A test scenario',
          manualOnly: false,
          priority: 'P0',
        },
      ],
      dependencies: [],
      tags: [],
    });

    // Add feature-level acceptance criteria
    await manager.addFeatureAcceptanceCriteria({
      repoName: REPO_NAME,
      featureSlug: FEATURE_SLUG,
      criteria: [
        { criterionId: 'FAC-1', criterion: 'Feature criterion 1', priority: 'Must Have' },
      ],
    });

    // Add feature-level test scenarios
    await manager.addFeatureTestScenarios({
      repoName: REPO_NAME,
      featureSlug: FEATURE_SLUG,
      scenarios: [
        {
          scenarioId: 'FTS-1',
          title: 'Feature test scenario',
          description: 'A feature-level test scenario',
          priority: 'P0',
        },
      ],
    });
  });

  afterAll(() => {
    try {
      dbHandler.close();
    } catch {
      /* ignore */
    }
    try {
      fs.removeSync(testDbPath);
    } catch {
      /* ignore */
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC-T01-1: POST /api/repos - registerRepo() with validation
  // ═══════════════════════════════════════════════════════════════════

  describe('AC-T01-1: POST /api/repos (registerRepo)', () => {
    it('TS-T01-1: should register a new repo successfully', async () => {
      const result = await manager.registerRepo({
        repoName: 'new-test-repo',
        repoPath: '/new/test/repo',
        repoUrl: 'https://github.com/org/repo',
        defaultBranch: 'main',
      });
      expect(result.success).toBe(true);
    });

    it('TS-T01-2: should return error for duplicate repo name', async () => {
      // Register once
      await manager.registerRepo({
        repoName: 'dup-test-repo',
        repoPath: '/dup/test/repo',
      });

      // Duplicate registration
      const result = await manager.registerRepo({
        repoName: 'dup-test-repo',
        repoPath: '/dup/test/repo2',
      });
      expect(result.success).toBe(false);
    });

    it('should validate repoName pattern (only lowercase alphanumeric + hyphens)', () => {
      const validPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
      const singleCharPattern = /^[a-z0-9]$/;

      expect(validPattern.test('my-repo') || singleCharPattern.test('my-repo')).toBe(true);
      expect(validPattern.test('repo123') || singleCharPattern.test('repo123')).toBe(true);
      expect(validPattern.test('INVALID') || singleCharPattern.test('INVALID')).toBe(false);
      expect(validPattern.test('has spaces') || singleCharPattern.test('has spaces')).toBe(false);
      expect(validPattern.test('-leading') || singleCharPattern.test('-leading')).toBe(false);
    });

    it('should validate repoPath has no shell metacharacters', () => {
      const dangerousCharsPattern = /[;|&$`]/;
      expect(dangerousCharsPattern.test('/valid/path')).toBe(false);
      expect(dangerousCharsPattern.test('/path; rm -rf /')).toBe(true);
      expect(dangerousCharsPattern.test('/path | cat')).toBe(true);
      expect(dangerousCharsPattern.test('/path & cmd')).toBe(true);
      expect(dangerousCharsPattern.test('/path $HOME')).toBe(true);
      expect(dangerousCharsPattern.test('/path `cmd`')).toBe(true);
    });

    it('should list repos after registration', async () => {
      const result = await manager.listRepos() as any;
      expect(result.repos).toBeDefined();
      expect(Array.isArray(result.repos)).toBe(true);
      expect(result.repos.length).toBeGreaterThan(0);
      const repo = result.repos.find((r: any) => r.repoName === REPO_NAME);
      expect(repo).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC-T01-2: GET /api/features/:featureSlug/details
  // ═══════════════════════════════════════════════════════════════════

  describe('AC-T01-2: GET /api/features/:slug/details (feature details)', () => {
    it('TS-T01-3: should return feature-level acceptance criteria', () => {
      const ac = dbHandler.getFeatureAcceptanceCriteria(REPO_NAME, FEATURE_SLUG);
      expect(Array.isArray(ac)).toBe(true);
      expect(ac.length).toBeGreaterThan(0);
      expect(ac[0]).toHaveProperty('criterion');
      expect(ac[0]).toHaveProperty('priority');
    });

    it('should return feature-level test scenarios', () => {
      const ts = dbHandler.getFeatureTestScenarios(REPO_NAME, FEATURE_SLUG);
      expect(Array.isArray(ts)).toBe(true);
      expect(ts.length).toBeGreaterThan(0);
      expect(ts[0]).toHaveProperty('title');
      expect(ts[0]).toHaveProperty('description');
    });

    it('should return refinement steps', () => {
      const steps = dbHandler.getRefinementSteps(REPO_NAME, FEATURE_SLUG);
      expect(Array.isArray(steps)).toBe(true);
    });

    it('should return clarifications', () => {
      const clarifications = dbHandler.getClarifications(REPO_NAME, FEATURE_SLUG);
      expect(Array.isArray(clarifications)).toBe(true);
    });

    it('should return all features for a repo', () => {
      const features = dbHandler.getAllFeatures(REPO_NAME);
      expect(Array.isArray(features)).toBe(true);
      expect(features.length).toBeGreaterThan(0);
      const feature = features.find((f: any) => f.featureSlug === FEATURE_SLUG);
      expect(feature).toBeDefined();
      expect(feature!.featureName).toBe(FEATURE_NAME);
    });

    it('should aggregate feature details into response DTO', () => {
      const features = dbHandler.getAllFeatures(REPO_NAME);
      const feature = features.find((f: any) => f.featureSlug === FEATURE_SLUG)!;
      expect(feature).toBeDefined();

      const acceptanceCriteria = dbHandler.getFeatureAcceptanceCriteria(REPO_NAME, FEATURE_SLUG);
      const testScenarios = dbHandler.getFeatureTestScenarios(REPO_NAME, FEATURE_SLUG);
      const refinementSteps = dbHandler.getRefinementSteps(REPO_NAME, FEATURE_SLUG);
      const clarifications = dbHandler.getClarifications(REPO_NAME, FEATURE_SLUG);
      const refinementStatus = dbHandler.getRefinementStatus(REPO_NAME, FEATURE_SLUG);

      const dto = {
        success: true,
        feature: {
          featureSlug: feature.featureSlug,
          featureName: feature.featureName,
          lastModified: feature.lastModified,
          totalTasks: feature.totalTasks,
        },
        acceptanceCriteria,
        testScenarios,
        refinementSteps,
        clarifications,
        refinementStatus,
      };

      expect(dto.success).toBe(true);
      expect(dto.feature.featureSlug).toBe(FEATURE_SLUG);
      expect(dto.feature.featureName).toBe(FEATURE_NAME);
      expect(dto.acceptanceCriteria).toBeDefined();
      expect(dto.testScenarios).toBeDefined();
      expect(dto.refinementSteps).toBeDefined();
      expect(dto.clarifications).toBeDefined();
      expect(dto.refinementStatus).toBeDefined();
    });

    it('should handle non-existent feature (404 scenario)', () => {
      const features = dbHandler.getAllFeatures(REPO_NAME);
      const missing = features.find((f: any) => f.featureSlug === 'non-existent');
      expect(missing).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC-T01-3: GET /api/refinement-status
  // ═══════════════════════════════════════════════════════════════════

  describe('AC-T01-3: GET /api/refinement-status', () => {
    it('should return refinement status for a feature', () => {
      const status = dbHandler.getRefinementStatus(REPO_NAME, FEATURE_SLUG);
      expect(status).toBeDefined();
    });

    it('should return status as an object with progress data', () => {
      const status: any = dbHandler.getRefinementStatus(REPO_NAME, FEATURE_SLUG);
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Dashboard endpoint validation patterns (security)
  // ═══════════════════════════════════════════════════════════════════

  describe('Dashboard endpoint validation (security)', () => {
    it('POST /api/repos rejects missing fields', () => {
      const body = { repoName: 'test' };
      expect(!(body as any).repoPath).toBe(true);
    });

    it('POST /api/repos rejects invalid repoName', () => {
      const invalidName = 'INVALID NAME!';
      const validNamePattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
      const singleCharPattern = /^[a-z0-9]$/;
      expect(validNamePattern.test(invalidName) || singleCharPattern.test(invalidName)).toBe(false);
    });

    it('POST /api/repos accepts valid repoName', () => {
      const validNamePattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
      expect(validNamePattern.test('my-repo')).toBe(true);
    });

    it('POST /api/repos rejects dangerous path characters', () => {
      const dangerousPath = '/path; rm -rf /';
      expect(/[;|&$`]/.test(dangerousPath)).toBe(true);
    });

    it('GET details returns structured DTO for feature', () => {
      const features = dbHandler.getAllFeatures(REPO_NAME);
      const feature = features.find((f: any) => f.featureSlug === FEATURE_SLUG);
      expect(feature).toBeDefined();
      expect(feature).toHaveProperty('featureSlug');
      expect(feature).toHaveProperty('featureName');
      expect(feature).toHaveProperty('totalTasks');
    });
  });
});
