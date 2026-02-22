/**
 * Feature API client
 */
import { BaseClient } from './base.js';
import { Feature } from '../types/index.js';

export class FeatureAPI extends BaseClient {
  /**
   * List all features for a repository
   */
  static async listFeatures(repoName: string = 'default'): Promise<Feature[]> {
    const response = await this.request<any>(`${this.apiBase}/features?repoName=${encodeURIComponent(repoName)}`);
    const features = response.features || [];
    
    // Map backend response to frontend Feature interface
    return features.map((f: any) => ({
      featureSlug: f.featureSlug,
      title: f.featureName || f.title,
      description: f.description,
      repoName: repoName,
      createdAt: f.lastModified || f.createdAt || new Date().toISOString(),
      totalTasks: f.totalTasks || 0,
    }));
  }

  /**
   * Get a specific feature
   */
  static async getFeature(repoName: string, featureSlug: string): Promise<Feature> {
    return this.request(`${this.apiBase}/features/${encodeURIComponent(featureSlug)}?repoName=${encodeURIComponent(repoName)}`);
  }

  /**
   * Get feature details including acceptance criteria and test scenarios
   */
  static async getFeatureDetails(repoName: string, featureSlug: string): Promise<any> {
    return this.request(`${this.apiBase}/features/${encodeURIComponent(featureSlug)}/details?repoName=${encodeURIComponent(repoName)}`);
  }

  /**
   * Get compressed workflow snapshot: blockages, next role, recommendations
   */
  static async getFeatureSnapshot(repoName: string, featureSlug: string): Promise<any> {
    return this.request(`${this.apiBase}/features/${encodeURIComponent(featureSlug)}/snapshot?repoName=${encodeURIComponent(repoName)}`);
  }

  /**
   * Create a new feature
   */
  static async createFeature(data: {
    repoName: string;
    featureSlug: string;
    title: string;
    description?: string;
  }): Promise<any> {
    return this.request(`${this.apiBase}/features`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a feature
   */
  static async deleteFeature(repoName: string, featureSlug: string): Promise<any> {
    return this.request(
      `${this.apiBase}/features/${encodeURIComponent(featureSlug)}?repoName=${encodeURIComponent(repoName)}`,
      { method: 'DELETE' }
    );
  }
}
