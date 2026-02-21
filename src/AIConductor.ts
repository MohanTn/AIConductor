/**
 * AIConductor - Core business logic for task review operations
 */
import {
  ReviewInput,
  ReviewResult,
  TaskStatusResult,
  ReviewSummary,
  ValidationResult,
  Transition,
  TaskStatus,
  StakeholderRole,
  PipelineRole,
  Task,
  TransitionTaskInput,
  TransitionTaskResult,
  GetNextTaskInput,
  GetNextTaskResult,
  GetNextStepInput,
  GetNextStepResult,
  UpdateAcceptanceCriteriaInput,
  UpdateAcceptanceCriteriaResult,
  GetTasksByStatusInput,
  GetTasksByStatusResult,
  VerifyAllTasksCompleteInput,
  VerifyAllTasksCompleteResult,
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
  UpdateRefinementStepInput,
  UpdateRefinementStepResult,
  AddFeatureAcceptanceCriteriaInput,
  AddFeatureAcceptanceCriteriaResult,
  AddFeatureTestScenariosInput,
  AddFeatureTestScenariosResult,
  AddClarificationInput,
  AddClarificationResult,
  AddAttachmentAnalysisInput,
  AddAttachmentAnalysisResult,
  GetRefinementStatusInput,
  GetRefinementStatusResult,
  GenerateRefinementReportInput,
  GenerateRefinementReportResult,
  GetWorkflowSnapshotResult,
  BatchTransitionTasksInput,
  BatchTransitionTasksResult,
  BatchUpdateAcceptanceCriteriaInput,
  BatchUpdateAcceptanceCriteriaResult,
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
  ValidateReviewCompletenessInput,
  ValidateReviewCompletenessResult,
  GetSimilarTasksInput,
  GetSimilarTasksResult,
  WorkflowAlert,
  SimilarTask,
} from './types.js';
import { DatabaseHandler } from './DatabaseHandler.js';
import { WorkflowValidator } from './WorkflowValidator.js';
import { RolePromptConfig } from './rolePrompts.js';

export class AIConductor {
  private dbHandler: DatabaseHandler;
  private validator: WorkflowValidator;

  constructor(workspaceRoot?: string, dbPath?: string) {
    this.dbHandler = new DatabaseHandler(workspaceRoot, dbPath);
    this.validator = new WorkflowValidator();
  }

  /**
   * Add a stakeholder review to a task
   */
  async addReview(input: ReviewInput): Promise<ReviewResult> {
    try {
      // 1. Validate file exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      // 2. Load task file with lock
      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      // 3. Find specific task
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      // 4. Validate task structure
      const structureValidation = this.validator.validateTaskStructure(task);
      if (!structureValidation.valid) {
        throw new Error(
          `Invalid task structure: ${structureValidation.errors.join(', ')}`
        );
      }

      // 5. Validate workflow state
      const validation = this.validator.validate(
        task.status,
        input.stakeholder,
        input.decision
      );

      if (!validation.valid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }

      // 6. Calculate new status
      const previousStatus = task.status;
      const newStatus =
        input.decision === 'approve'
          ? this.getApprovalStatus(task.status)
          : 'NeedsRefinement';

      // 7. Build transition record
      const transition: Transition = {
        from: previousStatus,
        to: newStatus as TaskStatus,
        approver: input.stakeholder,
        timestamp: new Date().toISOString(),
        notes: input.notes,
      };

      // 8. Update stakeholder review section
      const reviewData = {
        approved: input.decision === 'approve',
        notes: input.notes,
      };

      // Add role-specific fields
      if (input.stakeholder === 'productDirector') {
        task.stakeholderReview.productDirector = {
          ...reviewData,
          marketAnalysis: input.additionalFields?.marketAnalysis,
          competitorAnalysis: input.additionalFields?.competitorAnalysis,
        };
      } else if (input.stakeholder === 'architect') {
        task.stakeholderReview.architect = {
          ...reviewData,
          technologyRecommendations: input.additionalFields?.technologyRecommendations,
          designPatterns: input.additionalFields?.designPatterns,
        };
      } else if (input.stakeholder === 'uiUxExpert') {
        task.stakeholderReview.uiUxExpert = {
          ...reviewData,
          usabilityFindings: input.additionalFields?.usabilityFindings,
          accessibilityRequirements: input.additionalFields?.accessibilityRequirements,
          userBehaviorInsights: input.additionalFields?.userBehaviorInsights,
        };
      } else if (input.stakeholder === 'securityOfficer') {
        task.stakeholderReview.securityOfficer = {
          ...reviewData,
          securityRequirements: input.additionalFields?.securityRequirements,
          complianceNotes: input.additionalFields?.complianceNotes,
        };
      } else {
        (task.stakeholderReview as any)[input.stakeholder] = reviewData;
      }

      // 9. Update task object
      task.status = newStatus as TaskStatus;
      task.transitions.push(transition);

      // 10. Save atomically
      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

      return {
        success: true,
        taskId: input.taskId,
        previousStatus,
        newStatus: newStatus as TaskStatus,
        transition,
        message: validation.warnings.length > 0
          ? `Review recorded with warnings: ${validation.warnings.join(', ')}`
          : 'Review recorded successfully',
      };
    } catch (error) {
      return {
        success: false,
        taskId: input.taskId,
        previousStatus: 'PendingProductDirector' as TaskStatus,
        newStatus: 'PendingProductDirector' as TaskStatus,
        transition: {
          from: 'PendingProductDirector' as TaskStatus,
          to: 'PendingProductDirector' as TaskStatus,
          approver: input.stakeholder,
          timestamp: new Date().toISOString(),
          notes: '',
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get status of a specific task
   */
  async getTaskStatus(repoName: string, featureSlug: string, taskId: string): Promise<TaskStatusResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);

      const task = taskFile.tasks.find((t) => t.taskId === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const progress = this.validator.getReviewProgress(task);
      const allowedTransitions = this.validator.getAllowedTransitions(task.status);

      return {
        taskId: task.taskId,
        status: task.status,
        currentStakeholder: progress.currentStakeholder,
        completedReviews: progress.completed,
        pendingReviews: progress.pending,
        canTransitionTo: allowedTransitions,
        orderOfExecution: task.orderOfExecution,
      };
    } catch (error) {
      throw new Error(
        `Failed to get task status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate review summary for all tasks
   */
  async getReviewSummary(repoName: string, featureSlug: string): Promise<ReviewSummary> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);

      // Count tasks by status
      const tasksByStatus: Record<TaskStatus, number> = {
        PendingProductDirector: 0,
        PendingArchitect: 0,
        PendingUiUxExpert: 0,
        PendingSecurityOfficer: 0,
        ReadyForDevelopment: 0,
        NeedsRefinement: 0,
        ToDo: 0,
        InProgress: 0,
        InReview: 0,
        InQA: 0,
        NeedsChanges: 0,
        Done: 0,
      };

      // Track stakeholder progress
      const stakeholderProgress = {
        productDirector: { completed: 0, pending: 0 },
        architect: { completed: 0, pending: 0 },
        uiUxExpert: { completed: 0, pending: 0 },
        securityOfficer: { completed: 0, pending: 0 },
      };

      // Analyze each task
      const taskSummaries = taskFile.tasks.map((task) => {
        tasksByStatus[task.status]++;

        const progress = this.validator.getReviewProgress(task);

        // Update stakeholder progress
        for (const stakeholder of progress.completed) {
          stakeholderProgress[stakeholder].completed++;
        }
        for (const stakeholder of progress.pending) {
          stakeholderProgress[stakeholder].pending++;
        }

        return {
          taskId: task.taskId,
          title: task.title,
          status: task.status,
          estimatedHours: task.estimatedHours,
          orderOfExecution: task.orderOfExecution,
        };
      });

      // Calculate completion percentage
      const completedTasks = tasksByStatus.ReadyForDevelopment;
      const totalTasks = taskFile.tasks.length;
      const completionPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      return {
        featureSlug: taskFile.featureSlug,
        featureName: taskFile.featureName,
        totalTasks,
        tasksByStatus,
        completionPercentage: Math.round(completionPercentage * 100) / 100,
        stakeholderProgress,
        tasks: taskSummaries,
      };
    } catch (error) {
      throw new Error(
        `Failed to generate review summary: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate workflow before performing a review
   */
  async validateWorkflow(
    repoName: string,
    featureSlug: string,
    taskId: string,
    stakeholder: StakeholderRole
  ): Promise<ValidationResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);

      const task = taskFile.tasks.find((t) => t.taskId === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      return this.validator.validate(task.status, stakeholder, 'approve');
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        currentStatus: 'PendingProductDirector',
        expectedStakeholder: null,
        allowedTransitions: [],
      };
    }
  }

  /**
   * Helper to get approval status for each stage
   */
  private getApprovalStatus(currentStatus: TaskStatus): TaskStatus {
    const statusMap: Record<TaskStatus, TaskStatus> = {
      PendingProductDirector: 'PendingArchitect',
      PendingArchitect: 'PendingUiUxExpert',
      PendingUiUxExpert: 'PendingSecurityOfficer',
      PendingSecurityOfficer: 'ReadyForDevelopment',
      ReadyForDevelopment: 'ReadyForDevelopment',
      NeedsRefinement: 'NeedsRefinement',
      ToDo: 'ToDo',
      InProgress: 'InProgress',
      InReview: 'InReview',
      InQA: 'InQA',
      NeedsChanges: 'NeedsChanges',
      Done: 'Done',
    };
    return statusMap[currentStatus];
  }

  /**
   * Get the next step in the pipeline for a task.
   * Returns the role, system prompt, allowed decisions, and context.
   */
  async getNextStep(input: GetNextStepInput): Promise<GetNextStepResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      const status = task.status;

      // Map current status to the pipeline role that should act
      const roleMapping: Record<TaskStatus, PipelineRole | null> = {
        PendingProductDirector: 'productDirector',
        PendingArchitect: 'architect',
        PendingUiUxExpert: 'uiUxExpert',
        PendingSecurityOfficer: 'securityOfficer',
        ReadyForDevelopment: 'developer',
        ToDo: 'developer',
        InProgress: 'developer',
        InReview: 'codeReviewer',
        InQA: 'qa',
        NeedsChanges: 'developer',
        NeedsRefinement: 'productDirector',
        Done: null,
      };

      const nextRole = roleMapping[status];
      if (!nextRole) {
        return {
          success: true,
          taskId: input.taskId,
          currentStatus: status,
          phase: 'execution',
          nextRole: 'qa',
          systemPrompt: '',
          allowedDecisions: [],
          transitionOnSuccess: 'Done',
          transitionOnFailure: 'Done',
          focusAreas: [],
          researchInstructions: '',
          requiredOutputFields: [],
          previousRoleNotes: {},
          message: 'Task is complete. No further steps.',
        };
      }

      // T03: Read role config from DB (allows user customization); falls back to static default
      const roleConfig = this.dbHandler.getRolePrompt(nextRole);

      // Determine transitions based on current status
      const { transitionOnSuccess, transitionOnFailure, allowedDecisions } =
        this.getTransitionsForStatus(status);

      // Gather previous role notes for context
      const previousRoleNotes = this.gatherPreviousNotes(task);

      // Build context-enhanced system prompt
      const contextualPrompt = this.buildContextualPrompt(
        roleConfig.systemPrompt, task, previousRoleNotes
      );

      return {
        success: true,
        taskId: input.taskId,
        currentStatus: status,
        phase: roleConfig.phase,
        nextRole,
        systemPrompt: contextualPrompt,
        allowedDecisions,
        transitionOnSuccess,
        transitionOnFailure,
        focusAreas: roleConfig.focusAreas,
        researchInstructions: roleConfig.researchInstructions,
        requiredOutputFields: roleConfig.requiredOutputFields,
        previousRoleNotes,
      };
    } catch (error) {
      return {
        success: false,
        taskId: input.taskId,
        currentStatus: 'PendingProductDirector',
        phase: 'review',
        nextRole: 'productDirector',
        systemPrompt: '',
        allowedDecisions: [],
        transitionOnSuccess: 'PendingProductDirector',
        transitionOnFailure: 'PendingProductDirector',
        focusAreas: [],
        researchInstructions: '',
        requiredOutputFields: [],
        previousRoleNotes: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get transition targets for a given status
   */
  private getTransitionsForStatus(status: TaskStatus): {
    transitionOnSuccess: TaskStatus;
    transitionOnFailure: TaskStatus;
    allowedDecisions: string[];
  } {
    const map: Record<TaskStatus, { transitionOnSuccess: TaskStatus; transitionOnFailure: TaskStatus; allowedDecisions: string[] }> = {
      PendingProductDirector: { transitionOnSuccess: 'PendingArchitect', transitionOnFailure: 'NeedsRefinement', allowedDecisions: ['approve', 'reject'] },
      PendingArchitect: { transitionOnSuccess: 'PendingUiUxExpert', transitionOnFailure: 'NeedsRefinement', allowedDecisions: ['approve', 'reject'] },
      PendingUiUxExpert: { transitionOnSuccess: 'PendingSecurityOfficer', transitionOnFailure: 'NeedsRefinement', allowedDecisions: ['approve', 'reject'] },
      PendingSecurityOfficer: { transitionOnSuccess: 'ReadyForDevelopment', transitionOnFailure: 'NeedsRefinement', allowedDecisions: ['approve', 'reject'] },
      NeedsRefinement: { transitionOnSuccess: 'PendingProductDirector', transitionOnFailure: 'PendingProductDirector', allowedDecisions: ['restart'] },
      ReadyForDevelopment: { transitionOnSuccess: 'ToDo', transitionOnFailure: 'ToDo', allowedDecisions: ['start'] },
      ToDo: { transitionOnSuccess: 'InProgress', transitionOnFailure: 'InProgress', allowedDecisions: ['start'] },
      InProgress: { transitionOnSuccess: 'InReview', transitionOnFailure: 'InProgress', allowedDecisions: ['submitForReview'] },
      InReview: { transitionOnSuccess: 'InQA', transitionOnFailure: 'NeedsChanges', allowedDecisions: ['approve', 'reject'] },
      InQA: { transitionOnSuccess: 'Done', transitionOnFailure: 'NeedsChanges', allowedDecisions: ['approve', 'reject'] },
      NeedsChanges: { transitionOnSuccess: 'InProgress', transitionOnFailure: 'InProgress', allowedDecisions: ['startFix'] },
      Done: { transitionOnSuccess: 'Done', transitionOnFailure: 'Done', allowedDecisions: [] },
    };
    return map[status];
  }

  /**
   * Gather notes from all previous roles for context
   */
  private gatherPreviousNotes(task: Task): Record<string, string> {
    const notes: Record<string, string> = {};
    if (task.stakeholderReview.productDirector?.notes) {
      notes.productDirector = task.stakeholderReview.productDirector.notes;
    }
    if (task.stakeholderReview.architect?.notes) {
      notes.architect = task.stakeholderReview.architect.notes;
    }
    if (task.stakeholderReview.uiUxExpert?.notes) {
      notes.uiUxExpert = task.stakeholderReview.uiUxExpert.notes;
    }
    if (task.stakeholderReview.securityOfficer?.notes) {
      notes.securityOfficer = task.stakeholderReview.securityOfficer.notes;
    }
    return notes;
  }

  /**
   * Build a context-enhanced system prompt with task details
   */
  private buildContextualPrompt(
    basePrompt: string,
    task: Task,
    previousNotes: Record<string, string>
  ): string {
    let contextBlock = `\n\n## Task Context\n`;
    contextBlock += `- **Task ID**: ${task.taskId}\n`;
    contextBlock += `- **Title**: ${task.title}\n`;
    contextBlock += `- **Description**: ${task.description}\n`;
    contextBlock += `- **Current Status**: ${task.status}\n`;

    if (task.acceptanceCriteria.length > 0) {
      contextBlock += `\n## Acceptance Criteria\n`;
      for (const ac of task.acceptanceCriteria) {
        contextBlock += `- [${ac.verified ? 'x' : ' '}] (${ac.priority}) ${ac.criterion}\n`;
      }
    }

    if (task.testScenarios && task.testScenarios.length > 0) {
      contextBlock += `\n## Test Scenarios\n`;
      for (const ts of task.testScenarios) {
        contextBlock += `- **${ts.id}** (${ts.priority}): ${ts.title} - ${ts.description}\n`;
      }
    }

    if (Object.keys(previousNotes).length > 0) {
      contextBlock += `\n## Previous Stakeholder Notes\n`;
      for (const [role, note] of Object.entries(previousNotes)) {
        contextBlock += `### ${role}\n${note}\n\n`;
      }
    }

    return basePrompt + contextBlock;
  }

  /**
   * Transition task to a new status (for development workflow)
   */
  async transitionTaskStatus(input: TransitionTaskInput): Promise<TransitionTaskResult> {
    try {
      // 1. Validate file exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      // 2. Load task file with lock
      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      // 3. Find specific task
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      // 4. Validate current status matches expected
      if (task.status !== input.fromStatus) {
        throw new Error(
          `Task status mismatch. Expected '${input.fromStatus}', but task is in '${task.status}'`
        );
      }

      // 5. Validate development workflow transition
      const validation = this.validator.validateDevTransition(
        input.fromStatus,
        input.toStatus,
        input.actor
      );

      if (!validation.valid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }

      // 6. Build transition record
      const transition: Transition = {
        from: input.fromStatus,
        to: input.toStatus,
        actor: input.actor,
        timestamp: new Date().toISOString(),
        notes: input.notes,
        ...input.metadata,
      };

      // 7. Update task
      task.status = input.toStatus;
      task.transitions.push(transition);

      // 8. Save atomically
      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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

  /**
   * Get next task to work on based on status filter and orderOfExecution
   */
  async getNextTask(input: GetNextTaskInput): Promise<GetNextTaskResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);

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

  /**
   * Update acceptance criteria verification status
   */
  async updateAcceptanceCriteria(
    input: UpdateAcceptanceCriteriaInput
  ): Promise<UpdateAcceptanceCriteriaResult> {
    try {
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

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

      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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

  /**
   * Get all tasks with a specific status
   */
  async getTasksByStatus(input: GetTasksByStatusInput): Promise<GetTasksByStatusResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);

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

  /**
   * Verify all tasks are complete
   */
  async verifyAllTasksComplete(
    input: VerifyAllTasksCompleteInput
  ): Promise<VerifyAllTasksCompleteResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);

      const totalTasks = taskFile.tasks.length;
      const completedTasks = taskFile.tasks.filter((t) => t.status === 'Done').length;
      const incompleteTasks = taskFile.tasks
        .filter((t) => t.status !== 'Done')
        .map((t) => ({
          taskId: t.taskId,
          title: t.title,
          status: t.status,
        }));

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

  /**
   * Create a new feature
   */
  async createFeature(input: CreateFeatureInput): Promise<CreateFeatureResult> {
    try {
      this.dbHandler.createFeature(input.featureSlug, input.featureName, input.repoName, input.description);

      // Initialize refinement steps (Steps 1-8)
      this.dbHandler.initializeRefinementSteps(input.repoName, input.featureSlug);

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

  /**
   * Update a feature's name and/or description
   */
  async updateFeature(input: UpdateFeatureInput): Promise<UpdateFeatureResult> {
    try {
      if (!input.featureName && input.description === undefined) {
        return {
          success: false,
          featureSlug: input.featureSlug,
          error: 'At least one of featureName or description must be provided',
        };
      }
      this.dbHandler.updateFeature(input.featureSlug, input.repoName, {
        featureName: input.featureName,
        description: input.description,
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

  /**
   * Add a task to a feature
   */
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

      const taskId = this.dbHandler.addTask(input.featureSlug, task, input.repoName);
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

  /**
   * List all features
   */
  async listFeatures(repoName: string): Promise<ListFeaturesResult> {
    try {
      const features = this.dbHandler.getAllFeatures(repoName);
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

  /**
   * Delete a repo and all its features, tasks, and related data
   */
  async deleteRepo(repoName: string): Promise<DeleteRepoResult> {
    try {
      const result = this.dbHandler.deleteRepo(repoName);
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

  /**
   * Delete a feature and all its tasks
   */
  async deleteFeature(repoName: string, featureSlug: string): Promise<DeleteFeatureResult> {
    try {
      this.dbHandler.deleteFeature(featureSlug, repoName);
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

  /**
   * Get a complete feature with all tasks
   */
  async getFeature(repoName: string, featureSlug: string): Promise<GetFeatureResult> {
    try {
      const feature = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);
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

  /**
   * Update an existing task
   */
  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
    try {
      // Validate feature exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid feature: ${fileValidation.error}`);
      }

      // Load task to verify it exists
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      // Validate updates - ensure we're not trying to update status here
      if ('status' in input.updates) {
        throw new Error('Cannot update task status via update_task. Use transition_task_status instead.');
      }

      // Validate that we have at least one field to update
      if (Object.keys(input.updates).length === 0) {
        throw new Error('No fields to update');
      }

      // Perform the update
      this.dbHandler.updateTask(input.featureSlug, input.taskId, input.updates as Partial<Task>, input.repoName);

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

  /**
   * Delete a task
   */
  async deleteTask(repoName: string, featureSlug: string, taskId: string): Promise<DeleteTaskResult> {
    try {
      // Validate feature exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(featureSlug, repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid feature: ${fileValidation.error}`);
      }

      // Load task file to check for dependencies
      const taskFile = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);
      const task = taskFile.tasks.find((t) => t.taskId === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Check if other tasks depend on this one
      const dependentTasks = taskFile.tasks.filter((t) =>
        t.dependencies && t.dependencies.includes(taskId)
      );

      // Perform deletion
      this.dbHandler.deleteTask(featureSlug, taskId, repoName);

      let message = `Task '${taskId}' deleted successfully`;
      if (dependentTasks.length > 0) {
        const depIds = dependentTasks.map((t) => t.taskId).join(', ');
        message += `. Warning: ${dependentTasks.length} task(s) had dependencies on this task: ${depIds}`;
      }

      return {
        success: true,
        featureSlug,
        taskId,
        message,
      };
    } catch (error) {
      return {
        success: false,
        featureSlug,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Register a new repository
   */
  async registerRepo(input: RegisterRepoInput): Promise<RegisterRepoResult> {
    try {
      this.dbHandler.registerRepo(
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

  /**
   * List all registered repositories
   */
  async listRepos(): Promise<ListReposResult> {
    try {
      const repos = this.dbHandler.getAllRepos();
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

  /**
   * Get current repository based on working directory
   */
  async getCurrentRepo(): Promise<GetCurrentRepoResult> {
    try {
      const currentRepo = this.dbHandler.getCurrentRepo();
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

  /**
   * Update a refinement step
   */
  async updateRefinementStep(input: UpdateRefinementStepInput): Promise<UpdateRefinementStepResult> {
    try {
      this.dbHandler.updateRefinementStep(
        input.repoName,
        input.featureSlug,
        input.stepNumber,
        input.completed,
        input.summary,
        input.data
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        stepNumber: input.stepNumber,
        completed: input.completed,
        message: `Refinement step ${input.stepNumber} updated for feature '${input.featureSlug}' (${input.completed ? 'completed' : 'in progress'})`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        stepNumber: input.stepNumber,
        completed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add feature-level acceptance criteria
   */
  async addFeatureAcceptanceCriteria(input: AddFeatureAcceptanceCriteriaInput): Promise<AddFeatureAcceptanceCriteriaResult> {
    try {
      const count = this.dbHandler.addFeatureAcceptanceCriteria(
        input.repoName,
        input.featureSlug,
        input.criteria
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        criteriaAdded: count,
        message: `Added ${count} acceptance criteria to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        criteriaAdded: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add feature-level test scenarios
   */
  async addFeatureTestScenarios(input: AddFeatureTestScenariosInput): Promise<AddFeatureTestScenariosResult> {
    try {
      const count = this.dbHandler.addFeatureTestScenarios(
        input.repoName,
        input.featureSlug,
        input.scenarios
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        scenariosAdded: count,
        message: `Added ${count} test scenarios to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        scenariosAdded: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add a clarification question
   */
  async addClarification(input: AddClarificationInput): Promise<AddClarificationResult> {
    try {
      const clarificationId = this.dbHandler.addClarification(
        input.repoName,
        input.featureSlug,
        input.question,
        input.answer,
        input.askedBy
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        clarificationId,
        message: `Clarification added to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        clarificationId: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add attachment analysis
   */
  async addAttachmentAnalysis(input: AddAttachmentAnalysisInput): Promise<AddAttachmentAnalysisResult> {
    try {
      const attachmentId = this.dbHandler.addAttachmentAnalysis(
        input.repoName,
        input.featureSlug,
        input.attachmentName,
        input.attachmentType,
        input.analysisSummary,
        input.filePath,
        input.fileUrl,
        input.extractedData
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        attachmentId,
        message: `Attachment '${input.attachmentName}' analyzed and saved for feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        attachmentId: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get refinement status for a feature
   */
  async getRefinementStatus(input: GetRefinementStatusInput): Promise<GetRefinementStatusResult> {
    try {
      const status = this.dbHandler.getRefinementStatus(input.repoName, input.featureSlug);
      return {
        success: true,
        ...status,
        message: `Refinement status retrieved for feature '${input.featureSlug}' (${status.progressPercentage}% complete)`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        featureName: '',
        currentStep: '',
        progressPercentage: 0,
        completedSteps: 0,
        totalSteps: 0,
        steps: [],
        acceptanceCriteriaCount: 0,
        testScenariosCount: 0,
        clarificationsCount: 0,
        attachmentsCount: 0,
        tasksCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a refinement report in specified format
   */
  async generateRefinementReport(input: GenerateRefinementReportInput): Promise<GenerateRefinementReportResult> {
    try {
      const status = this.dbHandler.getRefinementStatus(input.repoName, input.featureSlug);

      // Determine which sections to include
      const allSections = ['steps', 'criteria', 'scenarios', 'clarifications', 'attachments'];
      const sectionsToInclude = input.includeSections || allSections;

      let content = '';

      if (input.format === 'markdown') {
        // Build markdown report
        content = `# Feature Refinement Report: ${status.featureName}\n\n`;
        content += `**Feature Slug**: ${input.featureSlug}  \n`;
        content += `**Repository**: ${input.repoName}  \n`;
        content += `**Progress**: ${status.progressPercentage}% (${status.completedSteps}/${status.totalSteps} steps)  \n\n`;
        content += `---\n\n`;

        // Refinement steps
        if (sectionsToInclude.includes('steps')) {
          content += `## Refinement Steps\n\n`;
          for (const step of status.steps) {
            const icon = step.completed ? '✅' : '⏸️';
            content += `### ${icon} Step ${step.stepNumber}: ${step.stepName}\n`;
            if (step.summary) {
              content += `**Summary**: ${step.summary}\n`;
            }
            if (step.completedAt) {
              content += `**Completed**: ${new Date(step.completedAt).toLocaleString()}\n`;
            }
            content += `\n`;
          }
          content += `---\n\n`;
        }

        // Feature Acceptance Criteria
        if (sectionsToInclude.includes('criteria') && status.acceptanceCriteriaCount > 0) {
          content += `## Feature Acceptance Criteria (${status.acceptanceCriteriaCount})\n\n`;
          const criteria = this.dbHandler.getFeatureAcceptanceCriteria(input.repoName, input.featureSlug);
          for (const ac of criteria) {
            content += `- **[${ac.criterionId}]** (${ac.priority}) ${ac.criterion}\n`;
          }
          content += `\n---\n\n`;
        }

        // Feature Test Scenarios
        if (sectionsToInclude.includes('scenarios') && status.testScenariosCount > 0) {
          content += `## Feature Test Scenarios (${status.testScenariosCount})\n\n`;
          const scenarios = this.dbHandler.getFeatureTestScenarios(input.repoName, input.featureSlug);
          for (const ts of scenarios) {
            content += `### ${ts.scenarioId}: ${ts.title} (${ts.priority})\n`;
            content += `${ts.description}\n`;
            if (ts.preconditions) {
              content += `**Preconditions**: ${ts.preconditions}\n`;
            }
            if (ts.expectedResult) {
              content += `**Expected Result**: ${ts.expectedResult}\n`;
            }
            content += `\n`;
          }
          content += `---\n\n`;
        }

        // Clarifications
        if (sectionsToInclude.includes('clarifications') && status.clarificationsCount > 0) {
          content += `## Clarifications (${status.clarificationsCount})\n\n`;
          const clarifications = this.dbHandler.getClarifications(input.repoName, input.featureSlug);
          for (const clarification of clarifications) {
            content += `**Q**: ${clarification.question}\n`;
            if (clarification.answer) {
              content += `**A**: ${clarification.answer}\n`;
            } else {
              content += `**A**: _Pending response_\n`;
            }
            content += `\n`;
          }
          content += `---\n\n`;
        }

        // Attachments
        if (sectionsToInclude.includes('attachments') && status.attachmentsCount > 0) {
          content += `## Analyzed Attachments (${status.attachmentsCount})\n\n`;
          const attachments = this.dbHandler.getAttachments(input.repoName, input.featureSlug);
          for (const attachment of attachments) {
            content += `### ${attachment.attachmentName} (${attachment.attachmentType})\n`;
            content += `${attachment.analysisSummary}\n`;
            if (attachment.filePath) {
              content += `**File**: ${attachment.filePath}\n`;
            }
            if (attachment.fileUrl) {
              content += `**URL**: ${attachment.fileUrl}\n`;
            }
            content += `\n`;
          }
        }
      } else if (input.format === 'json') {
        // JSON format
        content = JSON.stringify(status, null, 2);
      } else {
        // HTML format (basic implementation)
        content = `<html><head><title>Refinement Report: ${status.featureName}</title></head><body>`;
        content += `<h1>Feature Refinement Report: ${status.featureName}</h1>`;
        content += `<p>Progress: ${status.progressPercentage}%</p>`;
        content += `</body></html>`;
      }

      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        format: input.format,
        content,
        sectionsIncluded: sectionsToInclude,
        message: `Refinement report generated for feature '${input.featureSlug}' in ${input.format} format`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        format: input.format,
        content: '',
        sectionsIncluded: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get a compressed workflow snapshot for a feature (Recommendation 1: Context Compression)
   * Returns: feature summary, task snapshot, blockages, and recommendations
   */
  async getWorkflowSnapshot(repoName: string, featureSlug: string): Promise<GetWorkflowSnapshotResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(featureSlug, repoName);

      // Count tasks by status group
      const statusCounts: Record<TaskStatus, number> = {
        PendingProductDirector: 0,
        PendingArchitect: 0,
        PendingUiUxExpert: 0,
        PendingSecurityOfficer: 0,
        ReadyForDevelopment: 0,
        NeedsRefinement: 0,
        ToDo: 0,
        InProgress: 0,
        InReview: 0,
        InQA: 0,
        NeedsChanges: 0,
        Done: 0,
      };

      // Map status to role for display
      const roleMapping: Record<TaskStatus, string | null> = {
        PendingProductDirector: 'Product Director',
        PendingArchitect: 'Architect',
        PendingUiUxExpert: 'UI/UX Expert',
        PendingSecurityOfficer: 'Security Officer',
        ReadyForDevelopment: null,
        NeedsRefinement: null,
        ToDo: null,
        InProgress: 'Developer',
        InReview: 'Code Reviewer',
        InQA: 'QA',
        NeedsChanges: 'Developer',
        Done: null,
      };

      // Build task snapshot
      const taskSnapshot = taskFile.tasks.map((task) => {
        statusCounts[task.status]++;

        // Get compact last decision from most recent transition or stakeholder review
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

      // Identify blockages
      const blockages = taskSnapshot
        .filter((t) => ['PendingProductDirector', 'PendingArchitect', 'PendingUiUxExpert', 'PendingSecurityOfficer', 'NeedsRefinement', 'NeedsChanges'].includes(t.status))
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

          return {
            taskId: t.taskId,
            status: t.status,
            reason,
            waitingSince,
          };
        });

      // Build summary
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

      // Calculate progress percentage
      const progress = totalTasks > 0 ? ((doneCount / totalTasks) * 100).toFixed(0) : '0';

      // Build recommendations
      const recommendations: string[] = [];

      if (readyCount > 0) {
        const readyTasks = taskSnapshot.filter((t) => t.status === 'ReadyForDevelopment').map((t) => t.taskId).join(', ');
        recommendations.push(`Start development on ${readyTasks}`);
      }

      if (needsRefinementCount > 0) {
        const needsRefinementTasks = taskSnapshot.filter((t) => t.status === 'NeedsRefinement').map((t) => t.taskId).join(', ');
        recommendations.push(`Fix and resubmit to Product Director: ${needsRefinementTasks}`);
      }

      if (needsChangesCount > 0) {
        const needsChangesTasks = taskSnapshot.filter((t) => t.status === 'NeedsChanges').map((t) => t.taskId).join(', ');
        recommendations.push(`Address feedback and restart dev phase: ${needsChangesTasks}`);
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

  /**
   * Batch transition multiple tasks (Recommendation 2: Batch Mutations)
   */
  async batchTransitionTasks(input: BatchTransitionTasksInput): Promise<BatchTransitionTasksResult> {
    try {
      // 1. Validate file exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      // 2. Load feature once with lock
      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      // 3. Process each task
      const results = [];
      for (const taskId of input.taskIds) {
        try {
          const task = taskFile.tasks.find((t) => t.taskId === taskId);
          if (!task) {
            results.push({
              taskId,
              success: false,
              previousStatus: input.fromStatus,
              newStatus: input.fromStatus,
              error: `Task not found: ${taskId}`,
            });
            continue;
          }

          // Validate current status
          if (task.status !== input.fromStatus) {
            results.push({
              taskId,
              success: false,
              previousStatus: task.status,
              newStatus: task.status,
              error: `Task status mismatch. Expected '${input.fromStatus}', but task is in '${task.status}'`,
            });
            continue;
          }

          // Validate transition
          const validation = this.validator.validateDevTransition(input.fromStatus, input.toStatus, input.actor);
          if (!validation.valid) {
            results.push({
              taskId,
              success: false,
              previousStatus: input.fromStatus,
              newStatus: input.fromStatus,
              error: `Workflow validation failed: ${validation.errors.join(', ')}`,
            });
            continue;
          }

          // Build transition record
          const transition: Transition = {
            from: input.fromStatus,
            to: input.toStatus,
            actor: input.actor,
            timestamp: new Date().toISOString(),
            notes: input.notes,
            ...input.metadata,
          };

          // Update task
          const previousStatus = task.status;
          task.status = input.toStatus;
          task.transitions.push(transition);

          results.push({
            taskId,
            success: true,
            previousStatus,
            newStatus: input.toStatus,
          });
        } catch (taskError) {
          results.push({
            taskId,
            success: false,
            previousStatus: input.fromStatus,
            newStatus: input.fromStatus,
            error: taskError instanceof Error ? taskError.message : String(taskError),
          });
        }
      }

      // 4. Save all changes atomically
      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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
          taskId,
          success: false,
          previousStatus: input.fromStatus,
          newStatus: input.fromStatus,
          error: error instanceof Error ? error.message : String(error),
        })),
        successCount: 0,
        failureCount: input.taskIds.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch update acceptance criteria (Recommendation 2: Batch Mutations)
   */
  async batchUpdateAcceptanceCriteria(
    input: BatchUpdateAcceptanceCriteriaInput
  ): Promise<BatchUpdateAcceptanceCriteriaResult> {
    try {
      // 1. Validate file exists
      const fileValidation = await this.dbHandler.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      // 2. Load feature once with lock
      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      // 3. Process each update
      const results = [];
      for (const update of input.updates) {
        try {
          const task = taskFile.tasks.find((t) => t.taskId === update.taskId);
          if (!task) {
            results.push({
              taskId: update.taskId,
              criterionId: update.criterionId,
              verified: update.verified,
              success: false,
              error: `Task not found: ${update.taskId}`,
            });
            continue;
          }

          const criterion = task.acceptanceCriteria.find((ac) => ac.id === update.criterionId);
          if (!criterion) {
            results.push({
              taskId: update.taskId,
              criterionId: update.criterionId,
              verified: update.verified,
              success: false,
              error: `Acceptance criterion not found: ${update.criterionId} in task ${update.taskId}`,
            });
            continue;
          }

          criterion.verified = update.verified;

          results.push({
            taskId: update.taskId,
            criterionId: update.criterionId,
            verified: update.verified,
            success: true,
          });
        } catch (updateError) {
          results.push({
            taskId: update.taskId,
            criterionId: update.criterionId,
            verified: update.verified,
            success: false,
            error: updateError instanceof Error ? updateError.message : String(updateError),
          });
        }
      }

      // 4. Save all changes atomically
      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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
          taskId: update.taskId,
          criterionId: update.criterionId,
          verified: update.verified,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        successCount: 0,
        failureCount: input.updates.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Save a workflow checkpoint (Recommendation 3)
   */
  async saveWorkflowCheckpoint(input: SaveWorkflowCheckpointInput): Promise<SaveWorkflowCheckpointResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);
      const checkpointId = this.dbHandler.saveCheckpoint(input.repoName, input.featureSlug, input.description, taskFile.tasks);

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

  /**
   * List all workflow checkpoints for a feature (Recommendation 3)
   */
  async listWorkflowCheckpoints(input: ListWorkflowCheckpointsInput): Promise<ListWorkflowCheckpointsResult> {
    try {
      const checkpoints = this.dbHandler.listCheckpoints(input.repoName, input.featureSlug);

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

  /**
   * Restore a workflow to a previous checkpoint (Recommendation 3)
   */
  async restoreWorkflowCheckpoint(input: RestoreWorkflowCheckpointInput): Promise<RestoreWorkflowCheckpointResult> {
    try {
      const checkpoint = this.dbHandler.getCheckpoint(input.repoName, input.featureSlug, input.checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${input.checkpointId}`);
      }

      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

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

      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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

  /**
   * Rollback the last decision on a task (Recommendation 3)
   */
  async rollbackLastDecision(input: RollbackLastDecisionInput): Promise<RollbackLastDecisionResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);
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

      await this.dbHandler.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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

  /**
   * Get optimal task execution plan with dependency analysis (Recommendation 4)
   */
  async getTaskExecutionPlan(input: GetTaskExecutionPlanInput): Promise<GetTaskExecutionPlanResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);

      // Build adjacency graph and detect cycles
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
        if (inDegree[taskId] === 0) {
          queue.push(taskId);
        }
      }

      const optimalOrder: string[] = [];
      const tempInDegree = { ...inDegree };

      while (queue.length > 0) {
        const taskId = queue.shift()!;
        optimalOrder.push(taskId);

        // For all dependent tasks
        for (const [depTaskId, deps] of Object.entries(graph)) {
          if (deps.includes(taskId)) {
            tempInDegree[depTaskId]--;
            if (tempInDegree[depTaskId] === 0) {
              queue.push(depTaskId);
            }
          }
        }
      }

      const hasCircularDeps = optimalOrder.length !== tasks.length;
      const warnings: string[] = [];

      if (hasCircularDeps) {
        warnings.push('Circular dependencies detected! Some tasks cannot be executed.');
      }

      // Identify tasks that block others
      for (const task of tasks) {
        const blocked = tasks.filter((t) => t.dependencies?.includes(task.taskId) || []).map((t) => t.taskId);
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

          // Find other tasks that can run in parallel (no dependencies on each other)
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
          if (chain.length > maxChain.length) {
            maxChain = [...chain];
          }
        } else {
          for (const dep of deps) {
            dfs(dep, [...chain]);
          }
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

  /**
   * Get workflow metrics and health score (Recommendation 5)
   */
  async getWorkflowMetrics(input: GetWorkflowMetricsInput): Promise<GetWorkflowMetricsResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);

      const alerts: WorkflowAlert[] = [];
      let rejectedCount = 0;
      let reworkCycles = 0;
      let longestWait: { taskId: string; duration: number; status: TaskStatus } | null = null;

      const rejectionRate: Record<string, number> = {
        productDirector: 0,
        architect: 0,
        uiUxExpert: 0,
        securityOfficer: 0,
      };

      // Analyze each task
      for (const task of taskFile.tasks) {
        // Count rejections by role
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

        // Find longest waiting task
        if (task.transitions.length > 0) {
          const lastTransition = task.transitions[task.transitions.length - 1];
          const waitTime = new Date().getTime() - new Date(lastTransition.timestamp).getTime();
          if (!longestWait || waitTime > longestWait.duration) {
            longestWait = {
              taskId: task.taskId,
              duration: waitTime,
              status: task.status,
            };
          }
        }
      }

      // Calculate health score (0-100)
      let healthScore = 100;
      const totalTasks = taskFile.tasks.length;
      const completedTasks = taskFile.tasks.filter((t) => t.status === 'Done').length;
      const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

      healthScore -= rejectedCount * 5; // -5 per rejection
      healthScore -= reworkCycles * 3; // -3 per rework
      healthScore += completionRate * 30; // +30 if all done

      healthScore = Math.max(0, Math.min(100, healthScore));

      // Generate alerts
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
        // >1 hour
        const hours = (longestWait.duration / 3600000).toFixed(1);
        alerts.push({
          level: 'warning',
          msg: `Task ${longestWait.taskId} stuck in ${longestWait.status} for ${hours} hours`,
        });
      }

      if (completedTasks === 0 && totalTasks > 0) {
        alerts.push({
          level: 'info',
          msg: `Workflow just started: ${totalTasks} tasks pending`,
        });
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

  /**
   * Validate review completeness before submission (Recommendation 7)
   */
  async validateReviewCompleteness(input: ValidateReviewCompletenessInput): Promise<ValidateReviewCompletenessResult> {
    const missingFields: string[] = [];

    // Define required fields by stakeholder role
    const requiredFields: Record<StakeholderRole, string[]> = {
      productDirector: ['notes', 'marketAnalysis'],
      architect: ['notes', 'technologyRecommendations', 'designPatterns'],
      uiUxExpert: ['notes', 'usabilityFindings', 'accessibilityRequirements'],
      securityOfficer: ['notes', 'securityRequirements', 'complianceNotes'],
    };

    const required = requiredFields[input.stakeholder] || [];

    // In practice, validation would check if these fields are present in the review
    // For now, we return the list of required fields
    const isComplete = true; // Validation logic would determine this

    const warnings: string[] = [];
    if (required.length > 0) {
      warnings.push(`This role requires ${required.length} field(s): ${required.join(', ')}`);
    }

    return {
      success: true,
      isComplete,
      missingFields,
      warnings,
      message: `Review completeness check for ${input.stakeholder}: ${required.length} required field(s)`,
    };
  }

  /**
   * Find similar tasks across features for reference (Recommendation 8)
   */
  async getSimilarTasks(input: GetSimilarTasksInput): Promise<GetSimilarTasksResult> {
    try {
      const taskFile = await this.dbHandler.loadByFeatureSlug(input.featureSlug, input.repoName);
      const referenceTask = taskFile.tasks.find((t) => t.taskId === input.taskId);

      if (!referenceTask) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      const allFeatures = this.dbHandler.getAllFeatures(input.repoName);
      const similarTasks: SimilarTask[] = [];

      // Search all features for similar tasks
      for (const feature of allFeatures) {
        if (feature.featureSlug === input.featureSlug) continue; // Skip current feature

        const featureFile = await this.dbHandler.loadByFeatureSlug(feature.featureSlug, input.repoName);

        for (const task of featureFile.tasks) {
          // Calculate similarity score
          let score = 0;

          // Title similarity (basic keyword matching)
          const refWords = referenceTask.title.toLowerCase().split(/\s+/);
          const taskWords = task.title.toLowerCase().split(/\s+/);
          const sharedWords = refWords.filter((w) => taskWords.includes(w));
          score += sharedWords.length * 10;

          // Tag similarity
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
              sharedTags: sharedTags,
            });
          }
        }
      }

      // Sort by similarity and limit
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

  // ─────────────────────────────────────────────────────────────────────
  // Queue & Worker Settings
  // ─────────────────────────────────────────────────────────────────────

  /** Return queue-specific settings as a typed object. */
  getQueueSettings(): { cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript?: string } {
    return this.dbHandler.getQueueSettings();
  }

  /** Update one or more queue-specific settings. */
  updateQueueSettings(updates: Partial<{ cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript: string }>): void {
    this.dbHandler.updateQueueSettings(updates);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dev Queue Operations
  // ─────────────────────────────────────────────────────────────────────

  /** Enqueue a feature for automated dev processing (feature-level, not task-level). */
  enqueueFeature(repoName: string, featureSlug: string, cliTool: string) {
    return this.dbHandler.enqueueFeature(repoName, featureSlug, cliTool);
  }

  /** Claim the next pending queue item for a worker. */
  claimNextQueueItem(workerPid: number) {
    return this.dbHandler.claimNextQueueItem(workerPid);
  }

  /** Mark a queue item as completed. */
  completeQueueItem(id: number) { this.dbHandler.completeQueueItem(id); }

  /** Mark a queue item as failed. */
  failQueueItem(id: number, errorMessage: string) { this.dbHandler.failQueueItem(id, errorMessage); }

  /** Get queue items, optionally filtered. */
  getQueueItems(repoName?: string, featureSlug?: string, status?: string) {
    return this.dbHandler.getQueueItems(repoName, featureSlug, status);
  }

  /** Get queue statistics. */
  getQueueStats() { return this.dbHandler.getQueueStats(); }

  /** Prune old completed/failed items. */
  pruneQueueItems(olderThanDays?: number) { return this.dbHandler.pruneQueueItems(olderThanDays); }

  /** Get a single queue item by ID. */
  getQueueItem(id: number) { return this.dbHandler.getQueueItem(id); }

  /** Re-enqueue a failed queue item (reset to pending). */
  reenqueueItem(id: number) { return this.dbHandler.reenqueueItem(id); }

  /** Cancel (remove) a pending queue item. */
  cancelQueueItem(id: number) { return this.dbHandler.cancelQueueItem(id); }

  // ─────────────────────────────────────────────────────────────────────
  // Role Prompt Settings
  // ─────────────────────────────────────────────────────────────────────

  /** Return all role prompt configs from the database. */
  getAllRolePrompts(): Array<RolePromptConfig & { roleId: string; isCustom: boolean; updatedAt: string }> {
    return this.dbHandler.getAllRolePrompts();
  }

  /** Return a single role prompt config from the database (falls back to static default). */
  getRolePrompt(roleId: PipelineRole): RolePromptConfig {
    return this.dbHandler.getRolePrompt(roleId);
  }

  /** Persist updated fields for a role prompt and mark it as custom. */
  updateRolePrompt(
    roleId: PipelineRole,
    update: Partial<Pick<RolePromptConfig, 'systemPrompt' | 'focusAreas' | 'researchInstructions' | 'requiredOutputFields'>>
  ): void {
    this.dbHandler.updateRolePrompt(roleId, update);
  }

  /** Reset a role prompt to its built-in static default. */
  resetRolePrompt(roleId: PipelineRole): RolePromptConfig {
    return this.dbHandler.resetRolePrompt(roleId);
  }
}
