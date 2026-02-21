/**
 * Settings API - Role Prompt & Queue configuration endpoints
 */
import { BaseClient } from './base.js';

export interface RolePromptConfig {
  roleId: string;
  systemPrompt: string;
  focusAreas: string[];
  researchInstructions: string;
  requiredOutputFields: string[];
  phase: 'review' | 'execution';
  isCustom: boolean;
  updatedAt: string;
}

export interface QueueSettings {
  cronIntervalSeconds: number;
  baseReposFolder: string;
  cliTool: 'claude' | 'copilot';
  workerEnabled: boolean;
  devWorkflowScript?: string;
}

export class SettingsAPI extends BaseClient {
  // ─── Queue & Worker Settings ───────────────────────────────────────

  /**
   * Fetch current queue/worker settings.
   */
  static async getQueueSettings(): Promise<QueueSettings> {
    const data = await this.request<QueueSettings & { success: boolean }>(
      `${this.apiBase}/settings/queue`
    );
    return {
      cronIntervalSeconds: data.cronIntervalSeconds,
      baseReposFolder: data.baseReposFolder,
      cliTool: data.cliTool,
      workerEnabled: data.workerEnabled,
      devWorkflowScript: data.devWorkflowScript,
    };
  }

  /**
   * Update queue/worker settings (partial update).
   */
  static async updateQueueSettings(
    updates: Partial<QueueSettings>
  ): Promise<QueueSettings> {
    const data = await this.request<QueueSettings & { success: boolean }>(
      `${this.apiBase}/settings/queue`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
    return {
      cronIntervalSeconds: data.cronIntervalSeconds,
      baseReposFolder: data.baseReposFolder,
      cliTool: data.cliTool,
      workerEnabled: data.workerEnabled,
      devWorkflowScript: data.devWorkflowScript,
    };
  }

  // ─── Role Prompt Settings ──────────────────────────────────────────
  /**
   * Fetch all role prompt configs.
   */
  static async getAllRolePrompts(): Promise<RolePromptConfig[]> {
    const data = await this.request<{ success: boolean; rolePrompts: RolePromptConfig[] }>(
      `${this.apiBase}/settings/role-prompts`
    );
    return data.rolePrompts;
  }

  /**
   * Update one role's prompt config.
   */
  static async updateRolePrompt(
    roleId: string,
    update: Partial<Pick<RolePromptConfig, 'systemPrompt' | 'focusAreas' | 'researchInstructions' | 'requiredOutputFields'>>
  ): Promise<RolePromptConfig> {
    const data = await this.request<RolePromptConfig & { success: boolean }>(
      `${this.apiBase}/settings/role-prompts/${roleId}`,
      {
        method: 'PUT',
        body: JSON.stringify(update),
      }
    );
    return data;
  }

  /**
   * Reset a role's prompt to the built-in default.
   */
  static async resetRolePrompt(roleId: string): Promise<RolePromptConfig> {
    const data = await this.request<RolePromptConfig & { success: boolean }>(
      `${this.apiBase}/settings/role-prompts/${roleId}/reset`,
      { method: 'POST' }
    );
    return data;
  }
}
