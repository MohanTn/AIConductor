/**
 * Unit tests for all handler classes
 * Covers CRUD operations and state management for:
 * - FeatureHandler (feature metadata)
 * - TaskHandler (task operations)
 * - RepoHandler (repository management)
 * - SettingsHandler (application settings)
 * - RefinementHandler (refinement tracking)
 * - ReviewHandler (stakeholder reviews)
 * - TransitionHandler (task transitions)
 * - QueueHandler (background task queue)
 * - BaseHandler (base class)
 */

import {
  FeatureHandler,
  TaskHandler,
  RepoHandler,
  SettingsHandler,
  RefinementHandler,
  ReviewHandler,
  TransitionHandler,
  QueueHandler,
  BaseHandler,
} from '../handlers/index.js';
import { ValidationError, NotFoundError } from '../errors.js';

// Mock database setup
const createMockDb = () => {
  const mockStmt = {
    run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 123 }),
    all: jest.fn().mockReturnValue([]),
    get: jest.fn().mockReturnValue(undefined),
  };

  return {
    prepare: jest.fn().mockReturnValue(mockStmt),
    mockStmt,
  };
};

describe('BaseHandler', () => {
  test('constructor sets db property', () => {
    const mockDb = createMockDb();
    const handler = new BaseHandler(mockDb);
    expect(handler['db']).toBe(mockDb);
  });
});

describe('FeatureHandler', () => {
  let handler: FeatureHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new FeatureHandler(mockDb);
  });

  test('createFeature with valid parameters', () => {
    const result = handler.createFeature('default', 'my-feature', 'My Feature', 'Description', 'Intention');
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO features'));
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'my-feature', 'My Feature', 'Description', 'Intention');
    expect(result).toEqual({
      repoName: 'default',
      featureSlug: 'my-feature',
      featureName: 'My Feature',
      description: 'Description',
      intention: 'Intention',
    });
  });

  test('createFeature throws ValidationError when slug missing', () => {
    expect(() => handler.createFeature('default', '', 'Name')).toThrow(ValidationError);
  });

  test('createFeature throws ValidationError when name missing', () => {
    expect(() => handler.createFeature('default', 'slug', '')).toThrow(ValidationError);
  });

  test('getAllFeatures returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    const result = handler.getAllFeatures('default');
    expect(result).toEqual([]);
  });

  test('getAllFeatures returns feature list', () => {
    const features = [{ feature_slug: 'f1' }, { feature_slug: 'f2' }];
    mockDb.mockStmt.all.mockReturnValue(features);
    const result = handler.getAllFeatures('default');
    expect(result).toEqual(features);
  });

  test('getFeature returns feature or null', () => {
    mockDb.mockStmt.get.mockReturnValue({ feature_slug: 'f1' });
    let result = handler.getFeature('default', 'f1');
    expect(result).toEqual({ feature_slug: 'f1' });

    mockDb.mockStmt.get.mockReturnValue(null);
    result = handler.getFeature('default', 'f1');
    expect(result).toBeNull();
  });

  test('updateFeature throws NotFoundError when feature not found', () => {
    mockDb.mockStmt.get.mockReturnValue(null);
    expect(() => handler.updateFeature('default', 'f1', {})).toThrow(NotFoundError);
  });

  test('updateFeature updates existing feature', () => {
    mockDb.mockStmt.get.mockReturnValue({ feature_slug: 'f1', feature_name: 'Old' });
    const result = handler.updateFeature('default', 'f1', { feature_name: 'New' });
    expect(mockDb.mockStmt.run).toHaveBeenCalled();
    expect(result.feature_name).toBe('New');
  });

  test('deleteFeature throws NotFoundError when feature not found', () => {
    mockDb.mockStmt.get.mockReturnValue(null);
    expect(() => handler.deleteFeature('default', 'f1')).toThrow(NotFoundError);
  });

  test('deleteFeature deletes existing feature', () => {
    mockDb.mockStmt.get.mockReturnValue({ feature_slug: 'f1' });
    handler.deleteFeature('default', 'f1');
    expect(mockDb.mockStmt.run).toHaveBeenCalled();
  });
});

describe('TaskHandler', () => {
  let handler: TaskHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new TaskHandler(mockDb);
  });

  test('createTask with valid parameters', () => {
    const result = handler.createTask('default', 'f1', 'T01', 'Task 1', 'Description');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'f1', 'T01', 'Task 1', 'Description', 'PendingProductDirector');
    expect(result.status).toBe('PendingProductDirector');
  });

  test('createTask throws ValidationError when taskId missing', () => {
    expect(() => handler.createTask('default', 'f1', '', 'Title', 'Desc')).toThrow(ValidationError);
  });

  test('createTask throws ValidationError when title missing', () => {
    expect(() => handler.createTask('default', 'f1', 'T01', '', 'Desc')).toThrow(ValidationError);
  });

  test('getAllTasks returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    const result = handler.getAllTasks('default', 'f1');
    expect(result).toEqual([]);
  });

  test('getAllTasks returns task list ordered by execution', () => {
    const tasks = [{ task_id: 'T01', order_of_execution: 1 }];
    mockDb.mockStmt.all.mockReturnValue(tasks);
    const result = handler.getAllTasks('default', 'f1');
    expect(result).toEqual(tasks);
  });

  test('getTask returns task or null', () => {
    mockDb.mockStmt.get.mockReturnValue({ task_id: 'T01' });
    let result = handler.getTask('default', 'f1', 'T01');
    expect(result).toEqual({ task_id: 'T01' });

    mockDb.mockStmt.get.mockReturnValue(null);
    result = handler.getTask('default', 'f1', 'T01');
    expect(result).toBeNull();
  });

  test('updateTask throws NotFoundError when task not found', () => {
    mockDb.mockStmt.get.mockReturnValue(null);
    expect(() => handler.updateTask('default', 'f1', 'T01', {})).toThrow(NotFoundError);
  });

  test('updateTask updates existing task', () => {
    mockDb.mockStmt.get.mockReturnValue({ task_id: 'T01', status: 'InRefinement' });
    const result = handler.updateTask('default', 'f1', 'T01', { status: 'Done' });
    expect(mockDb.mockStmt.run).toHaveBeenCalled();
    expect(result.status).toBe('Done');
  });
});

describe('RepoHandler', () => {
  let handler: RepoHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new RepoHandler(mockDb);
  });

  test('registerRepo with all parameters', () => {
    const result = handler.registerRepo('my-repo', '/path/to/repo', 'https://github.com/user/repo', 'develop');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('my-repo', '/path/to/repo', 'https://github.com/user/repo', 'develop');
    expect(result.repoName).toBe('my-repo');
  });

  test('registerRepo with default branch', () => {
    handler.registerRepo('repo', '/path', 'https://git.com/repo');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('repo', '/path', 'https://git.com/repo', 'main');
  });

  test('registerRepo throws ValidationError when name missing', () => {
    expect(() => handler.registerRepo('', '/path')).toThrow(ValidationError);
  });

  test('getAllRepos returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getAllRepos()).toEqual([]);
  });

  test('getAllRepos returns repo list', () => {
    const repos = [{ repo_name: 'r1' }];
    mockDb.mockStmt.all.mockReturnValue(repos);
    expect(handler.getAllRepos()).toEqual(repos);
  });

  test('getRepo returns repo or null', () => {
    mockDb.mockStmt.get.mockReturnValue({ repo_name: 'r1' });
    let result = handler.getRepo('r1');
    expect(result).toEqual({ repo_name: 'r1' });

    mockDb.mockStmt.get.mockReturnValue(null);
    result = handler.getRepo('r1');
    expect(result).toBeNull();
  });
});

describe('SettingsHandler', () => {
  let handler: SettingsHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new SettingsHandler(mockDb);
  });

  test('getSetting returns value', () => {
    mockDb.mockStmt.get.mockReturnValue({ value: 'test-value' });
    expect(handler.getSetting('key1')).toBe('test-value');
  });

  test('getSetting returns null when not found', () => {
    mockDb.mockStmt.get.mockReturnValue(null);
    expect(handler.getSetting('key1')).toBeNull();
  });

  test('setSetting stores string value', () => {
    handler.setSetting('key1', 'value1');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('key1', 'value1');
  });

  test('setSetting serializes object value', () => {
    handler.setSetting('config', { nested: 'value' });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('config', '{"nested":"value"}');
  });

  test('getAllSettings returns empty record', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getAllSettings()).toEqual({});
  });

  test('getAllSettings parses JSON values', () => {
    mockDb.mockStmt.all.mockReturnValue([
      { key: 'str', value: 'string-value' },
      { key: 'obj', value: '{"nested":"value"}' },
    ]);
    const result = handler.getAllSettings();
    expect(result.str).toBe('string-value');
    expect(result.obj).toEqual({ nested: 'value' });
  });

  test('getAllSettings handles invalid JSON gracefully', () => {
    mockDb.mockStmt.all.mockReturnValue([
      { key: 'invalid', value: 'not-json' },
    ]);
    const result = handler.getAllSettings();
    expect(result.invalid).toBe('not-json');
  });

  test('getRolePrompt returns prompt or null', () => {
    mockDb.mockStmt.get.mockReturnValue({ prompt: 'Role prompt text' });
    expect(handler.getRolePrompt('productDirector')).toBe('Role prompt text');

    mockDb.mockStmt.get.mockReturnValue(null);
    expect(handler.getRolePrompt('productDirector')).toBeNull();
  });

  test('setRolePrompt stores prompt', () => {
    handler.setRolePrompt('productDirector', 'New prompt');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('productDirector', 'New prompt');
  });
});

describe('RefinementHandler', () => {
  let handler: RefinementHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new RefinementHandler(mockDb);
  });

  test('updateRefinementStep stores step data', () => {
    handler.updateRefinementStep('default', 'f1', 1, true, 'Step 1 complete', { key: 'value' });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith(
      'default',
      'f1',
      1,
      1, // true as 1
      'Step 1 complete',
      '{"key":"value"}'
    );
  });

  test('updateRefinementStep without data', () => {
    handler.updateRefinementStep('default', 'f1', 1, false, 'Step pending');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'f1', 1, 0, 'Step pending', null);
  });

  test('getRefinementSteps returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getRefinementSteps('default', 'f1')).toEqual([]);
  });

  test('getRefinementSteps returns steps', () => {
    const steps = [{ step_number: 1, completed: 1 }];
    mockDb.mockStmt.all.mockReturnValue(steps);
    expect(handler.getRefinementSteps('default', 'f1')).toEqual(steps);
  });

  test('saveCheckpoint saves checkpoint', () => {
    handler.saveCheckpoint('default', 'f1', 'After refinement');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'f1', 'After refinement');
  });

  test('getCheckpoints returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getCheckpoints('default', 'f1')).toEqual([]);
  });

  test('getCheckpoints returns checkpoints', () => {
    const checkpoints = [{ id: 1, description: 'cp1' }];
    mockDb.mockStmt.all.mockReturnValue(checkpoints);
    expect(handler.getCheckpoints('default', 'f1')).toEqual(checkpoints);
  });
});

describe('ReviewHandler', () => {
  let handler: ReviewHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new ReviewHandler(mockDb);
  });

  test('recordReview stores review', () => {
    handler.recordReview('default', 'f1', 'T01', 'productDirector', 'approve', 'Good work', { score: 5 });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith(
      'default',
      'f1',
      'T01',
      'productDirector',
      'approve',
      'Good work',
      '{"score":5}'
    );
  });

  test('recordReview without additionalData', () => {
    handler.recordReview('default', 'f1', 'T01', 'architect', 'reject', 'Needs work');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'f1', 'T01', 'architect', 'reject', 'Needs work', null);
  });

  test('getReviews returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getReviews('default', 'f1', 'T01')).toEqual([]);
  });

  test('getReviews returns reviews', () => {
    const reviews = [{ stakeholder: 'productDirector', decision: 'approve' }];
    mockDb.mockStmt.all.mockReturnValue(reviews);
    expect(handler.getReviews('default', 'f1', 'T01')).toEqual(reviews);
  });

  test('getReviewByStakeholder returns review or null', () => {
    mockDb.mockStmt.get.mockReturnValue({ stakeholder: 'architect', decision: 'approve' });
    let result = handler.getReviewByStakeholder('default', 'f1', 'T01', 'architect');
    expect(result).toEqual({ stakeholder: 'architect', decision: 'approve' });

    mockDb.mockStmt.get.mockReturnValue(null);
    result = handler.getReviewByStakeholder('default', 'f1', 'T01', 'architect');
    expect(result).toBeNull();
  });
});

describe('TransitionHandler', () => {
  let handler: TransitionHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new TransitionHandler(mockDb);
  });

  test('recordTransition stores transition', () => {
    handler.recordTransition('default', 'f1', 'T01', 'InRefinement', 'Done', 'developer', 'Work complete', { effort: 8 });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith(
      'default',
      'f1',
      'T01',
      'InRefinement',
      'Done',
      'developer',
      'Work complete',
      '{"effort":8}'
    );
  });

  test('recordTransition without notes and metadata', () => {
    handler.recordTransition('default', 'f1', 'T01', 'InRefinement', 'Done', 'developer');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('default', 'f1', 'T01', 'InRefinement', 'Done', 'developer', null, null);
  });

  test('getTransitionHistory returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getTransitionHistory('default', 'f1', 'T01')).toEqual([]);
  });

  test('getTransitionHistory returns transitions', () => {
    const transitions = [{ from_status: 'InRefinement', to_status: 'Done' }];
    mockDb.mockStmt.all.mockReturnValue(transitions);
    expect(handler.getTransitionHistory('default', 'f1', 'T01')).toEqual(transitions);
  });
});

describe('QueueHandler', () => {
  let handler: QueueHandler;
  let mockDb: any;

  beforeEach(() => {
    const mock = createMockDb();
    mockDb = mock;
    handler = new QueueHandler(mockDb);
  });

  test('enqueueTask with default priority', () => {
    mockDb.mockStmt.run.mockReturnValue({ lastInsertRowid: 456 });
    const id = handler.enqueueTask('export-pdf', { featureSlug: 'f1' });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('export-pdf', '{"featureSlug":"f1"}', 5, 'pending');
    expect(id).toBe('456');
  });

  test('enqueueTask with custom priority', () => {
    handler.enqueueTask('export-pdf', { featureSlug: 'f1' }, 9);
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('export-pdf', '{"featureSlug":"f1"}', 9, 'pending');
  });

  test('getPendingTasks returns empty array', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    expect(handler.getPendingTasks()).toEqual([]);
  });

  test('getPendingTasks returns tasks with limit', () => {
    const tasks = [{ id: 1, task_type: 'export-pdf' }];
    mockDb.mockStmt.all.mockReturnValue(tasks);
    expect(handler.getPendingTasks(20)).toEqual(tasks);
    expect(mockDb.mockStmt.all).toHaveBeenCalledWith(20);
  });

  test('markProcessed updates queue item', () => {
    handler.markProcessed(123, { status: 'success' });
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('{"status":"success"}', 123);
  });

  test('markProcessed without result', () => {
    handler.markProcessed(123);
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith(null, 123);
  });

  test('markFailed updates queue item with error', () => {
    handler.markFailed(123, 'Timeout');
    expect(mockDb.mockStmt.run).toHaveBeenCalledWith('Timeout', 123);
  });

  test('getQueueStats returns stats', () => {
    mockDb.mockStmt.all.mockReturnValue([
      { status: 'pending', count: 5 },
      { status: 'completed', count: 10 },
      { status: 'failed', count: 2 },
    ]);
    const stats = handler.getQueueStats();
    expect(stats.pending).toBe(5);
    expect(stats.completed).toBe(10);
    expect(stats.failed).toBe(2);
  });

  test('getQueueStats with empty results', () => {
    mockDb.mockStmt.all.mockReturnValue(null);
    const stats = handler.getQueueStats();
    expect(stats).toEqual({ pending: 0, completed: 0, failed: 0 });
  });
});
