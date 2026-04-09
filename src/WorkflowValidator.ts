/**
 * WorkflowValidator - Enforces state machine rules for task reviews
 */
import {
  TaskStatus,
  StakeholderRole,
  ReviewDecision,
  ValidationResult,
  WORKFLOW_RULES,
  DEV_WORKFLOW_RULES,
  ActorType,
  Task,
} from './types.js';

export class WorkflowValidator {
  /**
   * Validate if a review transition is allowed
   */
  validate(
    currentStatus: TaskStatus,
    stakeholder: StakeholderRole,
    decision: ReviewDecision
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if status is a terminal state
    if (currentStatus === 'ReadyForDevelopment') {
      errors.push('Task is already in ReadyForDevelopment state (terminal state)');
      return {
        valid: false,
        errors,
        warnings,
        currentStatus,
        expectedStakeholder: null,
        allowedTransitions: [],
      };
    }

    if (currentStatus === 'NeedsRefinement') {
      errors.push(
        'Task is in NeedsRefinement state (terminal state). Manual intervention required to reset workflow.'
      );
      return {
        valid: false,
        errors,
        warnings,
        currentStatus,
        expectedStakeholder: null,
        allowedTransitions: [],
      };
    }

    // Get workflow rule for current status
    const rule = WORKFLOW_RULES[currentStatus];
    if (!rule) {
      errors.push(`No workflow rule defined for status: ${currentStatus}`);
      return {
        valid: false,
        errors,
        warnings,
        currentStatus,
        expectedStakeholder: null,
        allowedTransitions: [],
      };
    }

    // Validate correct stakeholder
    // For InRefinement (single-stage), only productDirector can review
    const expectedForStatus = currentStatus === 'InRefinement' ? 'productDirector' : rule.expectedStakeholder;
    if (expectedForStatus !== stakeholder) {
      errors.push(
        `Wrong stakeholder. Expected ${expectedForStatus}, got ${stakeholder}. ` +
          `Task at status ${currentStatus} requires review from ${expectedForStatus}.`
      );
    }

    // Calculate next status based on decision
    const nextStatus = decision === 'approve' ? rule.onApprove : rule.onReject;

    // Add warning if rejecting
    if (decision === 'reject') {
      warnings.push(`Task will be moved to ${nextStatus}. This requires manual workflow reset.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      currentStatus,
      expectedStakeholder: expectedForStatus,
      allowedTransitions: [rule.onApprove, rule.onReject],
    };
  }

  /**
   * Get current expected stakeholder for a task
   */
  getExpectedStakeholder(status: TaskStatus): StakeholderRole | null {
    // For InRefinement (single-stage), the expected stakeholder is productDirector
    if (status === 'InRefinement') {
      return 'productDirector';
    }
    const rule = WORKFLOW_RULES[status];
    return rule ? rule.expectedStakeholder : null;
  }

  /**
   * Get possible next statuses for a given status
   */
  getAllowedTransitions(status: TaskStatus): TaskStatus[] {
    const rule = WORKFLOW_RULES[status];
    if (!rule) return [];
    return [rule.onApprove, rule.onReject];
  }

  /**
   * Check if a task has completed all required reviews
   */
  getReviewProgress(task: Task): {
    completed: StakeholderRole[];
    pending: StakeholderRole[];
    currentStakeholder: StakeholderRole | null;
  } {
    const allStakeholders: StakeholderRole[] = [
      'productDirector',
      'architect',
      'uiUxExpert',
      'securityOfficer',
    ];

    const completed: StakeholderRole[] = [];
    const pending: StakeholderRole[] = [];

    // Check which stakeholders have approved
    if (task.stakeholderReview.productDirector?.approved) {
      completed.push('productDirector');
    } else if (task.status === 'PendingProductDirector') {
      pending.push('productDirector');
    }

    if (task.stakeholderReview.architect?.approved) {
      completed.push('architect');
    } else if (task.status === 'PendingArchitect') {
      pending.push('architect');
    }

    if (task.stakeholderReview.uiUxExpert?.approved) {
      completed.push('uiUxExpert');
    } else if (task.status === 'PendingUiUxExpert') {
      pending.push('uiUxExpert');
    }

    if (task.stakeholderReview.securityOfficer?.approved) {
      completed.push('securityOfficer');
    } else if (task.status === 'PendingSecurityOfficer') {
      pending.push('securityOfficer');
    }

    // Determine remaining pending reviews
    for (const stakeholder of allStakeholders) {
      if (!completed.includes(stakeholder) && !pending.includes(stakeholder)) {
        pending.push(stakeholder);
      }
    }

    // For single-stage refinement (InRefinement), currentStakeholder is null
    // because there's no specific "current" stakeholder in the single-stage model
    const currentStakeholder = task.status === 'InRefinement' ? null : this.getExpectedStakeholder(task.status);

    return { completed, pending, currentStakeholder };
  }

  /**
   * Validate task structure
   */
  validateTaskStructure(task: Task): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!task.taskId || task.taskId.trim() === '') {
      errors.push('Task ID is required');
    }

    if (!task.title || task.title.trim() === '') {
      errors.push('Task title is required');
    }

    if (!task.status) {
      errors.push('Task status is required');
    }

    if (task.estimatedHours !== undefined && task.estimatedHours < 0) {
      errors.push('Estimated hours cannot be negative');
    }

    if (!Array.isArray(task.transitions)) {
      errors.push('Transitions must be an array');
    }

    if (!task.stakeholderReview || typeof task.stakeholderReview !== 'object') {
      errors.push('Stakeholder review object is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if a status is a terminal state
   */
  isTerminalState(status: TaskStatus): boolean {
    return status === 'ReadyForDevelopment' || status === 'NeedsRefinement' || status === 'Done';
  }

  /**
   * Validate development workflow transition
   */
  validateDevTransition(
    currentStatus: TaskStatus,
    targetStatus: TaskStatus,
    actor: ActorType
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if current status exists in dev workflow rules
    const rule = DEV_WORKFLOW_RULES[currentStatus];
    if (!rule) {
      errors.push(`No development workflow rule defined for status: ${currentStatus}`);
      return {
        valid: false,
        errors,
        warnings,
        currentStatus,
        expectedStakeholder: null,
        allowedTransitions: [],
      };
    }

    // Check if actor is allowed for this status
    if (!rule.allowedActors.includes(actor)) {
      errors.push(
        `Actor '${actor}' is not allowed to perform actions on status '${currentStatus}'. ` +
          `Allowed actors: ${rule.allowedActors.join(', ')}`
      );
    }

    // Check if target status is allowed
    if (!rule.allowedTransitions.includes(targetStatus)) {
      errors.push(
        `Invalid transition from '${currentStatus}' to '${targetStatus}'. ` +
          `Allowed transitions: ${rule.allowedTransitions.join(', ')}`
      );
    }

    // Add warnings for specific transitions
    if (targetStatus === 'NeedsChanges') {
      warnings.push('Task requires changes. Will need to be re-reviewed.');
    }

    if (targetStatus === 'NeedsRefinement') {
      warnings.push('Task requires refinement. Will restart stakeholder review cycle.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      currentStatus,
      expectedStakeholder: null,
      allowedTransitions: rule.allowedTransitions,
    };
  }

  /**
   * Get allowed transitions for development workflow
   */
  getDevAllowedTransitions(status: TaskStatus): TaskStatus[] {
    const rule = DEV_WORKFLOW_RULES[status];
    return rule ? rule.allowedTransitions : [];
  }

  /**
   * Check if actor can perform action on given status
   */
  canActorTransition(status: TaskStatus, actor: ActorType): boolean {
    const rule = DEV_WORKFLOW_RULES[status];
    if (!rule) return false;
    return rule.allowedActors.includes(actor);
  }
}
