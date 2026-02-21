/**
 * TransitionService — handles task status transitions (development pipeline).
 *
 * Covers: transitionTaskStatus, getNextTask, updateAcceptanceCriteria,
 *         getTasksByStatus, verifyAllTasksComplete, batchTransitionTasks,
 *         batchUpdateAcceptanceCriteria.
 */
import {
  TransitionTaskInput,
  TransitionTaskResult,
  GetNextTaskInput,
  GetNextTaskResult,
  UpdateAcceptanceCriteriaInput,
  UpdateAcceptanceCriteriaResult,
  GetTasksByStatusInput,
  GetTasksByStatusResult,
  VerifyAllTasksCompleteInput,
  VerifyAllTasksCompleteResult,
  BatchTransitionTasksInput,
  BatchTransitionTasksResult,
  BatchUpdateAcceptanceCriteriaInput,
  BatchUpdateAcceptanceCriteriaResult,
  Transition,
} from '../types.js';
import { ServiceBase } from './ServiceBase.js';

export class TransitionService extends ServiceBase {

  async transitionTaskStatus(input: TransitionTaskInput): Promise<TransitionTaskResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      if (task.status !== input.fromStatus) {
        throw new Error(
          `Task status mismatch. Expected '${input.fromStatus}', but task is in '${task.status}'`
        );
      }

      const validation = this.validator.validateDevTransition(
        input.fromStatus, input.toStatus, input.actor
      );
      if (!validation.valid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }

      const transition: Transition = {
        from: input.fromStatus,
        to: input.toStatus,
        actor: input.actor,
        timestamp: new Date().toISOString(),
        notes: input.notes,
        ...input.metadata,
      };

      task.status = input.toStatus;
      task.transitions.push(transition);

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      return {
        success: true,
        taskId: input.taskId,
        previousStatus: input.fromStatus,
        newStatus: input.toStatus,
        transition,
        message:
          validation.warnings.length > 0
            ? `Transition recorded with warnings: ${validation.warnings.join(', ')}`
            : 'Transition recorded successfully',
      };
    } catch (error) {
      return {
        success: false,
        taskId: input.taskId,
        previousStatus: input.fromStatus,
        newStatus: input.fromStatus,
        transition: {
          from: input.fromStatus,
          to: input.fromStatus,
          actor: input.actor,
          timestamp: new Date().toISOString(),
          notes: '',
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getNextTask(input: GetNextTaskInput): Promise<GetNextTaskResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);

      const filteredTasks = taskFile.tasks.filter((t) =>
        input.statusFilter.includes(t.status)
      );

      if (filteredTasks.length === 0) {
        return {
          success: true,
          task: undefined,
          message: `No tasks found with status: ${input.statusFilter.join(', ')}`,
        };
      }

      const sortedTasks = filteredTasks.sort((a, b) => a.orderOfExecution - b.orderOfExecution);
      const nextTask = sortedTasks[0];

      return {
        success: true,
        task: nextTask,
        message: `Found task ${nextTask.taskId} with orderOfExecution ${nextTask.orderOfExecution}`,
      };
    } catch (error) {
      return {
        success: false,
        task: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async updateAcceptanceCriteria(
    input: UpdateAcceptanceCriteriaInput
  ): Promise<UpdateAcceptanceCriteriaResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      const criterion = task.acceptanceCriteria.find((ac) => ac.id === input.criterionId);
      if (!criterion) {
        throw new Error(
          `Acceptance criterion not found: ${input.criterionId} in task ${input.taskId}`
        );
      }

      criterion.verified = input.verified;

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      return {
        success: true,
        taskId: input.taskId,
        criterionId: input.criterionId,
        verified: input.verified,
        message: `Acceptance criterion ${input.criterionId} marked as ${input.verified ? 'verified' : 'unverified'}`,
      };
    } catch (error) {
      return {
        success: false,
        taskId: input.taskId,
        criterionId: input.criterionId,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getTasksByStatus(input: GetTasksByStatusInput): Promise<GetTasksByStatusResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);

      const tasks = taskFile.tasks.filter((t) => t.status === input.status);

      return {
        success: true,
        tasks,
        count: tasks.length,
        message: `Found ${tasks.length} task(s) with status '${input.status}'`,
      };
    } catch (error) {
      return {
        success: false,
        tasks: [],
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async verifyAllTasksComplete(
    input: VerifyAllTasksCompleteInput
  ): Promise<VerifyAllTasksCompleteResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);

      const totalTasks = taskFile.tasks.length;
      const completedTasks = taskFile.tasks.filter((t) => t.status === 'Done').length;
      const incompleteTasks = taskFile.tasks
        .filter((t) => t.status !== 'Done')
        .map((t) => ({ taskId: t.taskId, title: t.title, status: t.status }));

      const allComplete = completedTasks === totalTasks;

      return {
        success: true,
        allComplete,
        totalTasks,
        completedTasks,
        incompleteTasks,
        message: allComplete
          ? 'All tasks are complete!'
          : `${completedTasks}/${totalTasks} tasks complete. ${incompleteTasks.length} task(s) remaining.`,
      };
    } catch (error) {
      return {
        success: false,
        allComplete: false,
        totalTasks: 0,
        completedTasks: 0,
        incompleteTasks: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async batchTransitionTasks(input: BatchTransitionTasksInput): Promise<BatchTransitionTasksResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      const results = [];
      for (const taskId of input.taskIds) {
        try {
          const task = taskFile.tasks.find((t) => t.taskId === taskId);
          if (!task) {
            results.push({
              taskId, success: false,
              previousStatus: input.fromStatus, newStatus: input.fromStatus,
              error: `Task not found: ${taskId}`,
            });
            continue;
          }

          if (task.status !== input.fromStatus) {
            results.push({
              taskId, success: false,
              previousStatus: task.status, newStatus: task.status,
              error: `Task status mismatch. Expected '${input.fromStatus}', but task is in '${task.status}'`,
            });
            continue;
          }

          const validation = this.validator.validateDevTransition(input.fromStatus, input.toStatus, input.actor);
          if (!validation.valid) {
            results.push({
              taskId, success: false,
              previousStatus: input.fromStatus, newStatus: input.fromStatus,
              error: `Workflow validation failed: ${validation.errors.join(', ')}`,
            });
            continue;
          }

          const transition: Transition = {
            from: input.fromStatus,
            to: input.toStatus,
            actor: input.actor,
            timestamp: new Date().toISOString(),
            notes: input.notes,
            ...input.metadata,
          };

          const previousStatus = task.status;
          task.status = input.toStatus;
          task.transitions.push(transition);

          results.push({ taskId, success: true, previousStatus, newStatus: input.toStatus });
        } catch (taskError) {
          results.push({
            taskId, success: false,
            previousStatus: input.fromStatus, newStatus: input.fromStatus,
            error: taskError instanceof Error ? taskError.message : String(taskError),
          });
        }
      }

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      return {
        success: failureCount === 0,
        results,
        successCount,
        failureCount,
        message: `Batch transition complete: ${successCount} succeeded, ${failureCount} failed`,
      };
    } catch (error) {
      return {
        success: false,
        results: input.taskIds.map((taskId) => ({
          taskId, success: false,
          previousStatus: input.fromStatus, newStatus: input.fromStatus,
          error: error instanceof Error ? error.message : String(error),
        })),
        successCount: 0,
        failureCount: input.taskIds.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async batchUpdateAcceptanceCriteria(
    input: BatchUpdateAcceptanceCriteriaInput
  ): Promise<BatchUpdateAcceptanceCriteriaResult> {
    try {
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      const results = [];
      for (const update of input.updates) {
        try {
          const task = taskFile.tasks.find((t) => t.taskId === update.taskId);
          if (!task) {
            results.push({
              taskId: update.taskId, criterionId: update.criterionId,
              verified: update.verified, success: false,
              error: `Task not found: ${update.taskId}`,
            });
            continue;
          }

          const criterion = task.acceptanceCriteria.find((ac) => ac.id === update.criterionId);
          if (!criterion) {
            results.push({
              taskId: update.taskId, criterionId: update.criterionId,
              verified: update.verified, success: false,
              error: `Acceptance criterion not found: ${update.criterionId} in task ${update.taskId}`,
            });
            continue;
          }

          criterion.verified = update.verified;
          results.push({
            taskId: update.taskId, criterionId: update.criterionId,
            verified: update.verified, success: true,
          });
        } catch (updateError) {
          results.push({
            taskId: update.taskId, criterionId: update.criterionId,
            verified: update.verified, success: false,
            error: updateError instanceof Error ? updateError.message : String(updateError),
          });
        }
      }

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      return {
        success: failureCount === 0,
        results,
        successCount,
        failureCount,
        message: `Batch acceptance criteria update complete: ${successCount} succeeded, ${failureCount} failed`,
      };
    } catch (error) {
      return {
        success: false,
        results: input.updates.map((update) => ({
          taskId: update.taskId, criterionId: update.criterionId,
          verified: update.verified, success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        successCount: 0,
        failureCount: input.updates.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
