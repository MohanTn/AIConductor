/**
 * Multi-Repo Support Test Suite
 * 
 * Tests multi-repo isolation, refinement workflow, and dashboard integration
 */

import { AIConductor } from '../AIConductor.js';
import { DatabaseHandler } from '../DatabaseHandler.js';
import * as path from 'path';
import * as fs from 'fs-extra';

describe('Multi-Repo Support', () => {
  let manager: AIConductor;
  let dbHandler: DatabaseHandler;
  let testDbPath: string;

  beforeEach(() => {
    // Create unique database file for each test
    testDbPath = path.join(process.cwd(), `test-multirepo-${Date.now()}-${Math.random()}.db`);
    
    // Create new manager with test database
    manager = new AIConductor(testDbPath);
    dbHandler = manager['dbHandler'];
    
    // Migration is applied automatically by DatabaseHandler constructor
  });

  afterEach(() => {
    // Close database connections
    try {
      dbHandler.close();
    } catch (e) {
      // Ignore errors
    }
  });

  describe('Repository Management', () => {
    test('should register a new repository', async () => {
      const result = await manager.registerRepo({
        repoName: 'test-repo-1',
        repoPath: '/test/path',
        metadata: {
          owner: 'test-user',
          url: 'https://github.com/test/repo1'
        }
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('test-repo-1');
    });

    test('should list all repositories', async () => {
      // Register multiple repos
      await manager.registerRepo({ repoName: 'repo-a', repoPath: '/path/a' });
      await manager.registerRepo({ repoName: 'repo-b', repoPath: '/path/b' });
      await manager.registerRepo({ repoName: 'repo-c', repoPath: '/path/c' });

      const result = await manager.listRepos();
      
      expect(result.success).toBe(true);
      expect(result.repos.length).toBeGreaterThanOrEqual(4); // 3 + default
      
      const repoNames = result.repos.map(r => r.repoName);
      expect(repoNames).toContain('default');
      expect(repoNames).toContain('repo-a');
      expect(repoNames).toContain('repo-b');
      expect(repoNames).toContain('repo-c');
    });

    test('should prevent duplicate repository registration', async () => {
      await manager.registerRepo({ repoName: 'test-repo', repoPath: '/test' });
      const result = await manager.registerRepo({ repoName: 'test-repo', repoPath: '/test2' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });
  });

  describe('Multi-Repo Isolation', () => {
    test('features should be isolated between repos', async () => {
      // Register repos first
      await manager.registerRepo({ repoName: 'repo-1', repoPath: '/test/repo-1' });
      await manager.registerRepo({ repoName: 'repo-2', repoPath: '/test/repo-2' });

      // Create features in different repos with different slugs
      // (Note: Due to existing schema constraint, feature_slug is still unique globally)
      dbHandler.createFeature('feature-repo1', 'Feature 1', 'repo-1');
      dbHandler.createFeature('feature-repo2', 'Feature 1 in Repo 2', 'repo-2');

      // Verify isolation
      const repo1Features = dbHandler.getAllFeatures('repo-1');
      const repo2Features = dbHandler.getAllFeatures('repo-2');

      expect(repo1Features.length).toBe(1);
      expect(repo2Features.length).toBe(1);
      expect(repo1Features[0].featureName).toBe('Feature 1');
      expect(repo2Features[0].featureName).toBe('Feature 1 in Repo 2');
    });

    test('tasks should be isolated between repos', async () => {
      // Register repos first
      await manager.registerRepo({ repoName: 'repo-1', repoPath: '/test/repo-1' });
      await manager.registerRepo({ repoName: 'repo-2', repoPath: '/test/repo-2' });

      // Create features in different repos
      dbHandler.createFeature('feature-repo1', 'Feature 1', 'repo-1');
      dbHandler.createFeature('feature-repo2', 'Feature 1', 'repo-2');

      // Add tasks to both
      const task1 = {
        taskId: 'T01',
        title: 'Task in Repo 1',
        description: 'Description 1',
        status: 'ToDo',
        orderOfExecution: 1,
        estimatedHours: 2,
        acceptanceCriteria: []
      };

      const task2 = {
        taskId: 'T01', // Same ID, different repo
        title: 'Task in Repo 2',
        description: 'Description 2',
        status: 'InProgress',
        orderOfExecution: 1,
        estimatedHours: 3,
        acceptanceCriteria: []
      };

      dbHandler.addTask('feature-repo1', task1 as any, 'repo-1');
      dbHandler.addTask('feature-repo2', task2 as any, 'repo-2');

      // Verify isolation
      const repo1Data = await dbHandler.loadByFeatureSlug('feature-repo1', 'repo-1');
      const repo2Data = await dbHandler.loadByFeatureSlug('feature-repo2', 'repo-2');

      expect(repo1Data.tasks.length).toBe(1);
      expect(repo2Data.tasks.length).toBe(1);
      expect(repo1Data.tasks[0].title).toBe('Task in Repo 1');
      expect(repo1Data.tasks[0].status).toBe('ToDo');
      expect(repo2Data.tasks[0].title).toBe('Task in Repo 2');
      expect(repo2Data.tasks[0].status).toBe('InProgress');
    });

    test('should handle task updates in isolated repos', async () => {
      // Register repos first
      await manager.registerRepo({ repoName: 'repo-1', repoPath: '/test/repo-1' });
      await manager.registerRepo({ repoName: 'repo-2', repoPath: '/test/repo-2' });

      // Create features in different repos
      dbHandler.createFeature('feature-update1', 'Feature 1', 'repo-1');
      dbHandler.createFeature('feature-update2', 'Feature 1', 'repo-2');

      // Add tasks
      const task = {
        taskId: 'T01',
        title: 'Original Task',
        description: 'Description',
        status: 'ToDo',
        orderOfExecution: 1,
        estimatedHours: 2,
        acceptanceCriteria: []
      };

      dbHandler.addTask('feature-update1', task as any, 'repo-1');
      dbHandler.addTask('feature-update2', task as any, 'repo-2');

      // Update task in repo-1 only
      await manager.updateTask({
        repoName: 'repo-1',
        featureSlug: 'feature-update1',
        taskId: 'T01',
        updates: {
          title: 'Updated in Repo 1',
          estimatedHours: 5
        }
      });

      // Verify repo-1 was updated
      const repo1Data = await dbHandler.loadByFeatureSlug('feature-update1', 'repo-1');
      expect(repo1Data.tasks[0].title).toBe('Updated in Repo 1');
      expect(repo1Data.tasks[0].estimatedHours).toBe(5);

      // Verify repo-2 unchanged
      const repo2Data = await dbHandler.loadByFeatureSlug('feature-update2', 'repo-2');
      expect(repo2Data.tasks[0].title).toBe('Original Task');
      expect(repo2Data.tasks[0].estimatedHours).toBe(2);
    });

    test('should handle task deletion in isolated repos', async () => {
      // Register repos first
      await manager.registerRepo({ repoName: 'repo-1', repoPath: '/test/repo-1' });
      await manager.registerRepo({ repoName: 'repo-2', repoPath: '/test/repo-2' });

      // Create features in different repos
      dbHandler.createFeature('feature-delete1', 'Feature 1', 'repo-1');
      dbHandler.createFeature('feature-delete2', 'Feature 1', 'repo-2');

      // Add tasks
      const task = {
        taskId: 'T01',
        title: 'Task',
        description: 'Description',
        status: 'ToDo',
        orderOfExecution: 1,
        estimatedHours: 2,
        acceptanceCriteria: []
      };

      dbHandler.addTask('feature-delete1', task as any, 'repo-1');
      dbHandler.addTask('feature-delete2', task as any, 'repo-2');

      // Delete from repo-1 only
      await manager.deleteTask('repo-1', 'feature-delete1', 'T01');

      // Verify repo-1 deleted
      const repo1Data = await dbHandler.loadByFeatureSlug('feature-delete1', 'repo-1');
      expect(repo1Data.tasks.length).toBe(0);

      // Verify repo-2 still has task
      const repo2Data = await dbHandler.loadByFeatureSlug('feature-delete2', 'repo-2');
      expect(repo2Data.tasks.length).toBe(1);
    });
  });

  describe('Basic Refinement Workflow', () => {
    beforeEach(async () => {
      // Register test-repo before each test
      await manager.registerRepo({ repoName: 'test-repo', repoPath: '/test/test-repo' });
    });

    test('should create feature with refinement steps initialized', async () => {
      const result = await manager.createFeature({
        repoName: 'test-repo',
        featureSlug: 'refinement-test',
        featureName: 'Refinement Test Feature'
      });

      expect(result.success).toBe(true);

      // Check that refinement steps were initialized
      const steps = dbHandler.getRefinementSteps('test-repo', 'refinement-test');
      expect(steps.length).toBe(8);
    });

    test('should update refinement step status', async () => {
      await manager.createFeature({
        repoName: 'test-repo',
        featureSlug: 'refinement-test',
        featureName: 'Test'
      });

      const result = await manager.updateRefinementStep({
        repoName: 'test-repo',
        featureSlug: 'refinement-test',
        stepNumber: 1,
        completed: true,
        summary: 'Completed step 1'
      });

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
    });

    test('should add feature-level acceptance criteria', async () => {
      await manager.createFeature({
        repoName: 'test-repo',
        featureSlug: 'ac-test',
        featureName: 'AC Test'
      });

      const result = await manager.addFeatureAcceptanceCriteria({
        repoName: 'test-repo',
        featureSlug: 'ac-test',
        criteria: [
          { criterionId: 'AC-1', criterion: 'Must have login', priority: 'Must Have' },
          { criterionId: 'AC-2', criterion: 'Should have logout', priority: 'Should Have' }
        ]
      });

      expect(result.success).toBe(true);

      const criteria = dbHandler.getFeatureAcceptanceCriteria('test-repo', 'ac-test');
      expect(criteria.length).toBe(2);
      expect(criteria[0].criterion).toBe('Must have login');
    });

    test('should get refinement status', async () => {
      await manager.createFeature({
        repoName: 'test-repo',
        featureSlug: 'status-test',
        featureName: 'Status Test'
      });

      // Complete some steps
      await manager.updateRefinementStep({
        repoName: 'test-repo',
        featureSlug: 'status-test',
        stepNumber: 1,
        completed: true,
        summary: 'Done'
      });

      await manager.updateRefinementStep({
        repoName: 'test-repo',
        featureSlug: 'status-test',
        stepNumber: 2,
        completed: true,
        summary: 'Done'
      });

      const result = await manager.getRefinementStatus({
        repoName: 'test-repo',
        featureSlug: 'status-test'
      });

      expect(result.success).toBe(true);
      expect(result.completedSteps).toBe(2);
      expect(result.totalSteps).toBe(8);
      expect(result.progressPercentage).toBe(25);
    });

    test('should generate refinement report', async () => {
      await manager.createFeature({
        repoName: 'test-repo',
        featureSlug: 'report-test',
        featureName: 'Report Test Feature'
      });

      await manager.updateRefinementStep({
        repoName: 'test-repo',
        featureSlug: 'report-test',
        stepNumber: 1,
        completed: true,
        summary: 'Step 1 complete'
      });

      const result = await manager.generateRefinementReport({
        repoName: 'test-repo',
        featureSlug: 'report-test',
        format: 'markdown'
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Report Test Feature');
      expect(result.content).toContain('Step 1 complete');
    });
  });

  describe('Cross-Repo Operations', () => {
    test('should handle multiple repos with different features', async () => {
      // Create features in different repos
      for (const repo of ['repo-1', 'repo-2', 'repo-3']) {
        await manager.registerRepo({ repoName: repo, repoPath: `/test/${repo}` });
        dbHandler.createFeature(`feature-${repo}`, `Feature in ${repo}`, repo);
      }

      const result = await manager.listRepos();
      
      const repo1 = result.repos.find(r => r.repoName === 'repo-1');
      const repo2 = result.repos.find(r => r.repoName === 'repo-2');
      const repo3 = result.repos.find(r => r.repoName === 'repo-3');

      expect(repo1?.featureCount).toBe(1);
      expect(repo2?.featureCount).toBe(1);
      expect(repo3?.featureCount).toBe(1);
    });

    test('should track repo statistics correctly', async () => {
      await manager.registerRepo({ repoName: 'stats-test', repoPath: '/stats/test' });
      
      // Create features and tasks
      dbHandler.createFeature('feature-1', 'Feature 1', 'stats-test');
      dbHandler.createFeature('feature-2', 'Feature 2', 'stats-test');
      
      dbHandler.addTask('feature-1', {
        taskId: 'T01',
        title: 'Task 1',
        description: 'Desc',
        status: 'ToDo',
        orderOfExecution: 1,
        estimatedHours: 2,
        acceptanceCriteria: []
      } as any, 'stats-test');

      dbHandler.addTask('feature-2', {
        taskId: 'T02', // Different task ID
        title: 'Task 2',
        description: 'Desc',
        status: 'Done',
        orderOfExecution: 1,
        estimatedHours: 3,
        acceptanceCriteria: []
      } as any, 'stats-test');

      const result = await manager.listRepos();
      const statsRepo = result.repos.find(r => r.repoName === 'stats-test');

      expect(statsRepo?.featureCount).toBe(2);
      expect(statsRepo?.totalTasks).toBe(2);
    });
  });
});
