import { BaseHandler } from './BaseHandler.js';

/**
 * ReviewHandler manages stakeholder reviews and approvals.
 */
export class ReviewHandler extends BaseHandler {
  /**
   * Record a stakeholder review.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @param stakeholder - Reviewer role
   * @param decision - Approval decision (approve/reject)
   * @param notes - Review notes
   * @param additionalData - Role-specific review data
   */
  recordReview(
    repoName: string,
    featureSlug: string,
    taskId: string,
    stakeholder: string,
    decision: 'approve' | 'reject',
    notes: string,
    additionalData?: Record<string, any>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO stakeholder_reviews (repo_name, feature_slug, task_id, stakeholder, decision, notes, additional_data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      repoName,
      featureSlug,
      taskId,
      stakeholder,
      decision,
      notes,
      additionalData ? JSON.stringify(additionalData) : null
    );
  }

  /**
   * Get all reviews for a task.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @returns Array of review records
   */
  getReviews(repoName: string, featureSlug: string, taskId: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM stakeholder_reviews
      WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
      ORDER BY timestamp DESC
    `);
    return stmt.all(repoName, featureSlug, taskId) || [];
  }

  /**
   * Get review for a specific stakeholder.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @param stakeholder - Stakeholder role
   * @returns Review record or null
   */
  getReviewByStakeholder(
    repoName: string,
    featureSlug: string,
    taskId: string,
    stakeholder: string
  ): any {
    const stmt = this.db.prepare(`
      SELECT * FROM stakeholder_reviews
      WHERE repo_name = ? AND feature_slug = ? AND task_id = ? AND stakeholder = ?
    `);
    return stmt.get(repoName, featureSlug, taskId, stakeholder) || null;
  }
}
