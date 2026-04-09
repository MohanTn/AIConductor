/**
 * WorkflowValidator – unit tests
 *
 * Covers:
 *  - validate()    : approval/rejection for each of the 4 refinement roles
 *  - validate()    : terminal states (ReadyForDevelopment, NeedsRefinement)
 *  - validate()    : unknown status, wrong stakeholder
 *  - getExpectedStakeholder(), getAllowedTransitions(), isTerminalState()
 *  - getReviewProgress()
 *  - validateTaskStructure()
 *  - validateDevTransition() : developer, code-reviewer, QA paths
 *  - canActorTransition(), getDevAllowedTransitions()
 *  - Optimistic concurrency: ConcurrencyConflictError thrown on version mismatch
 */
import { WorkflowValidator } from '../WorkflowValidator.js';
import { ConcurrencyConflictError } from '../errors.js';
import { Task, TaskStatus, StakeholderRole } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'T01',
    title: 'Test task',
    description: 'A test task',
    status: 'InRefinement',
    acceptanceCriteria: [],
    testScenarios: [],
    outOfScope: [],
    dependencies: [],
    transitions: [],
    stakeholderReview: {},
    orderOfExecution: 1,
    tags: [],
    estimatedHours: 2,
    version: 1,
    ...overrides,
  };
}

// ─── WorkflowValidator – refinement workflow ──────────────────────────────────

describe('WorkflowValidator.validate()', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  // Happy-path: single-stage refinement (InRefinement → ReadyForDevelopment)
  // Note: Placeholder stakeholder 'productDirector' used since single-stage doesn't require role verification
  test('InRefinement + productDirector approve → ReadyForDevelopment', () => {
    const result = validator.validate('InRefinement', 'productDirector', 'approve');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.allowedTransitions).toContain('ReadyForDevelopment');
  });

  // Happy-path: single-stage refinement rejection
  test('InRefinement + productDirector reject → NeedsRefinement', () => {
    const result = validator.validate('InRefinement', 'productDirector', 'reject');
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/NeedsRefinement/);
  });

  // Wrong stakeholder (InRefinement has placeholder productDirector)
  test('wrong stakeholder returns invalid result with error', () => {
    const result = validator.validate('InRefinement', 'architect', 'approve');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Wrong stakeholder/);
    expect(result.errors[0]).toMatch(/productDirector/);
  });

  // Terminal states
  test('ReadyForDevelopment is terminal → invalid', () => {
    const result = validator.validate('ReadyForDevelopment', 'productDirector', 'approve');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/terminal/i);
  });

  test('NeedsRefinement is terminal → invalid', () => {
    const result = validator.validate('NeedsRefinement', 'productDirector', 'approve');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/NeedsRefinement/);
  });

  // Unknown status
  test('unknown status → invalid with no rule defined error', () => {
    const result = validator.validate('Done' as any, 'productDirector', 'approve');
    // WORKFLOW_RULES['Done'] is null, so no rule
    expect(result.valid).toBe(false);
  });
});

// ─── WorkflowValidator – utility methods ──────────────────────────────────────

describe('WorkflowValidator utility methods', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  describe('getExpectedStakeholder()', () => {
    test('InRefinement → productDirector (placeholder for single-stage)', () => {
      expect(validator.getExpectedStakeholder('InRefinement')).toBe('productDirector');
    });

    test('non-refinement status → null', () => {
      expect(validator.getExpectedStakeholder('Done')).toBeNull();
      expect(validator.getExpectedStakeholder('InProgress')).toBeNull();
      expect(validator.getExpectedStakeholder('ReadyForDevelopment')).toBeNull();
    });
  });

  describe('getAllowedTransitions()', () => {
    test('InRefinement has two transitions', () => {
      const transitions = validator.getAllowedTransitions('InRefinement');
      expect(transitions).toContain('ReadyForDevelopment');
      expect(transitions).toContain('NeedsRefinement');
    });

    test('unknown/terminal status returns empty array', () => {
      expect(validator.getAllowedTransitions('Done')).toHaveLength(0);
    });
  });

  describe('isTerminalState()', () => {
    test.each<TaskStatus>(['ReadyForDevelopment', 'Done'])(
      '%s is terminal',
      (status) => expect(validator.isTerminalState(status)).toBe(true)
    );

    test.each<TaskStatus>(['InRefinement', 'InProgress', 'InReview'])(
      '%s is NOT terminal',
      (status) => expect(validator.isTerminalState(status)).toBe(false)
    );
  });

  describe('getReviewProgress()', () => {
    test('fresh InRefinement task has no completed stakeholders', () => {
      const task = makeTask({ status: 'InRefinement' });
      const progress = validator.getReviewProgress(task);
      expect(progress.completed).toHaveLength(0);
      // Single-stage refinement has no specific currentStakeholder
      expect(progress.currentStakeholder).toBe(null);
    });

    test('task with productDirector approved shows it as completed', () => {
      const task = makeTask({
        status: 'InRefinement',
        stakeholderReview: {
          productDirector: { approved: true, notes: 'LGTM' },
        },
      });
      const progress = validator.getReviewProgress(task);
      expect(progress.completed).toContain('productDirector');
      // Single-stage refinement has no currentStakeholder
      expect(progress.currentStakeholder).toBe(null);
    });
  });

  describe('validateTaskStructure()', () => {
    test('valid task passes', () => {
      expect(validator.validateTaskStructure(makeTask()).valid).toBe(true);
    });

    test('missing taskId fails', () => {
      const result = validator.validateTaskStructure(makeTask({ taskId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /Task ID/i.test(e))).toBe(true);
    });

    test('missing title fails', () => {
      const result = validator.validateTaskStructure(makeTask({ title: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /title/i.test(e))).toBe(true);
    });

    test('negative estimatedHours fails', () => {
      const result = validator.validateTaskStructure(makeTask({ estimatedHours: -1 }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => /hours/i.test(e))).toBe(true);
    });
  });
});

// ─── WorkflowValidator – development workflow ────────────────────────────────

describe('WorkflowValidator.validateDevTransition()', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  test('developer InProgress → InReview is valid', () => {
    const result = validator.validateDevTransition('InProgress', 'InReview', 'developer');
    expect(result.valid).toBe(true);
  });

  test('codeReviewer InReview → InQA is valid', () => {
    const result = validator.validateDevTransition('InReview', 'InQA', 'codeReviewer');
    expect(result.valid).toBe(true);
  });

  test('qa InQA → Done is valid', () => {
    const result = validator.validateDevTransition('InQA', 'Done', 'qa');
    expect(result.valid).toBe(true);
  });

  test('codeReviewer InReview → NeedsChanges emits warning', () => {
    const result = validator.validateDevTransition('InReview', 'NeedsChanges', 'codeReviewer');
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => /changes/i.test(w))).toBe(true);
  });

  test('wrong actor is invalid', () => {
    const result = validator.validateDevTransition('InProgress', 'InReview', 'qa');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not allowed/);
  });

  test('invalid target status is invalid', () => {
    const result = validator.validateDevTransition('InProgress', 'Done', 'developer');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid transition/);
  });

  test('unknown source status is invalid', () => {
    const result = validator.validateDevTransition('ReadyForDevelopment' as any, 'Done', 'developer');
    expect(result.valid).toBe(false);
  });
});

describe('WorkflowValidator.canActorTransition()', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  test('developer can act on InProgress', () => {
    expect(validator.canActorTransition('InProgress', 'developer')).toBe(true);
  });

  test('qa cannot act on InProgress', () => {
    expect(validator.canActorTransition('InProgress', 'qa')).toBe(false);
  });

  test('system can act on ToDo', () => {
    expect(validator.canActorTransition('ToDo', 'system')).toBe(true);
  });

  test('Done status has no allowed actors → false', () => {
    expect(validator.canActorTransition('Done', 'developer')).toBe(false);
  });
});

// ─── Optimistic concurrency ───────────────────────────────────────────────────
// Note: the full integration test (two concurrent DatabaseHandler saves) lives
// in a separate integration test file that runs with NODE_OPTIONS=--experimental-vm-modules
// because DatabaseHandler uses import.meta.url which requires native ESM.

describe('ConcurrencyConflictError', () => {
  test('has statusCode 409 and informative message', () => {
    const err = new ConcurrencyConflictError('T01', 1, 2);
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('ConcurrencyConflictError');
    expect(err.message).toMatch(/T01/);
    expect(err.message).toMatch(/version 1/);
    expect(err.message).toMatch(/version 2/);
    expect(err).toBeInstanceOf(Error);
  });

  test('is detectable via instanceof', () => {
    const err = new ConcurrencyConflictError('T02', 3, 5);
    expect(err instanceof ConcurrencyConflictError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  test('message contains reload instruction', () => {
    const err = new ConcurrencyConflictError('T03', 2, 3);
    expect(err.message).toMatch(/Reload/i);
  });
});
