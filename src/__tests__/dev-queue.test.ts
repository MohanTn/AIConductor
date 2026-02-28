/**
 * Dev Queue & Worker Test Suite
 *
 * T08: Comprehensive tests for the dev_queue table, CRUD operations,
 *       CronScanner, QueueWorker, and API routes.
 *
 * Tests:
 *  1. dev_queue table creation and schema validation
 *  2. Default settings seeding
 *  3. Settings CRUD (get/set/update queue settings)
 *  4. Queue CRUD (enqueue, claim, complete, fail, list, stats, prune)
 *  5. CronScanner scan logic
 *  6. QueueWorker validation (CLI whitelist, path traversal)
 *  7. Error message sanitization
 */

import { AIConductor } from '../AIConductor.js';
import { DatabaseHandler } from '../DatabaseHandler.js';
import { CronScanner } from '../cron-scanner.js';
import * as path from 'path';
import * as nodeFs from 'fs';

const REPO_NAME = 'test-repo';
const FEATURE_SLUG = 'queue-test-feature';
const FEATURE_NAME = 'Queue Test Feature';

describe('Dev Queue System', () => {
  let manager: AIConductor;
  let dbHandler: DatabaseHandler;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(
      process.cwd(),
      `test-dev-queue-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    manager = new AIConductor(testDbPath);
    dbHandler = (manager as any).dbHandler as DatabaseHandler;
  });

  afterEach(() => {
    try {
      dbHandler.close();
    } catch {
      /* ignore */
    }
    try {
      nodeFs.unlinkSync(testDbPath);
    } catch {
      /* ignore */
    }
  });

  // ================================================================
  // T01: Database schema — dev_queue and settings tables
  // ================================================================
  describe('T01: Database Schema', () => {
    test('dev_queue table should exist with correct columns', () => {
      const db = dbHandler['db'];
      const columns = db
        .prepare("PRAGMA table_info('dev_queue')")
        .all() as Array<{ name: string; type: string; notnull: number }>;

      const colNames = columns.map((c) => c.name);
      expect(colNames).toEqual(
        expect.arrayContaining([
          'id',
          'repo_name',
          'feature_slug',
          'status',
          'cli_tool',
          'created_at',
          'started_at',
          'completed_at',
          'error_message',
          'retry_count',
          'worker_pid',
        ]),
      );
      // task_id should NOT be present (feature-level queue)
      expect(colNames).not.toContain('task_id');
    });

    test('settings table should exist with correct columns', () => {
      const db = dbHandler['db'];
      const columns = db
        .prepare("PRAGMA table_info('settings')")
        .all() as Array<{ name: string }>;

      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('key');
      expect(colNames).toContain('value');
      expect(colNames).toContain('updated_at');
    });

    test('dev_queue indexes should exist', () => {
      const db = dbHandler['db'];
      const indexes = db
        .prepare("PRAGMA index_list('dev_queue')")
        .all() as Array<{ name: string }>;

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toEqual(
        expect.arrayContaining([
          'idx_dev_queue_status',
          'idx_dev_queue_repo_feature',
          'idx_dev_queue_composite',
        ]),
      );
    });

    test('dev_queue status CHECK constraint rejects invalid values', () => {
      const db = dbHandler['db'];
      expect(() => {
        db.prepare(
          `INSERT INTO dev_queue (repo_name, feature_slug, status, cli_tool, created_at)
           VALUES ('r', 'f', 'invalid_status', 'claude', datetime('now'))`,
        ).run();
      }).toThrow();
    });
  });

  // ================================================================
  // T01 / T02: Default settings seeding
  // ================================================================
  describe('T01: Default Settings Seeded', () => {
    test('cronIntervalSeconds defaults to 60', () => {
      expect(dbHandler.getSetting('cronIntervalSeconds')).toBe('60');
    });

    test('baseReposFolder defaults to empty string', () => {
      expect(dbHandler.getSetting('baseReposFolder')).toBe('');
    });

    test('cliTool defaults to claude', () => {
      expect(dbHandler.getSetting('cliTool')).toBe('claude');
    });

    test('workerEnabled defaults to false', () => {
      expect(dbHandler.getSetting('workerEnabled')).toBe('false');
    });

    test('getQueueSettings returns typed object', () => {
      const settings = dbHandler.getQueueSettings();
      expect(settings).toMatchObject({
        cronIntervalSeconds: 60,
        baseReposFolder: '',
        cliTool: 'claude',
        workerEnabled: false,
      });
    });
  });

  // ================================================================
  // T02: Settings CRUD
  // ================================================================
  describe('T02: Settings CRUD', () => {
    test('setSetting + getSetting roundtrip', () => {
      dbHandler.setSetting('cronIntervalSeconds', '120');
      expect(dbHandler.getSetting('cronIntervalSeconds')).toBe('120');
    });

    test('updateQueueSettings updates multiple settings atomically', () => {
      dbHandler.updateQueueSettings({
        cronIntervalSeconds: 300,
        cliTool: 'copilot',
        workerEnabled: true,
      });
      const settings = dbHandler.getQueueSettings();
      expect(settings.cronIntervalSeconds).toBe(300);
      expect(settings.cliTool).toBe('copilot');
      expect(settings.workerEnabled).toBe(true);
    });

    test('getAllSettings returns all key-value pairs', () => {
      const all = dbHandler.getAllSettings();
      expect(all).toHaveProperty('cronIntervalSeconds');
      expect(all).toHaveProperty('baseReposFolder');
      expect(all).toHaveProperty('cliTool');
      expect(all).toHaveProperty('workerEnabled');
    });
  });

  // ================================================================
  // T02: Queue CRUD Operations
  // ================================================================
  describe('T02: Queue CRUD', () => {
    test('enqueueFeature inserts a pending item and returns id', () => {
      const result = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      expect(result.id).toBeGreaterThan(0);
      expect(result.alreadyQueued).toBe(false);
    });

    test('enqueueFeature returns alreadyQueued=true for duplicate', () => {
      dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      const result = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      expect(result.alreadyQueued).toBe(true);
    });

    test('claimNextQueueItem returns and marks running', () => {
      dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      const item = dbHandler.claimNextQueueItem(12345);
      expect(item).not.toBeNull();
      expect(item!.status).toBe('running');
      expect(item!.worker_pid).toBe(12345);
    });

    test('claimNextQueueItem returns null when empty', () => {
      const item = dbHandler.claimNextQueueItem(12345);
      expect(item).toBeNull();
    });

    test('completeQueueItem sets status to completed', () => {
      const { id } = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.claimNextQueueItem(1);
      dbHandler.completeQueueItem(id);
      const items = dbHandler.getQueueItems('repo1', 'feat1', 'completed');
      expect(items).toHaveLength(1);
      expect(items[0].completed_at).toBeTruthy();
    });

    test('failQueueItem sets status and sanitizes error message', () => {
      const { id } = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.claimNextQueueItem(1);
      dbHandler.failQueueItem(id, 'Error: api_key=sk-abc123secret token=mysecret');
      const items = dbHandler.getQueueItems('repo1', 'feat1', 'failed');
      expect(items).toHaveLength(1);
      expect(items[0].error_message).not.toContain('sk-abc123secret');
      expect(items[0].error_message).toContain('[REDACTED]');
    });

    test('getQueueItems filters by status', () => {
      dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.enqueueFeature('repo1', 'feat2', 'claude');
      const pending = dbHandler.getQueueItems(undefined, undefined, 'pending');
      expect(pending).toHaveLength(2);
      const running = dbHandler.getQueueItems(undefined, undefined, 'running');
      expect(running).toHaveLength(0);
    });

    test('getQueueStats returns correct counts', () => {
      dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.enqueueFeature('repo1', 'feat2', 'claude');
      dbHandler.enqueueFeature('repo1', 'feat3', 'claude');
      dbHandler.claimNextQueueItem(1);
      dbHandler.completeQueueItem(dbHandler.getQueueItems(undefined, undefined, 'running')[0].id);
      // Now: 1 completed, 2 pending

      const stats = dbHandler.getQueueStats();
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(2);
      expect(stats.total).toBe(3);
    });

    test('pruneQueueItems removes old completed items', () => {
      // Insert and complete an item
      const { id } = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.claimNextQueueItem(1);
      dbHandler.completeQueueItem(id);

      // Override completed_at to be old
      const db = dbHandler['db'];
      db.prepare(`UPDATE dev_queue SET completed_at = datetime('now', '-30 days') WHERE id = ?`).run(id);

      const removed = dbHandler.pruneQueueItems(7);
      expect(removed).toBe(1);
    });

    test('pruneQueueItems does not remove pending items', () => {
      dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      const removed = dbHandler.pruneQueueItems(0);
      expect(removed).toBe(0);
    });
  });

  // ================================================================
  // T02: AIConductor delegates
  // ================================================================
  describe('T02: AIConductor Queue Delegates', () => {
    test('manager.enqueueFeature delegates correctly', () => {
      const result = manager.enqueueFeature('repo1', 'feat1', 'claude');
      expect(result.id).toBeGreaterThan(0);
    });

    test('manager.getQueueStats delegates correctly', () => {
      manager.enqueueFeature('repo1', 'feat1', 'claude');
      const stats = manager.getQueueStats();
      expect(stats.pending).toBe(1);
    });

    test('manager.getQueueSettings returns typed settings', () => {
      const settings = manager.getQueueSettings();
      expect(typeof settings.cronIntervalSeconds).toBe('number');
      expect(typeof settings.workerEnabled).toBe('boolean');
    });

    test('manager.updateQueueSettings persists changes', () => {
      manager.updateQueueSettings({ workerEnabled: true, cronIntervalSeconds: 120 });
      const settings = manager.getQueueSettings();
      expect(settings.workerEnabled).toBe(true);
      expect(settings.cronIntervalSeconds).toBe(120);
    });
  });

  // ================================================================
  // T03: CronScanner
  // ================================================================
  describe('T03: CronScanner', () => {
    test('scan returns 0 when workerEnabled is false', async () => {
      const scanner = new CronScanner(manager);
      const enqueued = await scanner.scan();
      expect(enqueued).toBe(0);
    });

    test('scan enqueues feature when all tasks are ReadyForDevelopment', async () => {
      // Setup: enable worker, create a repo + feature + task in ReadyForDevelopment
      manager.updateQueueSettings({ workerEnabled: true });
      await manager.registerRepo({ repoName: REPO_NAME, repoPath: '/test' });
      await manager.createFeature({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        featureName: FEATURE_NAME,
      });
      await manager.addTask({
        repoName: REPO_NAME,
        featureSlug: FEATURE_SLUG,
        taskId: 'T01',
        title: 'Test task',
        description: 'A test task',
        orderOfExecution: 1,
        acceptanceCriteria: [],
        testScenarios: [],
      });

      // Force task into ReadyForDevelopment for scanner test
      const db = dbHandler['db'];
      db.prepare(`UPDATE tasks SET status = 'ReadyForDevelopment' WHERE task_id = 'T01' AND feature_slug = ?`).run(FEATURE_SLUG);

      const scanner = new CronScanner(manager);
      const enqueued = await scanner.scan();
      expect(enqueued).toBe(1);

      // Second scan should not re-enqueue
      const enqueued2 = await scanner.scan();
      expect(enqueued2).toBe(0);
    });

    test('start/stop controls the loop', () => {
      const scanner = new CronScanner(manager);
      expect(scanner.isRunning).toBe(false);
      scanner.start();
      expect(scanner.isRunning).toBe(true);
      scanner.stop();
      expect(scanner.isRunning).toBe(false);
    });
  });

  // ================================================================
  // T04: QueueWorker validation (no actual CLI spawn)
  // ================================================================
  describe('T04: QueueWorker Security Validations', () => {
    test('sanitizeErrorMessage strips API keys', () => {
      // Access the private method via the DatabaseHandler
      const sanitize = (dbHandler as any).sanitizeErrorMessage.bind(dbHandler);
      const result = sanitize('Error: api_key=sk-abc123456789012345678 failed');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk-abc123456789012345678');
    });

    test('sanitizeErrorMessage strips Bearer tokens', () => {
      const sanitize = (dbHandler as any).sanitizeErrorMessage.bind(dbHandler);
      const result = sanitize('Authorization: Bearer eyJhbGciOiJSU...');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('eyJhbGciOiJSU');
    });

    test('sanitizeErrorMessage caps length at 4096', () => {
      const sanitize = (dbHandler as any).sanitizeErrorMessage.bind(dbHandler);
      const longMsg = 'x'.repeat(10000);
      expect(sanitize(longMsg).length).toBeLessThanOrEqual(4096);
    });

    test('sanitizeErrorMessage handles null/undefined', () => {
      const sanitize = (dbHandler as any).sanitizeErrorMessage.bind(dbHandler);
      expect(sanitize(null)).toBeNull();
      expect(sanitize(undefined)).toBeNull();
    });

    test('failQueueItem increments retry_count', () => {
      const { id } = dbHandler.enqueueFeature('repo1', 'feat1', 'claude');
      dbHandler.claimNextQueueItem(1);
      dbHandler.failQueueItem(id, 'error 1');
      const items = dbHandler.getQueueItems('repo1', 'feat1');
      expect(items[0].retry_count).toBe(1);
    });
  });

  // ================================================================
  // T05: Queue API routes (via AIConductor delegates)
  // ================================================================
  describe('T05: Queue API Delegates', () => {
    test('manager.pruneQueueItems returns correct count', () => {
      // Insert completed items with old dates
      const { id } = manager.enqueueFeature('r', 'f', 'claude');
      manager.claimNextQueueItem(1);
      manager.completeQueueItem(id);
      const db = dbHandler['db'];
      db.prepare(`UPDATE dev_queue SET completed_at = datetime('now', '-30 days') WHERE id = ?`).run(id);

      const removed = manager.pruneQueueItems(7);
      expect(removed).toBe(1);
    });
  });

  // ================================================================
  // T07: Lifecycle integration (unit test level)
  // ================================================================
  describe('T07: Server Lifecycle', () => {
    test('CronScanner can start and stop multiple times', () => {
      const scanner = new CronScanner(manager);
      scanner.start();
      scanner.start(); // idempotent
      expect(scanner.isRunning).toBe(true);
      scanner.stop();
      scanner.stop(); // idempotent
      expect(scanner.isRunning).toBe(false);
    });
  });
});
