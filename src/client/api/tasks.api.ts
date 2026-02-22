/**
 * Task API client
 */
import { BaseClient } from './base.js';
import { Task, ReviewSummary } from '../types/index.js';

export class TaskAPI extends BaseClient {
  /**
   * Get all tasks for a feature
   */
  static async getTasks(repoName: string, featureSlug: string): Promise<ReviewSummary> {
    return this.request(
      `${this.apiBase}/tasks?featureSlug=${encodeURIComponent(featureSlug)}&repoName=${encodeURIComponent(repoName)}`
    );
  }

  /**
   * Get a specific task
   */
  static async getTask(repoName: string, featureSlug: string, taskId: string): Promise<Task> {
    return this.request(
      `${this.apiBase}/task?featureSlug=${encodeURIComponent(featureSlug)}&id=${encodeURIComponent(taskId)}&repoName=${encodeURIComponent(repoName)}`
    );
  }

  /**
   * Get full task details
   */
  static async getFullTask(repoName: string, featureSlug: string, taskId: string): Promise<Task> {
    return this.request(
      `${this.apiBase}/task/full?featureSlug=${encodeURIComponent(featureSlug)}&id=${encodeURIComponent(taskId)}&repoName=${encodeURIComponent(repoName)}`
    );
  }

  /**
   * Create a new task
   */
  static async createTask(data: {
    repoName: string;
    featureSlug: string;
    taskId: string;
    title: string;
    description: string;
    [key: string]: any;
  }): Promise<any> {
    return this.request(`${this.apiBase}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing task
   */
  static async updateTask(
    taskId: string,
    featureSlug: string,
    repoName: string,
    updates: Partial<Task>
  ): Promise<any> {
    return this.request(`${this.apiBase}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify({ featureSlug, updates, repoName }),
    });
  }

  /**
   * Delete a task
   */
  static async deleteTask(repoName: string, featureSlug: string, taskId: string): Promise<any> {
    return this.request(
      `${this.apiBase}/tasks/${encodeURIComponent(taskId)}?featureSlug=${encodeURIComponent(featureSlug)}&repoName=${encodeURIComponent(repoName)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Transition a task to a new status via the inline quick-action endpoint
   */
  static async transitionTask(
    repoName: string,
    featureSlug: string,
    taskId: string,
    fromStatus: string,
    toStatus: string,
    actor?: string,
  ): Promise<any> {
    return this.request(`${this.apiBase}/tasks/${encodeURIComponent(taskId)}/transition`, {
      method: 'POST',
      body: JSON.stringify({ featureSlug, repoName, fromStatus, toStatus, actor }),
    });
  }

  /**
   * Get tasks filtered by status
   */
  static async getTasksByStatus(
    repoName: string,
    featureSlug: string,
    status: string
  ): Promise<any> {
    return this.request(
      `${this.apiBase}/tasks/by-status?featureSlug=${encodeURIComponent(featureSlug)}&status=${encodeURIComponent(status)}&repoName=${encodeURIComponent(repoName)}`
    );
  }
}
