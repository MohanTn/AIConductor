/**
 * ReviewService — handles all stakeholder review operations (refinement pipeline).
 *
 * Covers: addReview, getTaskStatus, getReviewSummary, validateWorkflow,
 *         getNextStep, validateReviewCompleteness and their private helpers.
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
  GetNextStepInput,
  GetNextStepResult,
  ValidateReviewCompletenessInput,
  ValidateReviewCompletenessResult,
} from '../types.js';
import { ServiceBase } from './ServiceBase.js';

export class ReviewService extends ServiceBase {

  // ─────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────

  async addReview(input: ReviewInput): Promise<ReviewResult> {
    try {
      // 1. Validate feature exists
      const fileValidation = await this.db.validateFeatureSlug(input.featureSlug, input.repoName);
      if (!fileValidation.valid) {
        throw new Error(`Invalid task file: ${fileValidation.error}`);
      }

      // 2. Load task file with lock
      const taskFile = await this.db.loadByFeatureSlugWithLock(input.featureSlug, input.repoName);

      // 3. Find specific task
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      // 4. Validate task structure
      const structureValidation = this.validator.validateTaskStructure(task);
      if (!structureValidation.valid) {
        throw new Error(`Invalid task structure: ${structureValidation.errors.join(', ')}`);
      }

      // 5. Validate workflow state
      const validation = this.validator.validate(task.status, input.stakeholder, input.decision);
      if (!validation.valid) {
        throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
      }

      // 5b. Enforce minimum review quality
      const MIN_REVIEW_NOTES_LENGTH = 50;
      if (!input.notes || input.notes.trim().length < MIN_REVIEW_NOTES_LENGTH) {
        throw new Error(
          `Review notes too short (${input.notes?.trim().length || 0} chars). ` +
          `Minimum ${MIN_REVIEW_NOTES_LENGTH} characters required for a substantive review.`
        );
      }

      // 5c. Enforce role-specific required fields
      const requiredAdditionalFields: Record<StakeholderRole, string[]> = {
        productDirector: ['marketAnalysis'],
        architect: ['technologyRecommendations', 'designPatterns'],
        uiUxExpert: ['usabilityFindings', 'accessibilityRequirements'],
        securityOfficer: ['securityRequirements', 'complianceNotes'],
      };
      const requiredFields = requiredAdditionalFields[input.stakeholder] || [];
      const missingFields: string[] = [];
      for (const field of requiredFields) {
        const value = input.additionalFields?.[field as keyof typeof input.additionalFields];
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
          missingFields.push(field);
        }
      }
      if (missingFields.length > 0) {
        throw new Error(
          `Missing required fields for ${input.stakeholder} review: ${missingFields.join(', ')}. ` +
          `Provide substantive content for each field.`
        );
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
      await this.db.saveByFeatureSlug(input.featureSlug, taskFile, input.repoName);

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

  async getTaskStatus(repoName: string, featureSlug: string, taskId: string): Promise<TaskStatusResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);

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

  async getReviewSummary(repoName: string, featureSlug: string): Promise<ReviewSummary> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);

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

      const stakeholderProgress = {
        productDirector: { completed: 0, pending: 0 },
        architect: { completed: 0, pending: 0 },
        uiUxExpert: { completed: 0, pending: 0 },
        securityOfficer: { completed: 0, pending: 0 },
      };

      const taskSummaries = taskFile.tasks.map((task) => {
        tasksByStatus[task.status]++;

        const progress = this.validator.getReviewProgress(task);

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

  async validateWorkflow(
    repoName: string,
    featureSlug: string,
    taskId: string,
    stakeholder: StakeholderRole
  ): Promise<ValidationResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(featureSlug, repoName);

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

  async getNextStep(input: GetNextStepInput): Promise<GetNextStepResult> {
    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }

      const status = task.status;

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

      // Read role config from DB (allows user customisation; falls back to static default)
      const roleConfig = this.db.getRolePrompt(nextRole);

      const { transitionOnSuccess, transitionOnFailure, allowedDecisions } =
        this.getTransitionsForStatus(status);

      const previousRoleNotes = this.gatherPreviousNotes(task);
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

  async validateReviewCompleteness(
    input: ValidateReviewCompletenessInput
  ): Promise<ValidateReviewCompletenessResult> {
    const missingFields: string[] = [];
    const warnings: string[] = [];

    const requiredFields: Record<StakeholderRole, { field: string; type: 'text' | 'array'; minLength?: number }[]> = {
      productDirector: [
        { field: 'notes', type: 'text', minLength: 50 },
        { field: 'marketAnalysis', type: 'text', minLength: 20 },
      ],
      architect: [
        { field: 'notes', type: 'text', minLength: 50 },
        { field: 'technologyRecommendations', type: 'array' },
        { field: 'designPatterns', type: 'array' },
      ],
      uiUxExpert: [
        { field: 'notes', type: 'text', minLength: 50 },
        { field: 'usabilityFindings', type: 'text', minLength: 20 },
        { field: 'accessibilityRequirements', type: 'array' },
      ],
      securityOfficer: [
        { field: 'notes', type: 'text', minLength: 50 },
        { field: 'securityRequirements', type: 'array' },
        { field: 'complianceNotes', type: 'text', minLength: 20 },
      ],
    };

    const required = requiredFields[input.stakeholder] || [];

    try {
      const taskFile = await this.db.loadByFeatureSlug(input.featureSlug, input.repoName);
      const task = taskFile.tasks.find((t) => t.taskId === input.taskId);

      if (!task) {
        return {
          success: false,
          isComplete: false,
          missingFields: [],
          warnings: [],
          error: `Task not found: ${input.taskId}`,
        };
      }

      const review = task.stakeholderReview?.[input.stakeholder];
      if (!review) {
        for (const req of required) {
          missingFields.push(req.field);
        }
      } else {
        for (const req of required) {
          const value = (review as any)[req.field];
          if (req.type === 'text') {
            const minLen = req.minLength || 20;
            if (!value || (typeof value === 'string' && value.trim().length < minLen)) {
              missingFields.push(`${req.field} (min ${minLen} chars, got ${value?.trim?.()?.length || 0})`);
            }
          } else if (req.type === 'array') {
            if (!value || !Array.isArray(value) || value.length === 0) {
              missingFields.push(`${req.field} (must be non-empty array)`);
            }
          }
        }
      }

      if (review?.notes) {
        const notes = review.notes.trim().toLowerCase();
        const rubberStampPhrases = ['lgtm', 'looks good', 'approved', 'ok', 'no issues', 'all good', 'fine'];
        if (rubberStampPhrases.some(phrase => notes === phrase || notes === `${phrase}.`)) {
          warnings.push('Review notes appear to be a rubber-stamp approval. Consider providing substantive analysis.');
        }
      }

      const isComplete = missingFields.length === 0;
      if (!isComplete) {
        warnings.push(`${missingFields.length} required field(s) are missing or insufficient`);
      }

      return {
        success: true,
        isComplete,
        missingFields,
        warnings,
        message: isComplete
          ? `Review for ${input.stakeholder} is complete — all ${required.length} required field(s) present`
          : `Review for ${input.stakeholder} is INCOMPLETE — missing: ${missingFields.join(', ')}`,
      };
    } catch (error) {
      return {
        success: false,
        isComplete: false,
        missingFields: [],
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────

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
}
