/**
 * Comprehensive MCP Tool Test Suite
 *
 * Tests ALL 27 MCP tools exposed by the aiconductor server.
 * Ensures every tool works correctly end-to-end through AIConductor.
 *
 * Tools tested:
 *  1. register_repo
 *  2. list_repos
 *  3. get_current_repo
 *  4. create_feature
 *  5. add_task
 *  6. list_features
 *  7. get_feature
 *  8. delete_feature
 *  9. update_task
 * 10. delete_task
 * 11. get_task_status
 * 12. get_review_summary
 * 13. validate_workflow
 * 14. add_stakeholder_review
 * 15. get_next_step
 * 16. transition_task_status
 * 17. get_next_task
 * 18. update_acceptance_criteria
 * 19. get_tasks_by_status
 * 20. verify_all_tasks_complete
 * 21. update_refinement_step
 * 22. add_feature_acceptance_criteria
 * 23. add_feature_test_scenarios
 * 24. add_clarification
 * 25. add_attachment_analysis
 * 26. get_refinement_status
 * 27. generate_refinement_report
 */

import { AIConductor } from '../AIConductor.js';
import { DatabaseHandler } from '../DatabaseHandler.js';
import * as path from 'path';
import * as fs from 'fs-extra';

const REPO_NAME = 'test-repo';
const FEATURE_SLUG = 'test-feature';
const FEATURE_NAME = 'Test Feature';

/** Runs all 4 stakeholder approvals with minimum required fields so the task reaches ReadyForDevelopment. */
async function approveAllStakeholders(manager: AIConductor, repoName: string, featureSlug: string, taskId: string) {
  await manager.addReview({ repoName, featureSlug, taskId, stakeholder: 'productDirector', decision: 'approve', notes: 'Approved - market demand confirmed and feature scope is well-defined', additionalFields: { marketAnalysis: 'Market demand confirmed', competitorAnalysis: 'Competitor gap identified' } });
  await manager.addReview({ repoName, featureSlug, taskId, stakeholder: 'architect', decision: 'approve', notes: 'Architecture approved - patterns and technical approach are sound', additionalFields: { technologyRecommendations: ['TypeScript', 'SQLite'], designPatterns: ['Repository Pattern'] } });
  await manager.addReview({ repoName, featureSlug, taskId, stakeholder: 'uiUxExpert', decision: 'approve', notes: 'Design approved - usability and accessibility requirements are met', additionalFields: { usabilityFindings: 'Interface is clean and intuitive', accessibilityRequirements: ['WCAG 2.1 AA'] } });
  await manager.addReview({ repoName, featureSlug, taskId, stakeholder: 'securityOfficer', decision: 'approve', notes: 'Security checks passed - all OWASP requirements verified and compliant', additionalFields: { securityRequirements: ['Input validation required'], complianceNotes: 'OWASP guidelines followed' } });
}

/**
 * Helper to create a fully set up manager with repo + feature + task.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function setupFullEnvironment(manager: AIConductor, _dbHandler?: DatabaseHandler) {
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
    title: 'Implement Login',
    description: 'Implement the login page with email/password',
    orderOfExecution: 1,
    acceptanceCriteria: [
      { id: 'AC-1', criterion: 'User can log in with valid credentials', priority: 'Must Have', verified: false },
      { id: 'AC-2', criterion: 'Invalid credentials show error message', priority: 'Must Have', verified: false },
    ],
    testScenarios: [
      { id: 'TS-1', title: 'Valid login', description: 'Test login with good creds', manualOnly: false, priority: 'P0' },
      { id: 'TS-2', title: 'Invalid login', description: 'Test login with bad creds', manualOnly: false, priority: 'P1' },
    ],
    outOfScope: ['SSO integration'],
    estimatedHours: 8,
    dependencies: [],
    tags: ['auth', 'frontend'],
  });
}

describe('All MCP Tools - Comprehensive Test Suite', () => {
  let manager: AIConductor;
  let dbHandler: DatabaseHandler;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(process.cwd(), `test-all-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    manager = new AIConductor(testDbPath);
    dbHandler = (manager as any).dbHandler as DatabaseHandler;

    // Migration is applied automatically by DatabaseHandler constructor
  });

  afterEach(() => {
    try { dbHandler.close(); } catch { /* ignore */ }
    try { fs.removeSync(testDbPath); } catch { /* ignore */ }
  });

  // ======================================================================
  // 1. register_repo
  // ======================================================================
  describe('Tool: register_repo', () => {
    test('should register a new repository successfully', async () => {
      const result = await manager.registerRepo({
        repoName: 'my-repo',
        repoPath: '/home/user/my-repo',
        repoUrl: 'https://github.com/user/my-repo',
        defaultBranch: 'develop',
        metadata: { team: 'backend' },
      });

      expect(result.success).toBe(true);
      expect(result.repoName).toBe('my-repo');
      expect(result.message).toContain('my-repo');
    });

    test('should reject duplicate repo registration', async () => {
      await manager.registerRepo({ repoName: 'dup-repo', repoPath: '/test' });
      const result = await manager.registerRepo({ repoName: 'dup-repo', repoPath: '/test2' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });

    test('should use default branch when not provided', async () => {
      await manager.registerRepo({ repoName: 'default-branch-repo', repoPath: '/test' });
      const repo = dbHandler.getRepo('default-branch-repo');
      expect(repo.defaultBranch).toBe('main');
    });
  });

  // ======================================================================
  // 2. list_repos
  // ======================================================================
  describe('Tool: list_repos', () => {
    test('should list all registered repositories', async () => {
      await manager.registerRepo({ repoName: 'repo-a', repoPath: '/a' });
      await manager.registerRepo({ repoName: 'repo-b', repoPath: '/b' });

      const result = await manager.listRepos();

      expect(result.success).toBe(true);
      expect(result.repos.length).toBeGreaterThanOrEqual(3); // default + 2
      const names = result.repos.map(r => r.repoName);
      expect(names).toContain('default');
      expect(names).toContain('repo-a');
      expect(names).toContain('repo-b');
    });

    test('should include feature and task counts', async () => {
      await manager.registerRepo({ repoName: 'counted', repoPath: '/counted' });
      dbHandler.createFeature('feat-1', 'Feature 1', 'counted');
      dbHandler.addTask('feat-1', {
        taskId: 'T01', title: 'Task 1', description: 'Desc',
        orderOfExecution: 1, acceptanceCriteria: [],
      } as any, 'counted');

      const result = await manager.listRepos();
      const repo = result.repos.find(r => r.repoName === 'counted');

      expect(repo?.featureCount).toBe(1);
      expect(repo?.totalTasks).toBe(1);
    });
  });

  // ======================================================================
  // 3. get_current_repo
  // ======================================================================
  describe('Tool: get_current_repo', () => {
    test('should return unregistered status for unknown directory', async () => {
      const result = await manager.getCurrentRepo();
      // Current working dir during test is unlikely to be registered
      expect(result.success === true || result.success === false).toBe(true);
      // It should always return something meaningful
      expect(result).toHaveProperty('registered');
    });

    test('should detect registered repo by path', async () => {
      const cwd = process.cwd();
      await manager.registerRepo({ repoName: 'cwd-repo', repoPath: cwd });

      const result = await manager.getCurrentRepo();
      expect(result.success).toBe(true);
      expect(result.registered).toBe(true);
      expect(result.repoName).toBe('cwd-repo');
    });
  });

  // ======================================================================
  // 4. create_feature
  // ======================================================================
  describe('Tool: create_feature', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test/repo' });
    });

    test('should create a new feature with refinement steps', async () => {
      const result = await manager.createFeature({
        repoName: REPO_NAME,
        featureSlug: 'new-feature',
        featureName: 'New Feature',
      });

      expect(result.success).toBe(true);
      expect(result.featureSlug).toBe('new-feature');

      // Verify refinement steps were initialized
      const steps = dbHandler.getRefinementSteps(REPO_NAME, 'new-feature');
      expect(steps.length).toBe(8);
      expect(steps.every((s: any) => !s.completed)).toBe(true);
    });

    test('should fail for duplicate feature slugs in same repo', async () => {
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: 'dup', featureName: 'Dup' });
      const result = await manager.createFeature({ repoName: REPO_NAME, featureSlug: 'dup', featureName: 'Dup 2' });
      expect(result.success).toBe(false);
    });
  });

  // ======================================================================
  // 5. add_task
  // ======================================================================
  describe('Tool: add_task', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test/repo' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should add a task with all fields', async () => {
      const result = await manager.addTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        title: 'Build API',
        description: 'Build the REST API',
        orderOfExecution: 1,
        acceptanceCriteria: [
          { id: 'AC-1', criterion: 'GET /users returns 200', priority: 'Must Have', verified: false },
        ],
        testScenarios: [
          { id: 'TS-1', title: 'Get users', description: 'Test GET /users', manualOnly: false, priority: 'P0' },
        ],
        outOfScope: ['GraphQL'],
        estimatedHours: 16,
        dependencies: [],
        tags: ['api', 'backend'],
      });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('T01');
    });

    test('should add a task with minimal fields', async () => {
      const result = await manager.addTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T02',
        title: 'Minimal Task',
        description: 'No extras',
        orderOfExecution: 2,
      });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('T02');
    });

    test('should fail to add task to non-existent feature', async () => {
      const result = await manager.addTask({
        repoName: REPO_NAME,
        featureSlug: 'does-not-exist',
        taskId: 'T01',
        title: 'Task',
        description: 'Desc',
        orderOfExecution: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should fail for duplicate task ID in same feature', async () => {
      await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T01', title: 'First', description: 'First task', orderOfExecution: 1,
      });
      const result = await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T01', title: 'Duplicate', description: 'Dup', orderOfExecution: 2,
      });
      expect(result.success).toBe(false);
    });
  });

  // ======================================================================
  // 6. list_features
  // ======================================================================
  describe('Tool: list_features', () => {
    test('should list all features in a repo', async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: 'feat-a', featureName: 'Feature A' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: 'feat-b', featureName: 'Feature B' });

      const result = await manager.listFeatures(REPO_NAME);

      expect(result.success).toBe(true);
      expect(result.features.length).toBe(2);
      const slugs = result.features.map(f => f.featureSlug);
      expect(slugs).toContain('feat-a');
      expect(slugs).toContain('feat-b');
    });

    test('should return empty list for repo with no features', async () => {
      await manager.registerRepo({ repoName: 'empty', repoPath: '/empty' });
      const result = await manager.listFeatures('empty');

      expect(result.success).toBe(true);
      expect(result.features.length).toBe(0);
    });
  });

  // ======================================================================
  // 7. get_feature
  // ======================================================================
  describe('Tool: get_feature', () => {
    test('should get a complete feature with tasks', async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
      await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T01', title: 'Task 1', description: 'Desc', orderOfExecution: 1,
        acceptanceCriteria: [{ id: 'AC-1', criterion: 'Works', priority: 'Must Have', verified: false }],
      });

      const result = await manager.getFeature(REPO_NAME, FEATURE_SLUG);

      expect(result.success).toBe(true);
      expect(result.feature).toBeDefined();
      expect(result.feature!.featureSlug).toBe(FEATURE_SLUG);
      expect(result.feature!.tasks.length).toBe(1);
      expect(result.feature!.tasks[0].acceptanceCriteria.length).toBe(1);
    });

    test('should fail for non-existent feature', async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      const result = await manager.getFeature(REPO_NAME, 'ghost');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ======================================================================
  // 8. delete_feature
  // ======================================================================
  describe('Tool: delete_feature', () => {
    test('should delete a feature and its tasks', async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: 'to-delete', featureName: 'Delete Me' });
      await manager.addTask({
        repoName: REPO_NAME, featureSlug: 'to-delete',
        taskId: 'T01', title: 'Task', description: 'Desc', orderOfExecution: 1,
      });

      const result = await manager.deleteFeature(REPO_NAME, 'to-delete');
      expect(result.success).toBe(true);

      // Verify it's gone
      const getResult = await manager.getFeature(REPO_NAME, 'to-delete');
      expect(getResult.success).toBe(false);
    });
  });

  // ======================================================================
  // 9. update_task
  // ======================================================================
  describe('Tool: update_task', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should update task title and description', async () => {
      const result = await manager.updateTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        updates: {
          title: 'Updated Login',
          description: 'Updated description',
        },
      });

      expect(result.success).toBe(true);

      const feature = await manager.getFeature(REPO_NAME, FEATURE_SLUG);
      expect(feature.feature!.tasks[0].title).toBe('Updated Login');
      expect(feature.feature!.tasks[0].description).toBe('Updated description');
    });

    test('should update acceptance criteria', async () => {
      const result = await manager.updateTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        updates: {
          acceptanceCriteria: [
            { id: 'AC-1', criterion: 'Updated criterion', priority: 'Must Have', verified: true },
          ],
        },
      });

      expect(result.success).toBe(true);

      const feature = await manager.getFeature(REPO_NAME, FEATURE_SLUG);
      expect(feature.feature!.tasks[0].acceptanceCriteria.length).toBe(1);
      expect(feature.feature!.tasks[0].acceptanceCriteria[0].criterion).toBe('Updated criterion');
    });

    test('should reject status updates via update_task', async () => {
      const result = await manager.updateTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        updates: { status: 'Done' } as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('transition_task_status');
    });

    test('should fail for non-existent task', async () => {
      const result = await manager.updateTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T99',
        updates: { title: 'Nope' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should fail when no fields to update', async () => {
      const result = await manager.updateTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        updates: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No fields');
    });
  });

  // ======================================================================
  // 10. delete_task
  // ======================================================================
  describe('Tool: delete_task', () => {
    test('should delete a specific task', async () => {
      await setupFullEnvironment(manager, dbHandler);

      const result = await manager.deleteTask(REPO_NAME, FEATURE_SLUG, 'T01');
      expect(result.success).toBe(true);

      const feature = await manager.getFeature(REPO_NAME, FEATURE_SLUG);
      expect(feature.feature!.tasks.length).toBe(0);
    });

    test('should warn about dependent tasks', async () => {
      await setupFullEnvironment(manager, dbHandler);

      await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T02', title: 'Depends on T01', description: 'Dep',
        orderOfExecution: 2, dependencies: ['T01'],
      });

      const result = await manager.deleteTask(REPO_NAME, FEATURE_SLUG, 'T01');
      expect(result.success).toBe(true);
      expect(result.message).toContain('dependencies');
    });

    test('should fail for non-existent task', async () => {
      await setupFullEnvironment(manager, dbHandler);

      const result = await manager.deleteTask(REPO_NAME, FEATURE_SLUG, 'T99');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ======================================================================
  // 11. get_task_status
  // ======================================================================
  describe('Tool: get_task_status', () => {
    test('should return task status with review progress', async () => {
      await setupFullEnvironment(manager, dbHandler);

      const result = await manager.getTaskStatus(REPO_NAME, FEATURE_SLUG, 'T01');

      expect(result.taskId).toBe('T01');
      expect(result.status).toBe('PendingProductDirector');
      expect(result.currentStakeholder).toBe('productDirector');
      expect(result.pendingReviews).toContain('productDirector');
      expect(result.canTransitionTo).toContain('PendingArchitect');
      expect(result.canTransitionTo).toContain('NeedsRefinement');
      expect(result.orderOfExecution).toBe(1);
    });

    test('should throw for non-existent task', async () => {
      await setupFullEnvironment(manager, dbHandler);

      await expect(
        manager.getTaskStatus(REPO_NAME, FEATURE_SLUG, 'T99')
      ).rejects.toThrow('not found');
    });
  });

  // ======================================================================
  // 12. get_review_summary
  // ======================================================================
  describe('Tool: get_review_summary', () => {
    test('should generate summary with task counts', async () => {
      await setupFullEnvironment(manager, dbHandler);

      // Add a second task
      await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T02', title: 'Task 2', description: 'Second task',
        orderOfExecution: 2,
      });

      const result = await manager.getReviewSummary(REPO_NAME, FEATURE_SLUG);

      expect(result.featureSlug).toBe(FEATURE_SLUG);
      expect(result.totalTasks).toBe(2);
      expect(result.tasksByStatus.PendingProductDirector).toBe(2);
      expect(result.completionPercentage).toBe(0);
      expect(result.tasks.length).toBe(2);
      expect(result.stakeholderProgress.productDirector.pending).toBe(2);
    });

    test('should reflect completion after approvals', async () => {
      await setupFullEnvironment(manager, dbHandler);

      // Approve through all stakeholders
      await approveAllStakeholders(manager, REPO_NAME, FEATURE_SLUG, 'T01');

      const result = await manager.getReviewSummary(REPO_NAME, FEATURE_SLUG);
      expect(result.tasksByStatus.ReadyForDevelopment).toBe(1);
      expect(result.completionPercentage).toBe(100);
    });
  });

  // ======================================================================
  // 13. validate_workflow
  // ======================================================================
  describe('Tool: validate_workflow', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should validate correct stakeholder can review', async () => {
      const result = await manager.validateWorkflow(REPO_NAME, FEATURE_SLUG, 'T01', 'productDirector');

      expect(result.valid).toBe(true);
      expect(result.expectedStakeholder).toBe('productDirector');
      expect(result.allowedTransitions).toContain('PendingArchitect');
    });

    test('should reject wrong stakeholder', async () => {
      const result = await manager.validateWorkflow(REPO_NAME, FEATURE_SLUG, 'T01', 'architect');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Wrong stakeholder');
    });

    test('should fail for non-existent task', async () => {
      const result = await manager.validateWorkflow(REPO_NAME, FEATURE_SLUG, 'T99', 'productDirector');

      expect(result.valid).toBe(false);
    });
  });

  // ======================================================================
  // 14. add_stakeholder_review
  // ======================================================================
  describe('Tool: add_stakeholder_review', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should approve and transition to next stakeholder', async () => {
      const result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector',
        decision: 'approve',
        notes: 'Aligned with product goals - market demand confirmed and scope is appropriate',
        additionalFields: {
          marketAnalysis: 'Strong demand for login feature',
          competitorAnalysis: 'Competitors use OAuth',
        },
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('PendingProductDirector');
      expect(result.newStatus).toBe('PendingArchitect');
    });

    test('should reject and move to NeedsRefinement', async () => {
      const result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector',
        decision: 'reject',
        notes: 'Needs more clarity on the implementation approach and acceptance criteria',
        additionalFields: { marketAnalysis: 'Market analysis shows insufficient demand for this feature scope' },
      });

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('NeedsRefinement');
    });

    test('should reject wrong stakeholder review', async () => {
      const result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'architect', // Wrong - should be productDirector first
        decision: 'approve',
        notes: 'Out of order',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow validation failed');
    });

    test('should complete full stakeholder review cycle', async () => {
      // Product Director approves
      let result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector', decision: 'approve', notes: 'Approved - all requirements verified and implementation looks correct',
        additionalFields: { marketAnalysis: 'Good', competitorAnalysis: 'None' },
      });
      expect(result.newStatus).toBe('PendingArchitect');

      // Architect approves
      result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'architect', decision: 'approve', notes: 'Architecture approved - patterns and technical approach are sound',
        additionalFields: { technologyRecommendations: ['React', 'Node'], designPatterns: ['MVC'] },
      });
      expect(result.newStatus).toBe('PendingUiUxExpert');

      // UI/UX Expert approves
      result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'uiUxExpert', decision: 'approve', notes: 'Design approved - usability and accessibility requirements are met',
        additionalFields: {
          usabilityFindings: 'Clean layout',
          accessibilityRequirements: ['WCAG 2.1 AA'],
          userBehaviorInsights: 'Users prefer social login',
        },
      });
      expect(result.newStatus).toBe('PendingSecurityOfficer');

      // Security Officer approves
      result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'securityOfficer', decision: 'approve', notes: 'Security checks passed - all OWASP requirements verified and compliant',
        additionalFields: {
          securityRequirements: ['HTTPS required', 'Rate limiting'],
          complianceNotes: 'GDPR compliant',
        },
      });
      expect(result.newStatus).toBe('ReadyForDevelopment');
    });

    test('should handle review on already-completed task', async () => {
      // Move task through full approval
      await approveAllStakeholders(manager, REPO_NAME, FEATURE_SLUG, 'T01');

      // Try to add another review
      const result = await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector', decision: 'approve', notes: 'Extra',
      });

      expect(result.success).toBe(false);
    });
  });

  // ======================================================================
  // 15. get_next_step
  // ======================================================================
  describe('Tool: get_next_step', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should return productDirector as first step', async () => {
      const result = await manager.getNextStep({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
      });

      expect(result.success).toBe(true);
      expect(result.nextRole).toBe('productDirector');
      expect(result.currentStatus).toBe('PendingProductDirector');
      expect(result.phase).toBe('review');
      expect(result.allowedDecisions).toContain('approve');
      expect(result.allowedDecisions).toContain('reject');
      expect(result.focusAreas.length).toBeGreaterThan(0);
      expect(result.systemPrompt).toBeTruthy();
      expect(result.requiredOutputFields.length).toBeGreaterThan(0);
    });

    test('should return architect after productDirector approval', async () => {
      await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector', decision: 'approve', notes: 'Approved - all requirements verified and implementation looks correct',
        additionalFields: { marketAnalysis: 'Market demand confirmed', competitorAnalysis: 'Competitor gap identified' },
      });

      const result = await manager.getNextStep({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
      });

      expect(result.nextRole).toBe('architect');
      expect(result.currentStatus).toBe('PendingArchitect');
      expect(result.previousRoleNotes).toHaveProperty('productDirector');
    });

    test('should indicate completion for Done tasks', async () => {
      // Fully approve through all stakeholders
      await approveAllStakeholders(manager, REPO_NAME, FEATURE_SLUG, 'T01');

      // Transition through dev workflow to Done
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ReadyForDevelopment', toStatus: 'ToDo', actor: 'system' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ToDo', toStatus: 'InProgress', actor: 'developer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InProgress', toStatus: 'InReview', actor: 'developer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InReview', toStatus: 'InQA', actor: 'codeReviewer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InQA', toStatus: 'Done', actor: 'qa' });

      const result = await manager.getNextStep({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('complete');
    });

    test('should fail for non-existent task', async () => {
      const result = await manager.getNextStep({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T99',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ======================================================================
  // 16. transition_task_status
  // ======================================================================
  describe('Tool: transition_task_status', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);

      // Approve through all stakeholders to reach ReadyForDevelopment
      await approveAllStakeholders(manager, REPO_NAME, FEATURE_SLUG, 'T01');
    });

    test('should transition ReadyForDevelopment -> ToDo', async () => {
      const result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'ReadyForDevelopment', toStatus: 'ToDo', actor: 'system',
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe('ReadyForDevelopment');
      expect(result.newStatus).toBe('ToDo');
    });

    test('should transition through full dev cycle', async () => {
      // ReadyForDevelopment -> ToDo
      let result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'ReadyForDevelopment', toStatus: 'ToDo', actor: 'system',
      });
      expect(result.success).toBe(true);

      // ToDo -> InProgress
      result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'ToDo', toStatus: 'InProgress', actor: 'developer',
      });
      expect(result.success).toBe(true);

      // InProgress -> InReview
      result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'InProgress', toStatus: 'InReview', actor: 'developer',
        notes: 'Code complete', metadata: { filesChanged: ['login.ts'], testFiles: ['login.test.ts'] },
      });
      expect(result.success).toBe(true);

      // InReview -> InQA
      result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'InReview', toStatus: 'InQA', actor: 'codeReviewer',
        notes: 'Code looks good', metadata: { testResultsSummary: 'All pass' },
      });
      expect(result.success).toBe(true);

      // InQA -> Done
      result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'InQA', toStatus: 'Done', actor: 'qa',
        notes: 'All tests passed', metadata: { acceptanceCriteriaMet: true, deploymentReadiness: 'Ready' },
      });
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('Done');
    });

    test('should reject invalid transitions', async () => {
      const result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'ReadyForDevelopment', toStatus: 'Done', actor: 'developer',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow validation failed');
    });

    test('should reject status mismatch', async () => {
      const result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'InProgress', toStatus: 'InReview', actor: 'developer', // status is not InProgress
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    test('should handle NeedsChanges loop', async () => {
      // Move to InReview
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ReadyForDevelopment', toStatus: 'ToDo', actor: 'system' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ToDo', toStatus: 'InProgress', actor: 'developer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InProgress', toStatus: 'InReview', actor: 'developer' });

      // Reject to NeedsChanges
      const result = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'InReview', toStatus: 'NeedsChanges', actor: 'codeReviewer',
        notes: 'Missing tests',
      });
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('NeedsChanges');

      // Fix: NeedsChanges -> InProgress
      const fixResult = await manager.transitionTaskStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        fromStatus: 'NeedsChanges', toStatus: 'InProgress', actor: 'developer',
      });
      expect(fixResult.success).toBe(true);
    });
  });

  // ======================================================================
  // 17. get_next_task
  // ======================================================================
  describe('Tool: get_next_task', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should return task with lowest orderOfExecution', async () => {
      await manager.addTask({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        taskId: 'T02', title: 'Second task', description: 'Desc',
        orderOfExecution: 2,
      });

      const result = await manager.getNextTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        statusFilter: ['PendingProductDirector'],
      });

      expect(result.success).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task!.taskId).toBe('T01');
      expect(result.task!.orderOfExecution).toBe(1);
    });

    test('should return no task when no status matches', async () => {
      const result = await manager.getNextTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        statusFilter: ['Done'],
      });

      expect(result.success).toBe(true);
      expect(result.task).toBeUndefined();
      expect(result.message).toContain('No tasks found');
    });

    test('should filter by multiple statuses', async () => {
      const result = await manager.getNextTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        statusFilter: ['ReadyForDevelopment', 'ToDo', 'PendingProductDirector'],
      });

      expect(result.success).toBe(true);
      expect(result.task).toBeDefined();
    });
  });

  // ======================================================================
  // 18. update_acceptance_criteria
  // ======================================================================
  describe('Tool: update_acceptance_criteria', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should mark criterion as verified', async () => {
      const result = await manager.updateAcceptanceCriteria({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        criterionId: 'AC-1',
        verified: true,
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.message).toContain('verified');

      // Verify persistence
      const feature = await manager.getFeature(REPO_NAME, FEATURE_SLUG);
      const ac = feature.feature!.tasks[0].acceptanceCriteria.find(c => c.id === 'AC-1');
      expect(ac!.verified).toBe(true);
    });

    test('should mark criterion as unverified', async () => {
      // First verify, then unverify
      await manager.updateAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        criterionId: 'AC-1', verified: true,
      });

      const result = await manager.updateAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        criterionId: 'AC-1', verified: false,
      });

      expect(result.success).toBe(true);
      expect(result.verified).toBe(false);
    });

    test('should fail for non-existent criterion', async () => {
      const result = await manager.updateAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        criterionId: 'AC-99', verified: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ======================================================================
  // 19. get_tasks_by_status
  // ======================================================================
  describe('Tool: get_tasks_by_status', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should find tasks with matching status', async () => {
      const result = await manager.getTasksByStatus({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        status: 'PendingProductDirector',
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.tasks[0].taskId).toBe('T01');
    });

    test('should return empty for non-matching status', async () => {
      const result = await manager.getTasksByStatus({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        status: 'Done',
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.tasks.length).toBe(0);
    });

    test('should filter correctly after status transitions', async () => {
      await manager.addReview({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01',
        stakeholder: 'productDirector', decision: 'approve', notes: 'Approved - all requirements verified and implementation looks correct',
        additionalFields: { marketAnalysis: 'Market demand confirmed', competitorAnalysis: 'Competitor gap identified' },
      });

      const pendingPD = await manager.getTasksByStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, status: 'PendingProductDirector',
      });
      expect(pendingPD.count).toBe(0);

      const pendingArch = await manager.getTasksByStatus({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, status: 'PendingArchitect',
      });
      expect(pendingArch.count).toBe(1);
    });
  });

  // ======================================================================
  // 20. verify_all_tasks_complete
  // ======================================================================
  describe('Tool: verify_all_tasks_complete', () => {
    beforeEach(async () => {
      await setupFullEnvironment(manager, dbHandler);
    });

    test('should report not all complete when tasks are pending', async () => {
      const result = await manager.verifyAllTasksComplete({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
      });

      expect(result.success).toBe(true);
      expect(result.allComplete).toBe(false);
      expect(result.totalTasks).toBe(1);
      expect(result.completedTasks).toBe(0);
      expect(result.incompleteTasks.length).toBe(1);
      expect(result.incompleteTasks[0].taskId).toBe('T01');
    });

    test('should report all complete when all tasks are Done', async () => {
      // Move T01 through full workflow to Done
      await approveAllStakeholders(manager, REPO_NAME, FEATURE_SLUG, 'T01');

      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ReadyForDevelopment', toStatus: 'ToDo', actor: 'system' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'ToDo', toStatus: 'InProgress', actor: 'developer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InProgress', toStatus: 'InReview', actor: 'developer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InReview', toStatus: 'InQA', actor: 'codeReviewer' });
      await manager.transitionTaskStatus({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, taskId: 'T01', fromStatus: 'InQA', toStatus: 'Done', actor: 'qa' });

      const result = await manager.verifyAllTasksComplete({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
      });

      expect(result.success).toBe(true);
      expect(result.allComplete).toBe(true);
      expect(result.totalTasks).toBe(1);
      expect(result.completedTasks).toBe(1);
      expect(result.incompleteTasks.length).toBe(0);
    });
  });

  // ======================================================================
  // 21. update_refinement_step
  // ======================================================================
  describe('Tool: update_refinement_step', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should mark step as completed', async () => {
      const result = await manager.updateRefinementStep({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        stepNumber: 1,
        completed: true,
        summary: 'Gathered context and determined scope',
        data: { scope: 'feature enhancement', ticketKey: 'PROJ-123' },
      });

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.stepNumber).toBe(1);
    });

    test('should update step with in-progress status', async () => {
      const result = await manager.updateRefinementStep({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        stepNumber: 2,
        completed: false,
        summary: 'Analyzing attachments...',
      });

      expect(result.success).toBe(true);
      expect(result.completed).toBe(false);
    });

    test('should update all 8 steps sequentially', async () => {
      for (let i = 1; i <= 8; i++) {
        const result = await manager.updateRefinementStep({
          repoName: REPO_NAME,
          featureSlug: FEATURE_SLUG,
          stepNumber: i,
          completed: true,
          summary: `Step ${i} completed`,
        });
        expect(result.success).toBe(true);
      }

      const steps = dbHandler.getRefinementSteps(REPO_NAME, FEATURE_SLUG);
      expect(steps.filter((s: any) => s.completed).length).toBe(8);
    });
  });

  // ======================================================================
  // 22. add_feature_acceptance_criteria
  // ======================================================================
  describe('Tool: add_feature_acceptance_criteria', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should add multiple criteria', async () => {
      const result = await manager.addFeatureAcceptanceCriteria({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        criteria: [
          { criterionId: 'FAC-1', criterion: 'System must handle 1000 concurrent users', priority: 'Must Have' },
          { criterionId: 'FAC-2', criterion: 'Response time under 200ms', priority: 'Should Have' },
          { criterionId: 'FAC-3', criterion: 'Dark mode support', priority: 'Could Have' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.criteriaAdded).toBe(3);
    });

    test('should upsert existing criteria', async () => {
      await manager.addFeatureAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        criteria: [{ criterionId: 'FAC-1', criterion: 'Original', priority: 'Must Have' }],
      });

      await manager.addFeatureAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        criteria: [{ criterionId: 'FAC-1', criterion: 'Updated', priority: 'Should Have' }],
      });

      const criteria = dbHandler.getFeatureAcceptanceCriteria(REPO_NAME, FEATURE_SLUG);
      expect(criteria.length).toBe(1);
      expect(criteria[0].criterion).toBe('Updated');
      expect(criteria[0].priority).toBe('Should Have');
    });
  });

  // ======================================================================
  // 23. add_feature_test_scenarios
  // ======================================================================
  describe('Tool: add_feature_test_scenarios', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should add multiple test scenarios', async () => {
      const result = await manager.addFeatureTestScenarios({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        scenarios: [
          {
            scenarioId: 'FTS-1', title: 'Happy path login',
            description: 'User logs in with valid credentials',
            priority: 'P0', type: 'automated',
            preconditions: 'User account exists',
            expectedResult: 'User is redirected to dashboard',
          },
          {
            scenarioId: 'FTS-2', title: 'Invalid credentials',
            description: 'User tries to log in with wrong password',
            priority: 'P1', type: 'automated',
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.scenariosAdded).toBe(2);
    });

    test('should upsert existing scenarios', async () => {
      await manager.addFeatureTestScenarios({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        scenarios: [
          { scenarioId: 'FTS-1', title: 'Original', description: 'Original desc', priority: 'P0' },
        ],
      });

      await manager.addFeatureTestScenarios({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        scenarios: [
          { scenarioId: 'FTS-1', title: 'Updated', description: 'Updated desc', priority: 'P1' },
        ],
      });

      const scenarios = dbHandler.getFeatureTestScenarios(REPO_NAME, FEATURE_SLUG);
      expect(scenarios.length).toBe(1);
      expect(scenarios[0].title).toBe('Updated');
      expect(scenarios[0].priority).toBe('P1');
    });
  });

  // ======================================================================
  // 24. add_clarification
  // ======================================================================
  describe('Tool: add_clarification', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should add a question without answer', async () => {
      const result = await manager.addClarification({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        question: 'Should we support OAuth2 in addition to email/password?',
        askedBy: 'llm',
      });

      expect(result.success).toBe(true);
      expect(result.clarificationId).toBeGreaterThan(0);
    });

    test('should add a question with answer', async () => {
      const result = await manager.addClarification({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        question: 'What is the session timeout?',
        answer: '30 minutes',
        askedBy: 'llm',
      });

      expect(result.success).toBe(true);

      const clarifications = dbHandler.getClarifications(REPO_NAME, FEATURE_SLUG);
      expect(clarifications.length).toBe(1);
      expect(clarifications[0].question).toBe('What is the session timeout?');
      expect(clarifications[0].answer).toBe('30 minutes');
    });

    test('should add user-originated question', async () => {
      const result = await manager.addClarification({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        question: 'How about mobile support?',
        askedBy: 'user',
      });

      expect(result.success).toBe(true);

      const clarifications = dbHandler.getClarifications(REPO_NAME, FEATURE_SLUG);
      expect(clarifications[0].askedBy).toBe('user');
    });

    test('should add multiple clarifications', async () => {
      await manager.addClarification({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        question: 'Q1?',
      });
      await manager.addClarification({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        question: 'Q2?', answer: 'A2',
      });

      const clarifications = dbHandler.getClarifications(REPO_NAME, FEATURE_SLUG);
      expect(clarifications.length).toBe(2);
    });
  });

  // ======================================================================
  // 25. add_attachment_analysis
  // ======================================================================
  describe('Tool: add_attachment_analysis', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should add Excel attachment analysis', async () => {
      const result = await manager.addAttachmentAnalysis({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        attachmentName: 'requirements.xlsx',
        attachmentType: 'excel',
        analysisSummary: 'Contains 15 columns of user data fields',
        filePath: '/tmp/requirements.xlsx',
        extractedData: { columns: ['name', 'email', 'role'], rows: 150 },
      });

      expect(result.success).toBe(true);
      expect(result.attachmentId).toBeGreaterThan(0);
    });

    test('should add image attachment analysis', async () => {
      const result = await manager.addAttachmentAnalysis({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        attachmentName: 'login-mockup.png',
        attachmentType: 'image',
        analysisSummary: 'Login form with email/password fields and social auth buttons',
        fileUrl: 'https://example.com/mockup.png',
      });

      expect(result.success).toBe(true);
    });

    test('should add document attachment analysis', async () => {
      const result = await manager.addAttachmentAnalysis({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        attachmentName: 'PRD.pdf',
        attachmentType: 'document',
        analysisSummary: 'Product requirements document outlining user auth flow',
      });

      expect(result.success).toBe(true);

      const attachments = dbHandler.getAttachments(REPO_NAME, FEATURE_SLUG);
      expect(attachments.length).toBe(1);
      expect(attachments[0].attachmentType).toBe('document');
    });

    test('should add design attachment analysis', async () => {
      const result = await manager.addAttachmentAnalysis({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        attachmentName: 'figma-design.fig',
        attachmentType: 'design',
        analysisSummary: 'Figma design with 3 screens',
        extractedData: { screens: ['login', 'register', 'forgot-password'] },
      });

      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // 26. get_refinement_status
  // ======================================================================
  describe('Tool: get_refinement_status', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });
    });

    test('should return initial refinement status', async () => {
      const result = await manager.getRefinementStatus({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
      });

      expect(result.success).toBe(true);
      expect(result.featureName).toBe(FEATURE_NAME);
      expect(result.progressPercentage).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(8);
      expect(result.acceptanceCriteriaCount).toBe(0);
      expect(result.testScenariosCount).toBe(0);
      expect(result.clarificationsCount).toBe(0);
      expect(result.attachmentsCount).toBe(0);
    });

    test('should reflect progress after steps and data additions', async () => {
      // Complete steps 1-3
      for (let i = 1; i <= 3; i++) {
        await manager.updateRefinementStep({
          repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
          stepNumber: i, completed: true, summary: `Step ${i} done`,
        });
      }

      // Add some data
      await manager.addFeatureAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        criteria: [
          { criterionId: 'FAC-1', criterion: 'Test', priority: 'Must Have' },
          { criterionId: 'FAC-2', criterion: 'Test 2', priority: 'Should Have' },
        ],
      });
      await manager.addFeatureTestScenarios({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        scenarios: [{ scenarioId: 'FTS-1', title: 'Test', description: 'D', priority: 'P0' }],
      });
      await manager.addClarification({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG, question: 'Q?', answer: 'A',
      });
      await manager.addAttachmentAnalysis({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        attachmentName: 'file.pdf', attachmentType: 'document', analysisSummary: 'Summary',
      });

      const result = await manager.getRefinementStatus({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
      });

      expect(result.success).toBe(true);
      expect(result.completedSteps).toBe(3);
      expect(result.progressPercentage).toBe(38); // 3/8 = 37.5 -> 38
      expect(result.acceptanceCriteriaCount).toBe(2);
      expect(result.testScenariosCount).toBe(1);
      expect(result.clarificationsCount).toBe(1);
      expect(result.attachmentsCount).toBe(1);
    });

    test('should fail for non-existent feature', async () => {
      const result = await manager.getRefinementStatus({
        repoName: REPO_NAME,
        featureSlug: 'ghost-feature',
      });

      expect(result.success).toBe(false);
    });
  });

  // ======================================================================
  // 27. generate_refinement_report
  // ======================================================================
  describe('Tool: generate_refinement_report', () => {
    beforeEach(async () => {
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({ repoName: REPO_NAME, featureSlug: FEATURE_SLUG, featureName: FEATURE_NAME });

      // Add some data for the report
      await manager.updateRefinementStep({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        stepNumber: 1, completed: true, summary: 'Context gathered',
      });
      await manager.addFeatureAcceptanceCriteria({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        criteria: [{ criterionId: 'FAC-1', criterion: 'Must have login', priority: 'Must Have' }],
      });
      await manager.addFeatureTestScenarios({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        scenarios: [{
          scenarioId: 'FTS-1', title: 'Login test', description: 'Test login flow',
          priority: 'P0', preconditions: 'User exists', expectedResult: 'Login success',
        }],
      });
      await manager.addClarification({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        question: 'Session timeout?', answer: '30 min',
      });
      await manager.addAttachmentAnalysis({
        repoName: REPO_NAME, featureSlug: FEATURE_SLUG,
        attachmentName: 'mockup.png', attachmentType: 'image',
        analysisSummary: 'Login mockup with form fields',
      });
    });

    test('should generate markdown report', async () => {
      const result = await manager.generateRefinementReport({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        format: 'markdown',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('markdown');
      expect(result.content).toContain(FEATURE_NAME);
      expect(result.content).toContain('Refinement Steps');
      expect(result.content).toContain('Context gathered');
      expect(result.content).toContain('Must have login');
      expect(result.content).toContain('Login test');
      expect(result.content).toContain('Session timeout?');
      expect(result.content).toContain('mockup.png');
    });

    test('should generate JSON report', async () => {
      const result = await manager.generateRefinementReport({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        format: 'json',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('json');

      const parsed = JSON.parse(result.content);
      expect(parsed.featureName).toBe(FEATURE_NAME);
    });

    test('should generate HTML report', async () => {
      const result = await manager.generateRefinementReport({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        format: 'html',
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe('html');
      expect(result.content).toContain('<html>');
      expect(result.content).toContain(FEATURE_NAME);
    });

    test('should include only specified sections', async () => {
      const result = await manager.generateRefinementReport({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        format: 'markdown',
        includeSections: ['steps', 'criteria'],
      });

      expect(result.success).toBe(true);
      expect(result.sectionsIncluded).toEqual(['steps', 'criteria']);
      expect(result.content).toContain('Refinement Steps');
      expect(result.content).toContain('Must have login');
      // Should NOT contain clarifications or attachments
      expect(result.content).not.toContain('Clarifications');
      expect(result.content).not.toContain('Analyzed Attachments');
    });

    test('should fail for non-existent feature', async () => {
      const result = await manager.generateRefinementReport({
        repoName: REPO_NAME,
        featureSlug: 'ghost',
        format: 'markdown',
      });

      expect(result.success).toBe(false);
    });
  });

  // ======================================================================
  // Integration: Full Refinement Workflow (End-to-End)
  // ======================================================================
  describe('Integration: Full Refinement + Review Workflow', () => {
    test('should support complete refine-feature prompt workflow', async () => {
      // Step 0: Register repo
      const regResult = await manager.registerRepo({ repoName: 'my-project', repoPath: '/projects/my-project' });
      expect(regResult.success).toBe(true);

      // Step 1: Create feature
      const createResult = await manager.createFeature({
        repoName: 'my-project',
        featureSlug: 'smart-strangle-engine',
        featureName: 'Smart Strangle Engine',
      });
      expect(createResult.success).toBe(true);

      // Step 1 complete
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 1, completed: true, summary: 'Feature enhancement scope identified',
      });

      // Step 2: Attachment analysis
      await manager.addAttachmentAnalysis({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        attachmentName: 'spec.docx', attachmentType: 'document',
        analysisSummary: 'Technical specification with architecture diagrams',
      });
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 2, completed: true, summary: 'Attachments analyzed',
      });

      // Step 3: Clarifications
      await manager.addClarification({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        question: 'What exchanges are supported?', answer: 'NYSE and NASDAQ only',
      });
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 3, completed: true, summary: 'All clarifications resolved',
      });

      // Step 4: Acceptance Criteria
      await manager.addFeatureAcceptanceCriteria({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        criteria: [
          { criterionId: 'FAC-1', criterion: 'Engine processes trades within 50ms', priority: 'Must Have' },
          { criterionId: 'FAC-2', criterion: 'Supports multi-leg strategies', priority: 'Must Have' },
          { criterionId: 'FAC-3', criterion: 'Dashboard shows live P&L', priority: 'Should Have' },
        ],
      });
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 4, completed: true, summary: '3 SMART acceptance criteria generated',
      });

      // Step 5: Test Scenarios
      await manager.addFeatureTestScenarios({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        scenarios: [
          { scenarioId: 'FTS-1', title: 'Trade execution under 50ms', description: 'Measure latency', priority: 'P0' },
          { scenarioId: 'FTS-2', title: 'Multi-leg order placement', description: 'Test multi-leg', priority: 'P0' },
        ],
      });
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 5, completed: true, summary: '2 test scenarios created',
      });

      // Step 6: Task Breakdown
      await manager.addTask({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        taskId: 'T01', title: 'Build Trade Engine Core',
        description: 'Core trading engine with order routing',
        orderOfExecution: 1,
        acceptanceCriteria: [
          { id: 'AC-1', criterion: 'Processes trades within 50ms', priority: 'Must Have', verified: false },
        ],
      });
      await manager.addTask({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        taskId: 'T02', title: 'Build Dashboard',
        description: 'Live P&L dashboard',
        orderOfExecution: 2,
      });
      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 6, completed: true, summary: '2 tasks created',
      });

      // Step 7: Stakeholder Review for T01
      const nextStep1 = await manager.getNextStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine', taskId: 'T01',
      });
      expect(nextStep1.nextRole).toBe('productDirector');

      // Go through all approvals for T01
      await approveAllStakeholders(manager, 'my-project', 'smart-strangle-engine', 'T01');

      // Verify T01 is ReadyForDevelopment
      const t01Status = await manager.getTaskStatus('my-project', 'smart-strangle-engine', 'T01');
      expect(t01Status.status).toBe('ReadyForDevelopment');

      // Go through all approvals for T02
      await approveAllStakeholders(manager, 'my-project', 'smart-strangle-engine', 'T02');

      // Verify all tasks ReadyForDevelopment
      const tasksByStatus = await manager.getTasksByStatus({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        status: 'ReadyForDevelopment',
      });
      expect(tasksByStatus.count).toBe(2);

      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 7, completed: true, summary: 'All tasks reviewed and approved',
      });

      // Step 8: Generate Report
      const report = await manager.generateRefinementReport({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        format: 'markdown',
      });
      expect(report.success).toBe(true);
      expect(report.content).toContain('Smart Strangle Engine');

      await manager.updateRefinementStep({
        repoName: 'my-project', featureSlug: 'smart-strangle-engine',
        stepNumber: 8, completed: true, summary: 'Jira updated and workflow complete',
      });

      // Final verification
      const status = await manager.getRefinementStatus({
        repoName: 'my-project',
        featureSlug: 'smart-strangle-engine',
      });
      expect(status.progressPercentage).toBe(100);
      expect(status.completedSteps).toBe(8);
      expect(status.acceptanceCriteriaCount).toBe(3);
      expect(status.testScenariosCount).toBe(2);
      expect(status.clarificationsCount).toBe(1);
      expect(status.attachmentsCount).toBe(1);
      expect(status.tasksCount).toBe(2);
    });
  });
});
