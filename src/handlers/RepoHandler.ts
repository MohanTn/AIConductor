import { BaseHandler } from './BaseHandler.js';
import { ValidationError } from '../errors.js';

/**
 * RepoHandler manages repository CRUD operations.
 * Delegates to DatabaseHandler.db for persistence.
 */
export class RepoHandler extends BaseHandler {
  /**
   * Register a new repository.
   * @param repoName - Unique identifier for the repository
   * @param repoPath - Filesystem path to the repository
   * @param repoUrl - Optional Git URL
   * @param defaultBranch - Default branch name (defaults to 'main')
   * @returns Repository metadata
   * @throws ValidationError if repoName already exists
   */
  registerRepo(
    repoName: string,
    repoPath: string,
    repoUrl?: string,
    defaultBranch: string = 'main'
  ): any {
    if (!repoName) {
      throw new ValidationError('Repository name is required');
    }
    const stmt = this.db.prepare(`
      INSERT INTO repositories (repo_name, repo_path, repo_url, default_branch, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(repoName, repoPath, repoUrl || null, defaultBranch);
    return { repoName, repoPath, repoUrl, defaultBranch };
  }

  /**
   * Get all repositories.
   * @returns Array of repository records
   */
  getAllRepos(): any[] {
    const stmt = this.db.prepare('SELECT * FROM repositories');
    return stmt.all() || [];
  }

  /**
   * Get a specific repository.
   * @param repoName - Repository identifier
   * @returns Repository metadata or null
   */
  getRepo(repoName: string): any {
    const stmt = this.db.prepare('SELECT * FROM repositories WHERE repo_name = ?');
    return stmt.get(repoName) || null;
  }
}
