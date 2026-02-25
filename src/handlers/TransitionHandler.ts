import { BaseHandler } from './BaseHandler.js';

/**
 * TransitionHandler manages task state transitions and history.
 */
export class TransitionHandler extends BaseHandler {
  /**
   * Record a task state transition.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @param fromStatus - Previous status
   * @param toStatus - New status
   * @param actor - Actor performing the transition
   * @param notes - Optional transition notes
   * @param metadata - Optional additional data
   */
  recordTransition(
    repoName: string,
    featureSlug: string,
    taskId: string,
    fromStatus: string,
    toStatus: string,
    actor: string,
    notes?: string,
    metadata?: Record<string, any>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO transitions (repo_name, feature_slug, task_id, from_status, to_status, actor, notes, additional_data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      repoName,
      featureSlug,
      taskId,
      fromStatus,
      toStatus,
      actor,
      notes || null,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  /**
   * Get transition history for a task.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @returns Array of transition records
   */
  getTransitionHistory(repoName: string, featureSlug: string, taskId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transitions
      WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
      ORDER BY timestamp DESC
    `);
    return stmt.all(repoName, featureSlug, taskId) || [];
  }
}
