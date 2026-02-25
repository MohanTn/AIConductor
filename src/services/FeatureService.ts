/**
 * FeatureService — CRUD for features, tasks, and repositories.
 *
 * Covers: createFeature, updateFeature, addTask, listFeatures, deleteRepo,
 *         deleteFeature, getFeature, updateTask, deleteTask,
 *         registerRepo, listRepos, getCurrentRepo.
 */
import {
  Task,
  CreateFeatureInput,
  CreateFeatureResult,
  UpdateFeatureInput,
  UpdateFeatureResult,
  AddTaskInput,
  AddTaskResult,
  ListFeaturesResult,
  DeleteFeatureResult,
  DeleteRepoResult,
  GetFeatureResult,
  UpdateTaskInput,
  UpdateTaskResult,
  DeleteTaskResult,
  RegisterRepoInput,
  RegisterRepoResult,
  ListReposResult,
  GetCurrentRepoResult,
} from '../types.js';
import { DatabaseHandler } from '../DatabaseHandler.js';
import { WorkflowValidator } from '../WorkflowValidator.js';
import { ServiceBase } from './ServiceBase.js';

export class FeatureService extends ServiceBase {

  constructor(db: DatabaseHandler, validator: WorkflowValidator) {
    super(db, validator);
  }

  async createFeature(input: CreateFeatureInput): Promise<CreateFeatureResult> {
    try {
      this.db.createFeature(input.featureSlug, input.featureName, input.repoName, input.description, input.intention);
      this.db.initializeRefinementSteps(input.repoName, input.featureSlug);

      return {
        success: true,
        featureSlug: input.featureSlug,
        message: `Feature '${input.featureName}' created with slug '${input.featureSlug}' and 8 refinement steps initialized`,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug: input.featureSlug,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async updateFeature(input: UpdateFeatureInput): Promise<UpdateFeatureResult> {
    try {
      if (!input.featureName && input.description === undefined && input.intention === undefined) {
        return {
          success: false,
          featureSlug: input.featureSlug,
          error: 'At least one of featureName, description, or intention must be provided',
        };
      }
      this.db.updateFeature(input.featureSlug, input.repoName, {
        featureName: input.featureName,
        description: input.description,
        intention: input.intention,
      });
      return {
        success: true,
        featureSlug: input.featureSlug,
        message: `Feature '${input.featureSlug}' updated successfully`,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug: input.featureSlug,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addTask(input: AddTaskInput): Promise<AddTaskResult> {
    try {
      const task: Partial<Task> = {
        taskId: input.taskId,
        title: input.title,
        description: input.description,
        orderOfExecution: input.orderOfExecution,
        acceptanceCriteria: input.acceptanceCriteria,
        testScenarios: input.testScenarios,
        outOfScope: input.outOfScope,
        estimatedHours: input.estimatedHours,
        dependencies: input.dependencies || [],
        tags: input.tags,
      };

      const taskId = this.db.addTask(input.featureSlug, task, input.repoName);
      return {
        success: true,
        featureSlug: input.featureSlug,
        taskId,
        message: `Task '${taskId}' added to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug: input.featureSlug,
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listFeatures(repoName: string): Promise<ListFeaturesResult> {
    try {
      const features = this.db.getAllFeatures(repoName);
      return {
        success: true,
        features,
        message: `Found ${features.length} feature(s)`,
      };
    } catch (error) {
      return {
        success: false,
        features: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteRepo(repoName: string): Promise<DeleteRepoResult> {
    try {
      const result = this.db.deleteRepo(repoName);
      if (!result.deleted) {
        return {
          success: false,
          repoName,
          error: `Repository '${repoName}' not found`,
        };
      }
      return {
        success: true,
        repoName,
        featureCount: result.featureCount,
        taskCount: result.taskCount,
        message: `Repository '${repoName}' deleted with ${result.featureCount} features and ${result.taskCount} tasks`,
      };
    } catch (error) {
      return {
        success: false,
        repoName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteFeature(repoName: string, featureSlug: string): Promise<DeleteFeatureResult> {
    try {
      this.db.deleteFeature(featureSlug, repoName);
      return {
        success: true,
        featureSlug,
        message: `Feature '${featureSlug}' deleted successfully`,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getFeature(repoName: string, featureSlug: string): Promise<GetFeatureResult> {
    try {
      const feature = await this.db.loadByFeatureSlug(featureSlug, repoName);
      return {
        success: true,
        feature,
        message: `Feature '${featureSlug}' loaded with ${feature.tasks.length} task(s)`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid feature: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      if ('status' in input.updates) {
        throw new Error('Cannot update task status via update_task. Use transition_task_status instead.');
      }

      if (Object.keys(input.updates).length === 0) {
        throw new Error('No fields to update');
      }

      this.db.updateTask(input.featureSlug, input.taskId, input.updates as Partial<Task>, input.repoName);

      return {
        success: true,
        featureSlug: input.featureSlug,
        taskId: input.taskId,
        message: `Task '${input.taskId}' updated successfully`,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug: input.featureSlug,
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteTask(repoName: string, featureSlug: string, taskId: string): Promise<DeleteTaskResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(featureSlug, repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid feature: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);
      const task = taskFile.tasks.find((t) => t.taskId === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const dependentTasks = taskFile.tasks.filter((t) =>
        t.dependencies && t.dependencies.includes(taskId)
      );

      this.db.deleteTask(featureSlug, taskId, repoName);

      let message = `Task '${taskId}' deleted successfully`;
      if (dependentTasks.length > 0) {
        const depIds = dependentTasks.map((t) => t.taskId).join(', ');
        message += `. Warning: ${dependentTasks.length} task(s) had dependencies on this task: ${depIds}`;
      }

      return { success: true, featureSlug, taskId, message };
    } catch (error) {
      return {
        success: false,
        featureSlug,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async registerRepo(input: RegisterRepoInput): Promise<RegisterRepoResult> {
    try {
      this.db.registerRepo(
        input.repoName,
        input.repoPath,
        input.repoUrl,
        input.defaultBranch,
        input.metadata
      );
      return {
        success: true,
        repoName: input.repoName,
        message: `Repository '${input.repoName}' registered successfully at path '${input.repoPath}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listRepos(): Promise<ListReposResult> {
    try {
      const repos = this.db.getAllRepos();
      return {
        success: true,
        repos,
        message: `Found ${repos.length} registered repository(ies)`,
      };
    } catch (error) {
      return {
        success: false,
        repos: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getCurrentRepo(): Promise<GetCurrentRepoResult> {
    try {
      const currentRepo = this.db.getCurrentRepo();
      if (!currentRepo) {
        return {
          success: false,
          registered: false,
          error: 'No repository found for current working directory',
        };
      }
      return {
        success: true,
        ...currentRepo,
        message: currentRepo.registered
          ? `Current repo: ${currentRepo.repoName}`
          : `Working directory ${currentRepo.repoPath} is not registered. Use register_repo first.`,
      };
    } catch (error) {
      return {
        success: false,
        registered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
