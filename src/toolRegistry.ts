/**
 * Tool handler registry.
 *
 * Each entry maps an MCP tool name to its implementation.
 * Handlers are created via a factory so dependencies (AIConductor, WebSocket
 * manager, broadcast helper) are injected once at startup rather than being
 * imported as singletons – making handlers independently testable.
 */
import { AIConductor } from './AIConductor.js';
import { broadcastEvent as BroadcastFn } from './broadcast.js';
import { WebSocketServerManager } from './websocket.js';
import { ReviewInput } from './types.js';
import {
  requireString,
  optionalString,
  requireEnum,
  optionalNumber,
  wrapResult,
  ToolResult,
} from './tool-helpers.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
type HandlerFn = (args: Args) => Promise<ToolResult>;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build a Map of tool-name → handler function, with all dependencies injected.
 *
 * @param reviewManager - Singleton AIConductor instance
 * @param wsManager     - WebSocket broadcast manager
 * @param broadcast     - Cross-process broadcast helper
 */
export function createToolHandlers(
  reviewManager: AIConductor,
  wsManager: WebSocketServerManager,
  broadcast: typeof BroadcastFn
): Map<string, HandlerFn> {
  const STAKEHOLDER_ROLES = [
    'productDirector',
    'architect',
    'uiUxExpert',
    'securityOfficer',
  ] as const;

  const handlers: Map<string, HandlerFn> = new Map([

    // ── Refinement workflow ────────────────────────────────────────────────

    ['get_next_step', async (args) => {
      const result = await reviewManager.getNextStep({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
      });
      return wrapResult(result);
    }],

    ['add_stakeholder_review', async (args) => {
      const DECISIONS = ['approve', 'reject'] as const;
      const input: ReviewInput = {
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        stakeholder: requireEnum(args, 'stakeholder', STAKEHOLDER_ROLES),
        decision: requireEnum(args, 'decision', DECISIONS),
        notes: requireString(args, 'notes'),
        additionalFields: args.additionalFields as any,
      };
      const result = await reviewManager.addReview(input);
      broadcast({
        type: 'task-status-changed',
        action: 'reviewed',
        repoName: input.repoName || 'default',
        featureSlug: input.featureSlug,
        taskId: input.taskId,
        stakeholder: input.stakeholder,
        decision: input.decision,
        newStatus: (result as any)?.task?.status,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['get_task_status', async (args) => {
      const result = await reviewManager.getTaskStatus(
        requireString(args, 'repoName'),
        requireString(args, 'featureSlug'),
        requireString(args, 'taskId')
      );
      return wrapResult(result);
    }],

    ['get_review_summary', async (args) => {
      const result = await reviewManager.getReviewSummary(
        requireString(args, 'repoName'),
        requireString(args, 'featureSlug')
      );
      return wrapResult(result);
    }],

    ['validate_workflow', async (args) => {
      const result = await reviewManager.validateWorkflow(
        requireString(args, 'repoName'),
        requireString(args, 'featureSlug'),
        requireString(args, 'taskId'),
        requireEnum(args, 'stakeholder', STAKEHOLDER_ROLES)
      );
      return wrapResult(result);
    }],

    ['validate_review_completeness', async (args) => {
      const result = await reviewManager.validateReviewCompleteness({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        stakeholder: requireEnum(args, 'stakeholder', STAKEHOLDER_ROLES),
      });
      return wrapResult(result);
    }],

    // ── Development workflow ───────────────────────────────────────────────

    ['transition_task_status', async (args) => {
      const input = {
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        fromStatus: requireString(args, 'fromStatus') as any,
        toStatus: requireString(args, 'toStatus') as any,
        actor: requireString(args, 'actor') as any,
        notes: optionalString(args, 'notes'),
        metadata: args.metadata as any,
      };
      const result = await reviewManager.transitionTaskStatus(input);
      broadcast({
        type: 'task-status-changed',
        action: 'transitioned',
        repoName: input.repoName || 'default',
        featureSlug: input.featureSlug,
        taskId: input.taskId,
        oldStatus: input.fromStatus,
        newStatus: input.toStatus,
        actor: input.actor,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['batch_transition_tasks', async (args) => {
      const batchInput = {
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskIds: args.taskIds as string[],
        fromStatus: requireString(args, 'fromStatus') as any,
        toStatus: requireString(args, 'toStatus') as any,
        actor: requireString(args, 'actor') as any,
        notes: optionalString(args, 'notes'),
        metadata: args.metadata as any,
      };
      const result = await reviewManager.batchTransitionTasks(batchInput);
      for (const taskId of batchInput.taskIds) {
        broadcast({
          type: 'task-status-changed',
          action: 'batch-transitioned',
          repoName: batchInput.repoName || 'default',
          featureSlug: batchInput.featureSlug,
          taskId,
          oldStatus: batchInput.fromStatus,
          newStatus: batchInput.toStatus,
          actor: batchInput.actor,
          timestamp: Date.now(),
        }).catch(() => {});
      }
      return wrapResult(result);
    }],

    ['get_next_task', async (args) => {
      const result = await reviewManager.getNextTask({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        statusFilter: args.statusFilter as any[],
      });
      return wrapResult(result);
    }],

    ['get_tasks_by_status', async (args) => {
      const result = await reviewManager.getTasksByStatus({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        status: requireString(args, 'status') as any,
      });
      return wrapResult(result);
    }],

    ['verify_all_tasks_complete', async (args) => {
      const result = await reviewManager.verifyAllTasksComplete({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
      });
      return wrapResult(result);
    }],

    ['get_workflow_snapshot', async (args) => {
      const result = await reviewManager.getWorkflowSnapshot(
        requireString(args, 'repoName'),
        requireString(args, 'featureSlug')
      );
      return wrapResult(result);
    }],

    ['get_workflow_metrics', async (args) => {
      const result = await reviewManager.getWorkflowMetrics({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
      });
      return wrapResult(result);
    }],

    ['get_task_execution_plan', async (args) => {
      const result = await reviewManager.getTaskExecutionPlan({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
      });
      return wrapResult(result);
    }],

    ['get_similar_tasks', async (args) => {
      const result = await reviewManager.getSimilarTasks({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        limit: optionalNumber(args, 'limit'),
      });
      return wrapResult(result);
    }],

    // ── Acceptance criteria & test scenarios ──────────────────────────────

    ['update_acceptance_criteria', async (args) => {
      const result = await reviewManager.updateAcceptanceCriteria({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        criterionId: requireString(args, 'criterionId'),
        verified: args.verified as boolean,
      });
      return wrapResult(result);
    }],

    ['batch_update_acceptance_criteria', async (args) => {
      const result = await reviewManager.batchUpdateAcceptanceCriteria({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        updates: args.updates as any,
      });
      return wrapResult(result);
    }],

    ['add_feature_acceptance_criteria', async (args) => {
      const repoName = requireString(args, 'repoName');
      const featureSlug = requireString(args, 'featureSlug');
      const result = await reviewManager.addFeatureAcceptanceCriteria({
        repoName,
        featureSlug,
        criteria: args.criteria as any[],
      });
      if (result.success) {
        wsManager.broadcast({
          type: 'feature-changed',
          action: 'criteria-added',
          featureSlug,
          repoName,
          criteriaCount: result.criteriaAdded,
          timestamp: Date.now(),
        });
      }
      return wrapResult(result);
    }],

    ['add_feature_test_scenarios', async (args) => {
      const repoName = requireString(args, 'repoName');
      const featureSlug = requireString(args, 'featureSlug');
      const result = await reviewManager.addFeatureTestScenarios({
        repoName,
        featureSlug,
        scenarios: args.scenarios as any[],
      });
      if (result.success) {
        wsManager.broadcast({
          type: 'feature-changed',
          action: 'scenarios-added',
          featureSlug,
          repoName,
          scenariosCount: result.scenariosAdded,
          timestamp: Date.now(),
        });
      }
      return wrapResult(result);
    }],

    // ── Feature CRUD ───────────────────────────────────────────────────────

    ['create_feature', async (args) => {
      const repoName = (args.repoName as string) || 'default';
      const featureSlug = args.featureSlug as string;
      const result = await reviewManager.createFeature({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        featureName: requireString(args, 'featureName'),
        description: optionalString(args, 'description'),
      });
      broadcast({
        type: 'feature-changed',
        action: 'created',
        repoName,
        featureSlug,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['update_feature', async (args) => {
      const repoName = (args.repoName as string) || 'default';
      const featureSlug = args.featureSlug as string;
      const result = await reviewManager.updateFeature({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        featureName: optionalString(args, 'featureName'),
        description: optionalString(args, 'description'),
      });
      broadcast({
        type: 'feature-changed',
        action: 'updated',
        repoName,
        featureSlug,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['get_feature', async (args) => {
      const result = await reviewManager.getFeature(
        requireString(args, 'repoName'),
        requireString(args, 'featureSlug')
      );
      return wrapResult(result);
    }],

    ['list_features', async (args) => {
      const result = await reviewManager.listFeatures(requireString(args, 'repoName'));
      return wrapResult(result);
    }],

    ['delete_feature', async (args) => {
      const repoName = requireString(args, 'repoName');
      const featureSlug = requireString(args, 'featureSlug');
      const result = await reviewManager.deleteFeature(repoName, featureSlug);
      broadcast({
        type: 'feature-changed',
        action: 'deleted',
        repoName: repoName || 'default',
        featureSlug,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    // ── Task CRUD ──────────────────────────────────────────────────────────

    ['add_task', async (args) => {
      const repoName = (args.repoName as string) || 'default';
      const featureSlug = args.featureSlug as string;
      const taskId = args.taskId as string;
      const result = await reviewManager.addTask({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        title: requireString(args, 'title'),
        description: requireString(args, 'description'),
        orderOfExecution: args.orderOfExecution as number,
        acceptanceCriteria: args.acceptanceCriteria as any,
        testScenarios: args.testScenarios as any,
        outOfScope: args.outOfScope as string[],
        estimatedHours: optionalNumber(args, 'estimatedHours'),
        dependencies: args.dependencies as string[],
        tags: args.tags as string[],
      });
      broadcast({
        type: 'feature-changed',
        action: 'task-added',
        repoName,
        featureSlug,
        taskId,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['update_task', async (args) => {
      const repoName = (args.repoName as string) || 'default';
      const featureSlug = args.featureSlug as string;
      const taskId = args.taskId as string;
      const result = await reviewManager.updateTask({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
        updates: args.updates as any,
      });
      broadcast({
        type: 'feature-changed',
        action: 'task-updated',
        repoName,
        featureSlug,
        taskId,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['delete_task', async (args) => {
      const repoName = requireString(args, 'repoName');
      const featureSlug = requireString(args, 'featureSlug');
      const taskId = requireString(args, 'taskId');
      const result = await reviewManager.deleteTask(repoName, featureSlug, taskId);
      broadcast({
        type: 'feature-changed',
        action: 'task-deleted',
        repoName: repoName || 'default',
        featureSlug,
        taskId,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    // ── Repository management ──────────────────────────────────────────────

    ['register_repo', async (args) => {
      const repoName = requireString(args, 'repoName');
      const result = await reviewManager.registerRepo({
        repoName,
        repoPath: requireString(args, 'repoPath'),
        repoUrl: optionalString(args, 'repoUrl'),
        defaultBranch: optionalString(args, 'defaultBranch'),
        metadata: args.metadata as Record<string, any> | undefined,
      });
      broadcast({
        type: 'repo-changed',
        action: 'created',
        repoName,
        timestamp: Date.now(),
      }).catch(() => {});
      return wrapResult(result);
    }],

    ['list_repos', async (_args) => {
      const result = await reviewManager.listRepos();
      return wrapResult(result);
    }],

    ['get_current_repo', async (_args) => {
      const result = await reviewManager.getCurrentRepo();
      return wrapResult(result);
    }],

    // ── Refinement steps & clarifications ─────────────────────────────────

    ['update_refinement_step', async (args) => {
      const result = await reviewManager.updateRefinementStep({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        stepNumber: args.stepNumber as number,
        completed: args.completed as boolean,
        summary: args.summary as string,
        data: args.data as Record<string, any> | undefined,
      });
      return wrapResult(result);
    }],

    ['add_clarification', async (args) => {
      const repoName = requireString(args, 'repoName');
      const featureSlug = requireString(args, 'featureSlug');
      const result = await reviewManager.addClarification({
        repoName,
        featureSlug,
        question: requireString(args, 'question'),
        answer: optionalString(args, 'answer'),
        askedBy: (args.askedBy as 'llm' | 'user') || 'llm',
      });
      if (result.success) {
        wsManager.broadcast({
          type: 'feature-changed',
          action: 'clarification-added',
          featureSlug,
          repoName,
          clarificationId: result.clarificationId,
          timestamp: Date.now(),
        });
      }
      return wrapResult(result);
    }],

    ['add_attachment_analysis', async (args) => {
      const result = await reviewManager.addAttachmentAnalysis({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        attachmentName: requireString(args, 'attachmentName'),
        attachmentType: requireEnum(args, 'attachmentType', [
          'excel', 'image', 'document', 'design',
        ] as const),
        analysisSummary: requireString(args, 'analysisSummary'),
        filePath: optionalString(args, 'filePath'),
        fileUrl: optionalString(args, 'fileUrl'),
        extractedData: args.extractedData as Record<string, any> | undefined,
      });
      return wrapResult(result);
    }],

    ['get_refinement_status', async (args) => {
      const result = await reviewManager.getRefinementStatus({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
      });
      return wrapResult(result);
    }],

    ['generate_refinement_report', async (args) => {
      const result = await reviewManager.generateRefinementReport({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        format: (args.format as 'markdown' | 'html' | 'json') || 'markdown',
        outputPath: optionalString(args, 'outputPath'),
        includeSections: args.includeSections as string[] | undefined,
      });
      return wrapResult(result);
    }],

    // ── Checkpoints & rollback ─────────────────────────────────────────────

    ['save_workflow_checkpoint', async (args) => {
      const result = await reviewManager.saveWorkflowCheckpoint({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        description: requireString(args, 'description'),
      });
      return wrapResult(result);
    }],

    ['list_workflow_checkpoints', async (args) => {
      const result = await reviewManager.listWorkflowCheckpoints({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
      });
      return wrapResult(result);
    }],

    ['restore_workflow_checkpoint', async (args) => {
      const result = await reviewManager.restoreWorkflowCheckpoint({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        checkpointId: args.checkpointId as number,
      });
      return wrapResult(result);
    }],

    ['rollback_last_decision', async (args) => {
      const result = await reviewManager.rollbackLastDecision({
        repoName: requireString(args, 'repoName'),
        featureSlug: requireString(args, 'featureSlug'),
        taskId: requireString(args, 'taskId'),
      });
      return wrapResult(result);
    }],

  ]);

  return handlers;
}
