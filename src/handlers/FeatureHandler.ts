import { BaseHandler } from './BaseHandler.js';
import { NotFoundError, ValidationError } from '../errors.js';

/**
 * FeatureHandler manages feature CRUD operations.
 * Delegates to DatabaseHandler for persistence.
 */
export class FeatureHandler extends BaseHandler {
  /**
   * Create a new feature.
   * @param repoName - Repository identifier
   * @param featureSlug - URL-friendly feature identifier
   * @param featureName - Human-readable feature name
   * @param description - Feature description
   * @returns Feature record
   * @throws ValidationError if parameters are invalid
   * @throws ConflictError if feature slug already exists
   */
  createFeature(
    repoName: string,
    featureSlug: string,
    featureName: string,
    description?: string,
    intention?: string
  ): any {
    if (!featureSlug || !featureName) {
      throw new ValidationError('Feature slug and name are required');
    }
    const stmt = this.db.prepare(`
      INSERT INTO features (repo_name, feature_slug, feature_name, description, intention, created_at, last_modified)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    stmt.run(repoName, featureSlug, featureName, description || null, intention || null);
    return { repoName, featureSlug, featureName, description, intention };
  }

  /**
   * Get all features for a repository.
   * @param repoName - Repository identifier
   * @returns Array of feature records
   */
  getAllFeatures(repoName: string): any[] {
    const stmt = this.db.prepare(
      'SELECT * FROM features WHERE repo_name = ? ORDER BY created_at DESC'
    );
    return stmt.all(repoName) || [];
  }

  /**
   * Get a specific feature.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @returns Feature record or null
   */
  getFeature(repoName: string, featureSlug: string): any {
    const stmt = this.db.prepare(
      'SELECT * FROM features WHERE repo_name = ? AND feature_slug = ?'
    );
    return stmt.get(repoName, featureSlug) || null;
  }

  /**
   * Update feature metadata.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @param updates - Fields to update
   * @returns Updated feature record
   * @throws NotFoundError if feature not found
   */
  updateFeature(repoName: string, featureSlug: string, updates: Record<string, any>): any {
    const feature = this.getFeature(repoName, featureSlug);
    if (!feature) {
      throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);
    }
    const setClause = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(updates), 'now', repoName, featureSlug];
    const stmt = this.db.prepare(`
      UPDATE features
      SET ${setClause}, last_modified = datetime(?)
      WHERE repo_name = ? AND feature_slug = ?
    `);
    stmt.run(...values);
    return { ...feature, ...updates };
  }

  /**
   * Delete a feature and all related tasks.
   * @param repoName - Repository identifier
   * @param featureSlug - Feature identifier
   * @throws NotFoundError if feature not found
   */
  deleteFeature(repoName: string, featureSlug: string): void {
    const feature = this.getFeature(repoName, featureSlug);
    if (!feature) {
      throw new NotFoundError(`Feature '${featureSlug}' not found in repo '${repoName}'`);
    }
    const stmt = this.db.prepare(
      'DELETE FROM features WHERE repo_name = ? AND feature_slug = ?'
    );
    stmt.run(repoName, featureSlug);
  }
}
