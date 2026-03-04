/**
 * Tests for Presence Tracking Database Schema (T03)
 *
 * Tests cover:
 * - Presence record creation and updates
 * - TTL-based expiry and cleanup
 * - Database queries and indexing performance
 * - CRUD operations
 */

import { DatabaseHandler } from '../DatabaseHandler';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

describe('PresenceDatabase (T03)', () => {
  let dbHandler: DatabaseHandler;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-test-'));
    dbHandler = new DatabaseHandler(tempDir, path.join(tempDir, 'test.db'));
  });

  afterEach(() => {
    fs.removeSync(tempDir);
  });

  describe('Presence Table Schema', () => {
    test('should create reviewer_presence table with correct columns', () => {
      // Table exists and has correct schema
      const schema = (dbHandler as any).db.prepare(`
        PRAGMA table_info(reviewer_presence)
      `).all() as any[];

      const columns = schema.map(col => col.name);
      expect(columns).toContain('id');
      expect(columns).toContain('reviewer_id');
      expect(columns).toContain('status');
      expect(columns).toContain('current_feature');
      expect(columns).toContain('started_at');
      expect(columns).toContain('expires_at');
      expect(columns).toContain('created_at');
    });

    test('should have UNIQUE constraint on reviewer_id', () => {
      // Record presence twice for same reviewer
      dbHandler.recordPresence('user1', 'online', 'feature-x');

      const before = dbHandler.getActivePresence();
      expect(before.length).toBe(1);

      // Update presence (should not duplicate)
      dbHandler.recordPresence('user1', 'idle', 'feature-y');

      const after = dbHandler.getActivePresence();
      expect(after.length).toBe(1);
      expect(after[0].status).toBe('idle');
      expect(after[0].current_feature).toBe('feature-y');
    });
  });

  describe('Presence CRUD Operations', () => {
    test('AC-3: recordPresence stores reviewer presence with TTL', () => {
      dbHandler.recordPresence('user1', 'online', 'websocket-realtime-system', 30);

      const presence = dbHandler.getActivePresence();
      expect(presence.length).toBe(1);
      expect(presence[0].reviewer_id).toBe('user1');
      expect(presence[0].status).toBe('online');
      expect(presence[0].current_feature).toBe('websocket-realtime-system');
      expect(presence[0].expires_at).toBeGreaterThan(presence[0].started_at);
    });

    test('should allow updating presence for same reviewer', () => {
      dbHandler.recordPresence('user2', 'online', 'task-a');
      dbHandler.recordPresence('user2', 'idle', 'task-b');

      const presence = dbHandler.getActivePresence();
      const user2 = presence.find(p => p.reviewer_id === 'user2');

      expect(presence.length).toBe(1); // Still only 1 record for user2
      expect(user2?.status).toBe('idle');
      expect(user2?.current_feature).toBe('task-b');
    });

    test('should mark reviewer as offline', () => {
      dbHandler.recordPresence('user3', 'online', 'feature-x');
      dbHandler.markOffline('user3');

      const presence = dbHandler.getActivePresence();
      const user3 = presence.find(p => p.reviewer_id === 'user3');
      expect(user3?.status).toBe('offline');
    });

    test('should remove presence record', () => {
      dbHandler.recordPresence('user4', 'online', 'feature-x');
      expect(dbHandler.getActivePresence().length).toBe(1);

      dbHandler.removePresence('user4');
      expect(dbHandler.getActivePresence().length).toBe(0);
    });
  });

  describe('TTL Expiry & Cleanup', () => {
    test('TS-3: Presence records expire after TTL', () => {
      // Record presence with very short TTL (1 second for testing)
      dbHandler.recordPresence('user5', 'online', 'feature-x', 0.016); // ~1 second

      let activeAfterRecord = dbHandler.getActivePresence();
      expect(activeAfterRecord.length).toBe(1);

      // Wait for TTL to expire
      return new Promise((resolve) => {
        setTimeout(() => {
          // Cleanup should remove expired records
          const removed = dbHandler.cleanupExpiredPresence();
          expect(removed).toBeGreaterThan(0);

          const afterCleanup = dbHandler.getActivePresence();
          expect(afterCleanup.length).toBe(0);
          resolve(undefined);
        }, 1500);
      });
    });

    test('should not remove non-expired records during cleanup', () => {
      dbHandler.recordPresence('user6', 'online', 'feature-x', 30); // 30 minute TTL

      const removed = dbHandler.cleanupExpiredPresence();
      expect(removed).toBe(0);

      const presence = dbHandler.getActivePresence();
      expect(presence.length).toBe(1);
    });

    test('should handle cleanup with mixed expired and active records', () => {
      // Add active record
      dbHandler.recordPresence('active-user', 'online', 'feature-x', 30);

      // Add expired record (simulated by direct DB insert)
      const now = Math.floor(Date.now() / 1000);
      (dbHandler as any).db.prepare(`
        INSERT INTO reviewer_presence (reviewer_id, status, current_feature, started_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('expired-user', 'online', 'feature-y', now - 3600, now - 1000, new Date().toISOString());

      expect(dbHandler.getActivePresence().length).toBe(1);

      // Cleanup should only remove expired
      const removed = dbHandler.cleanupExpiredPresence();
      expect(removed).toBe(1);

      const presence = dbHandler.getActivePresence();
      expect(presence.length).toBe(1);
      expect(presence[0].reviewer_id).toBe('active-user');
    });
  });

  describe('Database Indexing', () => {
    test('should have indexes for efficient queries', () => {
      // Verify indexes exist
      const indexes = (dbHandler as any).db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reviewer_presence'
      `).all() as any[];

      const indexNames = indexes.map(idx => idx.name);
      expect(indexNames).toContain('idx_presence_reviewer');
      expect(indexNames).toContain('idx_presence_expiry');
      expect(indexNames).toContain('idx_presence_status');
    });

    test('should query active presence efficiently', () => {
      // Add multiple presence records
      for (let i = 0; i < 10; i++) {
        dbHandler.recordPresence(`user${i}`, 'online', `feature-${i}`);
      }

      const start = process.hrtime.bigint();
      const presence = dbHandler.getActivePresence();
      const end = process.hrtime.bigint();

      expect(presence.length).toBe(10);

      // Should be fast (< 10ms even with 10 records)
      const durationMs = Number(end - start) / 1e6;
      expect(durationMs).toBeLessThan(10);
    });
  });

  describe('Multi-User Scenarios', () => {
    test('should track multiple concurrent reviewers', () => {
      const reviewers = ['alice', 'bob', 'charlie', 'david'];
      const features = ['feature-a', 'feature-b', 'feature-c'];

      for (const reviewer of reviewers) {
        const feature = features[Math.floor(Math.random() * features.length)];
        dbHandler.recordPresence(reviewer, 'online', feature);
      }

      const presence = dbHandler.getActivePresence();
      expect(presence.length).toBe(4);
      expect(presence.map(p => p.reviewer_id)).toEqual(expect.arrayContaining(reviewers));
    });

    test('should get presence for specific feature', () => {
      dbHandler.recordPresence('alice', 'online', 'websocket-realtime-system');
      dbHandler.recordPresence('bob', 'online', 'dashboard-redesign');
      dbHandler.recordPresence('charlie', 'online', 'websocket-realtime-system');

      const allPresence = dbHandler.getActivePresence();
      const websocketReviewers = allPresence.filter(
        p => p.current_feature === 'websocket-realtime-system'
      );

      expect(websocketReviewers.length).toBe(2);
      expect(websocketReviewers.map(p => p.reviewer_id)).toEqual(
        expect.arrayContaining(['alice', 'charlie'])
      );
    });
  });

  describe('Acceptance Criteria', () => {
    test('AC-3: Presence recorded when user navigates to task/feature', () => {
      dbHandler.recordPresence('reviewer1', 'online', 'task-123');

      const presence = dbHandler.getActivePresence();
      expect(presence.length).toBe(1);
      expect(presence[0]).toMatchObject({
        reviewer_id: 'reviewer1',
        status: 'online',
        current_feature: 'task-123'
      });
    });

    test('AC-3: Presence includes started_at and expires_at with TTL', () => {
      const now = Math.floor(Date.now() / 1000);
      dbHandler.recordPresence('reviewer2', 'online', 'feature-x', 30);

      const presence = dbHandler.getActivePresence();
      expect(presence[0].started_at).toBeLessThanOrEqual(now + 1);
      expect(presence[0].expires_at).toBeGreaterThan(now + (29 * 60)); // ~30 minutes
    });

    test('AC-3: Expired presence records are automatically cleaned up', () => {
      // Create some expired records via direct DB insert
      const now = Math.floor(Date.now() / 1000);
      (dbHandler as any).db.prepare(`
        INSERT INTO reviewer_presence (reviewer_id, status, current_feature, started_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('expired1', 'online', 'old-feature', now - 3600, now - 1000, new Date().toISOString());

      (dbHandler as any).db.prepare(`
        INSERT INTO reviewer_presence (reviewer_id, status, current_feature, started_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('expired2', 'online', 'old-feature', now - 3600, now - 500, new Date().toISOString());

      // Verify they exist before cleanup
      let allRecords = (dbHandler as any).db.prepare(
        'SELECT * FROM reviewer_presence'
      ).all();
      expect(allRecords.length).toBe(2);

      // Run cleanup
      const removed = dbHandler.cleanupExpiredPresence();
      expect(removed).toBe(2);

      // Verify they're gone
      allRecords = (dbHandler as any).db.prepare(
        'SELECT * FROM reviewer_presence'
      ).all();
      expect(allRecords.length).toBe(0);
    });
  });
});
