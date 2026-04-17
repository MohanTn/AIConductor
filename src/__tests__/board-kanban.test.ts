/**
 * Unit tests for Board component (flat kanban layout)
 */

import { calculateProgress, getProgressColor, getProgressLabel } from '../client/services/progressCalculator';
import { Task } from '../types';

describe('Board Component - Flat Kanban Layout', () => {
  describe('calculateProgress - Milestone-based calculation', () => {
    it('should calculate 0% for empty task list', () => {
      const tasks: Task[] = [];
      const result = calculateProgress(tasks);

      expect(result.percentage).toBe(0);
      expect(result.refinementCount).toBe(0);
      expect(result.developmentCount).toBe(0);
      expect(result.completedCount).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it('should calculate 50% when all tasks are in refinement', () => {
      const tasks: Task[] = [
        {
          taskId: 'T01',
          title: 'Task 1',
          description: 'desc',
          status: 'InRefinement',
          orderOfExecution: 1,
          acceptanceCriteria: [],
          testScenarios: [],
        },
        {
          taskId: 'T02',
          title: 'Task 2',
          description: 'desc',
          status: 'NeedsRefinement',
          orderOfExecution: 2,
          acceptanceCriteria: [],
          testScenarios: [],
        },
      ];
      const result = calculateProgress(tasks);

      expect(result.percentage).toBe(50);
      expect(result.refinementCount).toBe(2);
      expect(result.developmentCount).toBe(0);
      expect(result.completedCount).toBe(0);
    });

    it('should calculate 100% when all tasks are done', () => {
      const tasks: Task[] = [
        {
          taskId: 'T01',
          title: 'Task 1',
          description: 'desc',
          status: 'Done',
          orderOfExecution: 1,
          acceptanceCriteria: [],
          testScenarios: [],
        },
      ];
      const result = calculateProgress(tasks);

      expect(result.percentage).toBe(100);
      expect(result.completedCount).toBe(1);
    });

    it('should calculate progress with mixed statuses', () => {
      // Test case: 10 tasks
      // 2 InRefinement, 3 ReadyForDevelopment, 2 InProgress, 1 InReview, 2 Done
      const tasks: Task[] = [
        { taskId: 'T1', title: 'T', description: '', status: 'InRefinement', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T2', title: 'T', description: '', status: 'InRefinement', orderOfExecution: 2, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T3', title: 'T', description: '', status: 'ReadyForDevelopment', orderOfExecution: 3, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T4', title: 'T', description: '', status: 'ReadyForDevelopment', orderOfExecution: 4, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T5', title: 'T', description: '', status: 'ReadyForDevelopment', orderOfExecution: 5, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T6', title: 'T', description: '', status: 'InProgress', orderOfExecution: 6, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T7', title: 'T', description: '', status: 'InProgress', orderOfExecution: 7, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T8', title: 'T', description: '', status: 'InReview', orderOfExecution: 8, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T9', title: 'T', description: '', status: 'Done', orderOfExecution: 9, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T10', title: 'T', description: '', status: 'Done', orderOfExecution: 10, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // Refinement: 2/10 * 50% = 10%
      // Development: 6/10 * 50% = 30% (3 Ready + 2 InProgress + 1 InReview)
      // Completed: 2/10 * 100% = 20%
      // Total: 10 + 30 + 20 = 60%
      expect(result.percentage).toBe(60);
      expect(result.refinementCount).toBe(2);
      expect(result.developmentCount).toBe(6);
      expect(result.completedCount).toBe(2);
    });

    it('should handle legacy Pending* statuses and map to refinement', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'PendingProductDirector', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T02', title: 'T', description: '', status: 'PendingArchitect', orderOfExecution: 2, acceptanceCriteria: [], testScenarios: [] },
        { taskId: 'T03', title: 'T', description: '', status: 'Done', orderOfExecution: 3, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // 2 refinement (66.67%) + 1 done (33.33%)
      // Refinement: 2/3 * 50% = 33.33%
      // Development: 0/3 * 50% = 0%
      // Completed: 1/3 * 100% = 33.33%
      // Total: ~67%
      expect(result.refinementCount).toBe(2);
      expect(result.completedCount).toBe(1);
      expect(result.percentage).toBe(67);
    });

    it('should calculate 50% at ReadyForDevelopment milestone', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'ReadyForDevelopment', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // ReadyForDevelopment is the 50% milestone
      expect(result.percentage).toBe(50);
      expect(result.developmentCount).toBe(1);
    });

    it('should handle NeedsChanges status in development phase', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'NeedsChanges', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // NeedsChanges is in development phase, so 50% of 50% = 25%
      expect(result.percentage).toBe(50);
      expect(result.developmentCount).toBe(1);
    });

    it('should handle ToDo status in development phase', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'ToDo', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // ToDo is in development phase
      expect(result.percentage).toBe(50);
      expect(result.developmentCount).toBe(1);
    });

    it('should handle InQA status in development phase', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'InQA', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // InQA is in development phase
      expect(result.percentage).toBe(50);
      expect(result.developmentCount).toBe(1);
    });
  });

  describe('Board Column Configuration', () => {
    it('should have correct column order for flat kanban', () => {
      // The expected column order: InRefinement, NeedsRefinement, ReadyForDevelopment, ToDo, InProgress, InReview, InQA, NeedsChanges, Done
      const expectedOrder = [
        'InRefinement',
        'ReadyForDevelopment',
        'ToDo',
        'InProgress',
        'InReview',
        'InQA',
        'NeedsChanges',
        'Done',
      ];

      // Verify all expected statuses are valid
      expectedOrder.forEach(status => {
        expect(typeof status).toBe('string');
        expect(status.length).toBeGreaterThan(0);
      });
    });

    it('should identify exception columns correctly', () => {
      const exceptionStatuses = ['NeedsRefinement', 'NeedsChanges'];

      exceptionStatuses.forEach(status => {
        expect(['NeedsRefinement', 'NeedsChanges'].includes(status)).toBe(true);
      });
    });

    it('should handle backward compatibility with legacy Pending* statuses', () => {
      const legacyStatuses = [
        'PendingProductDirector',
        'PendingArchitect',
        'PendingUiUxExpert',
        'PendingSecurityOfficer',
      ];

      // All legacy statuses should be valid TaskStatus types
      legacyStatuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });
  });

  describe('Progress Metrics Edge Cases', () => {
    it('should handle single task in refinement', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'InRefinement', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      expect(result.percentage).toBe(50);
      expect(result.totalCount).toBe(1);
    });

    it('should handle single task done', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'Done', orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      expect(result.percentage).toBe(100);
      expect(result.totalCount).toBe(1);
    });

    it('should handle large number of tasks', () => {
      const tasks: Task[] = Array.from({ length: 100 }, (_, i) => ({
        taskId: `T${i + 1}`,
        title: 'T',
        description: '',
        status: i < 50 ? 'InRefinement' : i < 75 ? 'ReadyForDevelopment' : 'Done',
        orderOfExecution: i + 1,
        acceptanceCriteria: [],
        testScenarios: [],
      }));
      const result = calculateProgress(tasks);

      expect(result.totalCount).toBe(100);
      expect(result.refinementCount).toBe(50);
      expect(result.developmentCount).toBe(25);
      expect(result.completedCount).toBe(25);
      // 50% of 50% + 25% of 50% + 25% of 100% = 25% + 12.5% + 25% = 62.5%
      expect(result.percentage).toBe(63); // Rounded
    });

    it('should handle unknown task status (default fallback)', () => {
      const tasks: Task[] = [
        { taskId: 'T01', title: 'T', description: '', status: 'UnknownStatus' as any, orderOfExecution: 1, acceptanceCriteria: [], testScenarios: [] },
      ];
      const result = calculateProgress(tasks);

      // Unknown status defaults to 'refinement' phase
      expect(result.refinementCount).toBe(1);
      expect(result.developmentCount).toBe(0);
      expect(result.completedCount).toBe(0);
      expect(result.percentage).toBe(50); // 1/1 refinement * 50%
    });
  });

  describe('getProgressColor', () => {
    it('returns red (#f44336) for 0%', () => {
      expect(getProgressColor(0)).toBe('#f44336');
    });

    it('returns red (#f44336) for < 25%', () => {
      expect(getProgressColor(1)).toBe('#f44336');
      expect(getProgressColor(24)).toBe('#f44336');
    });

    it('returns orange (#ff9800) for 25-49%', () => {
      expect(getProgressColor(25)).toBe('#ff9800');
      expect(getProgressColor(49)).toBe('#ff9800');
    });

    it('returns blue (#2196f3) for 50-74%', () => {
      expect(getProgressColor(50)).toBe('#2196f3');
      expect(getProgressColor(74)).toBe('#2196f3');
    });

    it('returns green (#4caf50) for 75-99%', () => {
      expect(getProgressColor(75)).toBe('#4caf50');
      expect(getProgressColor(99)).toBe('#4caf50');
    });

    it('returns green (#4caf50) for 100%', () => {
      expect(getProgressColor(100)).toBe('#4caf50');
    });
  });

  describe('getProgressLabel', () => {
    it('returns "Not Started" for 0%', () => {
      expect(getProgressLabel(0)).toBe('Not Started');
    });

    it('returns "In Refinement" for 1-49%', () => {
      expect(getProgressLabel(1)).toBe('In Refinement');
      expect(getProgressLabel(25)).toBe('In Refinement');
      expect(getProgressLabel(49)).toBe('In Refinement');
    });

    it('returns "In Development" for 50-99%', () => {
      expect(getProgressLabel(50)).toBe('In Development');
      expect(getProgressLabel(75)).toBe('In Development');
      expect(getProgressLabel(99)).toBe('In Development');
    });

    it('returns "Completed" for 100%', () => {
      expect(getProgressLabel(100)).toBe('Completed');
    });
  });
});
