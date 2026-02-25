import { BaseHandler } from './BaseHandler.js';
import { NotFoundError, ValidationError } from '../errors.js';

/**
 * TaskHandler manages task CRUD operations.
 */
export class TaskHandler extends BaseHandler {
  /**
   * Create a new task in a feature.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Unique task identifier
   * @param title - Task title
   * @param description - Task description
   * @returns Task record
   */
  createTask(
    repoName: string,
    featureSlug: string,
    taskId: string,
    title: string,
    description: string
  ): any {
    if (!taskId || !title) {
      throw new ValidationError('Task ID and title are required');
    }
    const stmt = this.db.prepare(`
      INSERT INTO tasks (repo_name, feature_slug, task_id, title, description, status, created_at, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    stmt.run(repoName, featureSlug, taskId, title, description, 'PendingProductDirector');
    return { repoName, featureSlug, taskId, title, description, status: 'PendingProductDirector' };
  }

  /**
   * Get all tasks for a feature.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @returns Array of task records
   */
  getAllTasks(repoName: string, featureSlug: string): any[] {
    const stmt = this.db.prepare(
      'SELECT * FROM tasks WHERE repo_name = ? AND feature_slug = ? ORDER BY order_of_execution'
    );
    return stmt.all(repoName, featureSlug) || [];
  }

  /**
   * Get a specific task.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @returns Task record or null
   */
  getTask(repoName: string, featureSlug: string, taskId: string): any {
    const stmt = this.db.prepare(
      'SELECT * FROM tasks WHERE repo_name = ? AND feature_slug = ? AND task_id = ?'
    );
    return stmt.get(repoName, featureSlug, taskId) || null;
  }

  /**
   * Update task status and metadata.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param taskId - Task identifier
   * @param updates - Fields to update
   * @returns Updated task record
   * @throws NotFoundError if task not found
   */
  updateTask(
    repoName: string,
    featureSlug: string,
    taskId: string,
    updates: Record<string, any>
  ): any {
    const task = this.getTask(repoName, featureSlug, taskId);
    if (!task) {
      throw new NotFoundError(`Task '${taskId}' not found`);
    }
    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(updates), 'now', repoName, featureSlug, taskId];
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET ${setClause}, last_modified = datetime(?)
      WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
    `);
    stmt.run(...values);
    return { ...task, ...updates };
  }
}
