/**
 * WorkflowService — cross-cutting workflow concerns: snapshots, metrics,
 * checkpoints, execution planning, and task similarity.
 *
 * Covers: getWorkflowSnapshot, saveWorkflowCheckpoint, listWorkflowCheckpoints,
 *         restoreWorkflowCheckpoint, rollbackLastDecision, getTaskExecutionPlan,
 *         getWorkflowMetrics, getSimilarTasks.
 */
import {
  TaskStatus,
  GetWorkflowSnapshotResult,
  SaveWorkflowCheckpointInput,
  SaveWorkflowCheckpointResult,
  ListWorkflowCheckpointsInput,
  ListWorkflowCheckpointsResult,
  RestoreWorkflowCheckpointInput,
  RestoreWorkflowCheckpointResult,
  RollbackLastDecisionInput,
  RollbackLastDecisionResult,
  GetTaskExecutionPlanInput,
  GetTaskExecutionPlanResult,
  GetWorkflowMetricsInput,
  GetWorkflowMetricsResult,
  GetSimilarTasksInput,
  GetSimilarTasksResult,
  WorkflowAlert,
  SimilarTask,
} from '../types.js';
import { ServiceBase } from './ServiceBase.js';

export class WorkflowService extends ServiceBase {

  async getWorkflowSnapshot(repoName: string, featureSlug: string): Promise<GetWorkflowSnapshotResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);

      const statusCounts: Record<TaskStatus, number> = {
        PendingProductDirector: 0, PendingArchitect: 0, PendingUiUxExpert: 0,
        PendingSecurityOfficer: 0, ReadyForDevelopment: 0, NeedsRefinement: 0,
        ToDo: 0, InProgress: 0, InReview: 0, InQA: 0, NeedsChanges: 0, Done: 0,
      };

      const roleMapping: Record<TaskStatus, string | null> = {
        PendingProductDirector: 'Product Director',
        PendingArchitect: 'Architect',
        PendingUiUxExpert: 'UI/UX Expert',
        PendingSecurityOfficer: 'Security Officer',
        ReadyForDevelopment: null, NeedsRefinement: null, ToDo: null,
        InProgress: 'Developer', InReview: 'Code Reviewer', InQA: 'QA',
        NeedsChanges: 'Developer', Done: null,
      };

      const taskSnapshot = taskFile.tasks.map((task) => {
        statusCounts[task.status]++;

        let lastDecision: string | undefined;
        if (task.transitions.length > 0) {
          const lastTransition = task.transitions[task.transitions.length - 1];
          if (lastTransition.notes) {
            lastDecision = `${lastTransition.actor}: ${lastTransition.notes.substring(0, 80)}${lastTransition.notes.length > 80 ? '...' : ''}`;
          }
        }

        return {
          taskId: task.taskId,
          title: task.title,
          status: task.status,
          orderOfExecution: task.orderOfExecution,
          currentRole: roleMapping[task.status] || undefined,
          lastDecision,
        };
      });

      const blockages = taskSnapshot
        .filter((t) => ['PendingProductDirector', 'PendingArchitect', 'PendingUiUxExpert',
          'PendingSecurityOfficer', 'NeedsRefinement', 'NeedsChanges'].includes(t.status))
        .map((t) => {
          const task = taskFile.tasks.find((task) => task.taskId === t.taskId)!;
          const lastTransition = task.transitions[task.transitions.length - 1];
          const waitingSince = lastTransition?.timestamp;

          let reason = '';
          if (t.status.startsWith('Pending')) {
            reason = `Waiting for ${t.currentRole} review`;
          } else if (t.status === 'NeedsRefinement') {
            reason = 'Rejected by stakeholder, needs fixes';
          } else if (t.status === 'NeedsChanges') {
            reason = 'Rejected by Code Reviewer or QA, needs fixes';
          }

          return { taskId: t.taskId, status: t.status, reason, waitingSince };
        });

      const readyCount = statusCounts.ReadyForDevelopment;
      const doneCount = statusCounts.Done;
      const needsRefinementCount = statusCounts.NeedsRefinement;
      const needsChangesCount = statusCounts.NeedsChanges;
      const inProgressCount = statusCounts.InProgress + statusCounts.InReview + statusCounts.InQA;
      const totalTasks = taskFile.tasks.length;

      let summary = `${readyCount} ready for dev`;
      if (doneCount > 0) summary += `, ${doneCount} done`;
      if (inProgressCount > 0) summary += `, ${inProgressCount} in progress`;
      if (blockages.length > 0) summary += `, ${blockages.length} blocked`;

      const progress = totalTasks > 0 ? ((doneCount / totalTasks) * 100).toFixed(0) : '0';

      const recommendations: string[] = [];

      if (readyCount > 0) {
        const readyTasks = taskSnapshot
          .filter((t) => t.status === 'ReadyForDevelopment').map((t) => t.taskId).join(', ');
        recommendations.push(`Start development on ${readyTasks}`);
      }
      if (needsRefinementCount > 0) {
        const nrTasks = taskSnapshot
          .filter((t) => t.status === 'NeedsRefinement').map((t) => t.taskId).join(', ');
        recommendations.push(`Fix and resubmit to Product Director: ${nrTasks}`);
      }
      if (needsChangesCount > 0) {
        const ncTasks = taskSnapshot
          .filter((t) => t.status === 'NeedsChanges').map((t) => t.taskId).join(', ');
        recommendations.push(`Address feedback and restart dev phase: ${ncTasks}`);
      }
      if (blockages.length > 0 && recommendations.length < 3) {
        const blockedTasks = blockages.map((b) => `${b.taskId} (${b.reason})`).join('; ');
        recommendations.push(`Review blocked tasks: ${blockedTasks}`);
      }

      return {
        success: true,
        feature: {
          slug: taskFile.featureSlug,
          name: taskFile.featureName,
          totalTasks,
          progress: `${progress}%`,
        },
        summary,
        taskSnapshot,
        blockages,
        recommendations,
        message: `Workflow snapshot generated for feature '${featureSlug}' with ${totalTasks} tasks`,
      };
    } catch (error) {
      return {
        success: false,
        feature: { slug: featureSlug, name: '', totalTasks: 0, progress: '0%' },
        summary: '',
        taskSnapshot: [],
        blockages: [],
        recommendations: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async saveWorkflowCheckpoint(
    input: SaveWorkflowCheckpointInput
  ): Promise<SaveWorkflowCheckpointResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);
      const checkpointId = this.db.saveCheckpoint(
        input.repoName, input.featureSlug, input.description, taskFile.tasks
      );

      return {
        success: true,
        checkpointId,
        savedAt: new Date().toISOString(),
        taskCount: taskFile.tasks.length,
        message: `Workflow checkpoint saved: "${input.description}" with ${taskFile.tasks.length} tasks`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listWorkflowCheckpoints(
    input: ListWorkflowCheckpointsInput
  ): Promise<ListWorkflowCheckpointsResult> {
    try {
      const checkpoints = this.db.listCheckpoints(input.repoName, input.featureSlug);
      return {
        success: true,
        checkpoints,
        message: `Found ${checkpoints.length} checkpoint(s) for feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        checkpoints: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async restoreWorkflowCheckpoint(
    input: RestoreWorkflowCheckpointInput
  ): Promise<RestoreWorkflowCheckpointResult> {
    try {
      const checkpoint = this.db.getCheckpoint(input.repoName, input.featureSlug, input.checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${input.checkpointId}`);
      }

      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      let restoredCount = 0;
      for (const snapshotTask of checkpoint.snapshot) {
        const task = taskFile.tasks.find((t) => t.taskId === snapshotTask.taskId);
        if (task) {
          const previousStatus = task.status;
          task.status = snapshotTask.status;
          task.transitions.push({
            from: previousStatus,
            to: snapshotTask.status,
            actor: 'system',
            timestamp: new Date().toISOString(),
            notes: `Restored from checkpoint: ${checkpoint.description}`,
          });
          restoredCount++;
        }
      }

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      return {
        success: true,
        checkpointId: input.checkpointId,
        restoredTasks: restoredCount,
        message: `Restored ${restoredCount} tasks from checkpoint: "${checkpoint.description}"`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async rollbackLastDecision(
    input: RollbackLastDecisionInput
  ): Promise<RollbackLastDecisionResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);

      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      if (task.transitions.length === 0) {
        throw new Error(`No transitions to rollback for task ${input.taskId}`);
      }

      const lastTransition = task.transitions[task.transitions.length - 1];
      const rolledBackFrom = task.status;
      const rolledBackTo = lastTransition.from;

      task.status = rolledBackTo;
      task.transitions.pop();

      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      return {
        success: true,
        taskId: input.taskId,
        rolledBackFrom,
        rolledBackTo,
        message: `Rolled back task ${input.taskId} from '${rolledBackFrom}' to '${rolledBackTo}'`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getTaskExecutionPlan(
    input: GetTaskExecutionPlanInput
  ): Promise<GetTaskExecutionPlanResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);

      const graph: Record<string, string[]> = {};
      const inDegree: Record<string, number> = {};
      const tasks = taskFile.tasks;

      for (const task of tasks) {
        graph[task.taskId] = task.dependencies || [];
        inDegree[task.taskId] = task.dependencies?.length || 0;
      }

      // Topological sort (Kahn's algorithm)
      const queue: string[] = [];
      for (const taskId of Object.keys(inDegree)) {
        if (inDegree[taskId] === 0) queue.push(taskId);
      }

      const optimalOrder: string[] = [];
      const tempInDegree = { ...inDegree };

      while (queue.length > 0) {
        const taskId = queue.shift()!;
        optimalOrder.push(taskId);

        for (const [depTaskId, deps] of Object.entries(graph)) {
          if (deps.includes(taskId)) {
            tempInDegree[depTaskId]--;
            if (tempInDegree[depTaskId] === 0) queue.push(depTaskId);
          }
        }
      }

      const hasCircularDeps = optimalOrder.length !== tasks.length;
      const warnings: string[] = [];

      if (hasCircularDeps) {
        warnings.push('Circular dependencies detected! Some tasks cannot be executed.');
      }

      for (const task of tasks) {
        const blocked = tasks
          .filter((t) => t.dependencies?.includes(task.taskId) || [])
          .map((t) => t.taskId);
        if (blocked.length > 1) {
          warnings.push(`${task.taskId} blocks ${blocked.join(', ')}`);
        }
      }

      // Group parallelizable tasks by phase
      const parallelizable: Record<string, string[]> = {};
      let phaseNum = 1;
      const processed = new Set<string>();

      for (const taskId of optimalOrder) {
        if (!processed.has(taskId)) {
          const phaseTasks = [taskId];
          processed.add(taskId);

          for (const other of optimalOrder) {
            if (!processed.has(other)) {
              const canRunTogether =
                !(other in graph && graph[other].some((d) => phaseTasks.includes(d))) &&
                !phaseTasks.some((p) => (graph[p] || []).includes(other));

              if (canRunTogether) {
                phaseTasks.push(other);
                processed.add(other);
              }
            }
          }

          parallelizable[`phase${phaseNum}`] = phaseTasks;
          phaseNum++;
        }
      }

      // Calculate critical path (longest dependency chain)
      let maxChain: string[] = [];

      const dfs = (taskId: string, chain: string[]) => {
        chain.push(taskId);
        const deps = graph[taskId] || [];
        if (deps.length === 0) {
          if (chain.length > maxChain.length) maxChain = [...chain];
        } else {
          for (const dep of deps) dfs(dep, [...chain]);
        }
      };

      for (const taskId of optimalOrder.filter((id) => (graph[id] || []).length === 0)) {
        dfs(taskId, []);
      }

      return {
        success: true,
        optimalOrder: optimalOrder.length === tasks.length ? optimalOrder : [],
        parallelizable,
        criticalPath: maxChain,
        warnings,
        totalDeps: Object.values(graph).flat().length,
        hasCircularDeps,
        message: optimalOrder.length === tasks.length
          ? `Execution plan ready: ${optimalOrder.length} tasks, ${Object.keys(parallelizable).length} parallel phases`
          : 'Could not compute optimal order due to circular dependencies',
      };
    } catch (error) {
      return {
        success: false,
        optimalOrder: [],
        parallelizable: {},
        criticalPath: [],
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getWorkflowMetrics(input: GetWorkflowMetricsInput): Promise<GetWorkflowMetricsResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);

      const alerts: WorkflowAlert[] = [];
      let rejectedCount = 0;
      let reworkCycles = 0;
      let longestWait: { taskId: string; duration: number; status: TaskStatus } | null = null;

      const rejectionRate: Record<string, number> = {
        productDirector: 0, architect: 0, uiUxExpert: 0, securityOfficer: 0,
      };

      for (const task of taskFile.tasks) {
        for (const transition of task.transitions) {
          if (transition.to === 'NeedsRefinement') {
            if (transition.approver && transition.approver in rejectionRate) {
              rejectionRate[transition.approver]++;
              rejectedCount++;
            }
          }
          if (transition.to === 'NeedsChanges') {
            reworkCycles++;
          }
        }

        if (task.transitions.length > 0) {
          const lastTransition = task.transitions[task.transitions.length - 1];
          const waitTime = new Date().getTime() - new Date(lastTransition.timestamp).getTime();
          if (!longestWait || waitTime > longestWait.duration) {
            longestWait = { taskId: task.taskId, duration: waitTime, status: task.status };
          }
        }
      }

      let healthScore = 100;
      const totalTasks = taskFile.tasks.length;
      const completedTasks = taskFile.tasks.filter((t) => t.status === 'Done').length;
      const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

      healthScore -= rejectedCount * 5;
      healthScore -= reworkCycles * 3;
      healthScore += completionRate * 30;
      healthScore = Math.max(0, Math.min(100, healthScore));

      if (rejectedCount > totalTasks * 0.2) {
        alerts.push({
          level: 'warning',
          msg: `High rejection rate: ${rejectedCount} rejections out of ${totalTasks} tasks (${((rejectedCount / totalTasks) * 100).toFixed(0)}%)`,
        });
      }
      if (reworkCycles > totalTasks * 0.3) {
        alerts.push({
          level: 'warning',
          msg: `High rework cycles: ${reworkCycles} cycles (expect 0-${totalTasks * 0.3})`,
        });
      }
      if (longestWait && longestWait.duration > 3600000) {
        const hours = (longestWait.duration / 3600000).toFixed(1);
        alerts.push({
          level: 'warning',
          msg: `Task ${longestWait.taskId} stuck in ${longestWait.status} for ${hours} hours`,
        });
      }
      if (completedTasks === 0 && totalTasks > 0) {
        alerts.push({ level: 'info', msg: `Workflow just started: ${totalTasks} tasks pending` });
      }

      // Rubber-stamp detection
      const totalReviews = Object.values(rejectionRate).reduce((sum, v) => sum + v, 0) +
        taskFile.tasks.reduce((count, t) => {
          let reviews = 0;
          if (t.stakeholderReview.productDirector?.approved) reviews++;
          if (t.stakeholderReview.architect?.approved) reviews++;
          if (t.stakeholderReview.uiUxExpert?.approved) reviews++;
          if (t.stakeholderReview.securityOfficer?.approved) reviews++;
          return count + reviews;
        }, 0);

      if (totalReviews >= 4 && rejectedCount === 0) {
        alerts.push({
          level: 'warning',
          msg: `Zero rejections across ${totalReviews} reviews — potential rubber-stamping detected. Consider whether reviews are providing substantive feedback.`,
        });
        healthScore -= 10;
        healthScore = Math.max(0, Math.min(100, healthScore));
      }

      const result: GetWorkflowMetricsResult = {
        success: true,
        healthScore: Math.round(healthScore),
        totalTasks,
        completedTasks,
        rejectionRate,
        reworkCycles,
        alerts,
        message: `Workflow health score: ${Math.round(healthScore)}/100 (${completedTasks}/${totalTasks} complete)`,
      };

      if (longestWait) {
        result.longestWaitingTask = {
          taskId: longestWait.taskId,
          status: longestWait.status,
          duration: `${(longestWait.duration / 60000).toFixed(0)} minutes`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        healthScore: 0,
        alerts: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getSimilarTasks(input: GetSimilarTasksInput): Promise<GetSimilarTasksResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);
      const referenceTask = taskFile.tasks.find((t) => t.taskId === input.taskId);

      if (!referenceTask) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      const allFeatures = this.db.getAllFeatures(input.repoName);
      const similarTasks: SimilarTask[] = [];

      for (const feature of allFeatures) {
        if (feature.featureSlug === input.featureSlug) continue;

        const featureFile = await this.db.loadByFeatureSlug(feature.featureSlug, input.repoName);

        for (const task of featureFile.tasks) {
          let score = 0;

          const refWords = referenceTask.title.toLowerCase().split(/\s+/);
          const taskWords = task.title.toLowerCase().split(/\s+/);
          const sharedWords = refWords.filter((w) => taskWords.includes(w));
          score += sharedWords.length * 10;

          const refTags = referenceTask.tags || [];
          const taskTags = task.tags || [];
          const sharedTags = refTags.filter((t) => taskTags.includes(t));
          score += sharedTags.length * 15;

          if (score > 0) {
            similarTasks.push({
              featureSlug: feature.featureSlug,
              taskId: task.taskId,
              title: task.title,
              status: task.status,
              similarity: score,
              sharedTags,
            });
          }
        }
      }

      similarTasks.sort((a, b) => b.similarity - a.similarity);
      const limit = input.limit || 5;
      const topSimilar = similarTasks.slice(0, limit);

      return {
        success: true,
        referenceTask: {
          taskId: referenceTask.taskId,
          title: referenceTask.title,
          tags: referenceTask.tags,
        },
        similarTasks: topSimilar,
        message: `Found ${topSimilar.length} similar task(s) for ${input.taskId}`,
      };
    } catch (error) {
      return {
        success: false,
        similarTasks: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
