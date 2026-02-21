/**
 * Main API Client - Re-exports all API modules for backward compatibility
 */
import { RepoAPI } from './repos.api.js';
import { FeatureAPI } from './features.api.js';
import { TaskAPI } from './tasks.api.js';
import { SettingsAPI, RolePromptConfig } from './settings.api.js';
import { QueueAPI, QueueItem, QueueStats } from './queue.api.js';
import { Feature, Task, ReviewSummary } from '../types/index.js';

/**
 * Unified API Client that combines all API modules
 * This maintains backward compatibility while using the new modular structure
 */
export class APIClient {
  // Re-export Repo Operations
  static async listRepos(): Promise<Record<string, any>> {
    return RepoAPI.listRepos();
  }

  static async registerRepo(repoName: string, description?: string): Promise<any> {
    return RepoAPI.registerRepo(repoName, description);
  }

  static async deleteRepo(repoName: string): Promise<any> {
    return RepoAPI.deleteRepo(repoName);
  }

  // Re-export Feature Operations
  static async listFeatures(repoName: string = 'default'): Promise<Feature[]> {
    return FeatureAPI.listFeatures(repoName);
  }

  static async getFeature(repoName: string, featureSlug: string): Promise<Feature> {
    return FeatureAPI.getFeature(repoName, featureSlug);
  }

  static async getFeatureDetails(repoName: string, featureSlug: string): Promise<any> {
    return FeatureAPI.getFeatureDetails(repoName, featureSlug);
  }

  static async getFeatureSnapshot(repoName: string, featureSlug: string): Promise<any> {
    return FeatureAPI.getFeatureSnapshot(repoName, featureSlug);
  }

  static async createFeature(data: {
    repoName: string;
    featureSlug: string;
    title: string;
    description?: string;
  }): Promise<any> {
    return FeatureAPI.createFeature(data);
  }

  static async deleteFeature(repoName: string, featureSlug: string): Promise<any> {
    return FeatureAPI.deleteFeature(repoName, featureSlug);
  }

  // Re-export Task Operations
  static async getTasks(repoName: string, featureSlug: string): Promise<ReviewSummary> {
    return TaskAPI.getTasks(repoName, featureSlug);
  }

  static async getTask(repoName: string, featureSlug: string, taskId: string): Promise<Task> {
    return TaskAPI.getTask(repoName, featureSlug, taskId);
  }

  static async getFullTask(repoName: string, featureSlug: string, taskId: string): Promise<Task> {
    return TaskAPI.getFullTask(repoName, featureSlug, taskId);
  }

  static async createTask(data: {
    repoName: string;
    featureSlug: string;
    taskId: string;
    title: string;
    description: string;
    [key: string]: any;
  }): Promise<any> {
    return TaskAPI.createTask(data);
  }

  static async updateTask(
    taskId: string,
    featureSlug: string,
    repoName: string,
    updates: Partial<Task>
  ): Promise<any> {
    return TaskAPI.updateTask(taskId, featureSlug, repoName, updates);
  }

  static async deleteTask(repoName: string, featureSlug: string, taskId: string): Promise<any> {
    return TaskAPI.deleteTask(repoName, featureSlug, taskId);
  }

  static async getTasksByStatus(
    repoName: string,
    featureSlug: string,
    status: string
  ): Promise<any> {
    return TaskAPI.getTasksByStatus(repoName, featureSlug, status);
  }

  static async transitionTask(
    repoName: string,
    featureSlug: string,
    taskId: string,
    fromStatus: string,
    toStatus: string,
    actor?: string,
  ): Promise<any> {
    return TaskAPI.transitionTask(repoName, featureSlug, taskId, fromStatus, toStatus, actor);
  }

  // Settings / Role Prompts
  static async getAllRolePrompts(): Promise<RolePromptConfig[]> {
    return SettingsAPI.getAllRolePrompts();
  }

  static async updateRolePrompt(
    roleId: string,
    update: Partial<Pick<RolePromptConfig, 'systemPrompt' | 'focusAreas' | 'researchInstructions' | 'requiredOutputFields'>>
  ): Promise<RolePromptConfig> {
    return SettingsAPI.updateRolePrompt(roleId, update);
  }

  static async resetRolePrompt(roleId: string): Promise<RolePromptConfig> {
    return SettingsAPI.resetRolePrompt(roleId);
  }

  // Queue Operations
  static async getQueueItems(repoName?: string, featureSlug?: string, status?: string): Promise<QueueItem[]> {
    return QueueAPI.getQueueItems(repoName, featureSlug, status);
  }

  static async getQueueStats(): Promise<QueueStats> {
    return QueueAPI.getQueueStats();
  }

  static async getQueueItem(id: number): Promise<QueueItem> {
    return QueueAPI.getQueueItem(id);
  }

  static async reenqueueItem(id: number): Promise<QueueItem> {
    return QueueAPI.reenqueueItem(id);
  }

  static async cancelQueueItem(id: number): Promise<void> {
    return QueueAPI.cancelItem(id);
  }

  static async pruneQueueItems(olderThanDays?: number): Promise<number> {
    return QueueAPI.pruneItems(olderThanDays);
  }
}

// Also export individual API modules for direct use
export { RepoAPI, FeatureAPI, TaskAPI, SettingsAPI, QueueAPI };
export type { RolePromptConfig, QueueItem, QueueStats };
