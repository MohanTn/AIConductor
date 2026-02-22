import { BaseHandler } from './BaseHandler.js';

/**
 * RefinementHandler manages feature refinement data and metadata.
 */
export class RefinementHandler extends BaseHandler {
  /**
   * Update a refinement step.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param stepNumber - Step number (1-8)
   * @param completed - Whether step is complete
   * @param summary - Step summary
   * @param data - Step-specific data
   */
  updateRefinementStep(
    repoName: string,
    featureSlug: string,
    stepNumber: number,
    completed: boolean,
    summary: string,
    data?: Record<string, any>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO feature_refinement_steps (repo_name, feature_slug, step_number, completed, summary, step_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(repo_name, feature_slug, step_number) DO UPDATE SET
        completed = excluded.completed,
        summary = excluded.summary,
        step_data = excluded.step_data,
        updated_at = datetime('now')
    `);
    stmt.run(
      repoName,
      featureSlug,
      stepNumber,
      completed ? 1 : 0,
      summary,
      data ? JSON.stringify(data) : null
    );
  }

  /**
   * Get refinement steps for a feature.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @returns Array of refinement step records
   */
  getRefinementSteps(repoName: string, featureSlug: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM feature_refinement_steps
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY step_number
    `);
    return stmt.all(repoName, featureSlug) || [];
  }

  /**
   * Save a workflow checkpoint.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param description - Checkpoint description
   */
  saveCheckpoint(repoName: string, featureSlug: string, description: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_checkpoints (repo_name, feature_slug, description, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(repoName, featureSlug, description);
  }

  /**
   * Get all checkpoints for a feature.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @returns Array of checkpoint records
   */
  getCheckpoints(repoName: string, featureSlug: string): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_checkpoints
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(repoName, featureSlug) || [];
  }
}
