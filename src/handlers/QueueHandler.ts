import { BaseHandler } from './BaseHandler.js';

/**
 * QueueHandler manages event queue and background task processing.
 */
export class QueueHandler extends BaseHandler {
  /**
   * Enqueue a task for processing.
   * @param taskType - Type of task to queue
   * @param data - Task data payload
   * @param priority - Task priority (1-10, default 5)
   * @returns Queue item ID
   */
  enqueueTask(taskType: string, data: Record<string, any>, priority: number = 5): string {
    const stmt = this.db.prepare(`
      INSERT INTO queue (task_type, data, priority, status, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(taskType, JSON.stringify(data), priority, 'pending');
    return result.lastInsertRowid?.toString() || '';
  }

  /**
   * Get pending queue items.
   * @param limit - Maximum items to return
   * @returns Array of queue items
   */
  getPendingTasks(limit: number = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM queue
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `);
    return stmt.all(limit) || [];
  }

  /**
   * Mark a queue item as processed.
   * @param id - Queue item ID
   * @param result - Processing result
   */
  markProcessed(id: number, result?: any): void {
    const stmt = this.db.prepare(`
      UPDATE queue
      SET status = 'completed', result = ?, processed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(result ? JSON.stringify(result) : null, id);
  }

  /**
   * Mark a queue item as failed.
   * @param id - Queue item ID
   * @param error - Error message
   */
  markFailed(id: number, error: string): void {
    const stmt = this.db.prepare(`
      UPDATE queue
      SET status = 'failed', error = ?, processed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(error, id);
  }

  /**
   * Get queue statistics.
   * @returns Queue stats (pending, completed, failed counts)
   */
  getQueueStats(): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM queue GROUP BY status
    `);
    const rows: any[] = stmt.all() || [];
    const stats: Record<string, number> = { pending: 0, completed: 0, failed: 0 };
    rows.forEach(row => {
      stats[row.status] = row.count;
    });
    return stats;
  }
}
