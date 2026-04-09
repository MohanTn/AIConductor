/**
 * Progress calculation service for milestone-based feature completion tracking
 */

import { Task, TaskStatus } from '../types';

export interface ProgressMetrics {
  percentage: number;
  refinementCount: number;
  developmentCount: number;
  completedCount: number;
  totalCount: number;
}

/**
 * Categorizes a task status into a phase
 */
function getStatusPhase(status: TaskStatus): 'refinement' | 'development' | 'completed' {
  switch (status) {
    case 'InRefinement':
    case 'PendingProductDirector':
    case 'PendingArchitect':
    case 'PendingUiUxExpert':
    case 'PendingSecurityOfficer':
    case 'NeedsRefinement':
      return 'refinement';

    case 'ReadyForDevelopment':
    case 'ToDo':
    case 'InProgress':
    case 'InReview':
    case 'InQA':
    case 'NeedsChanges':
      return 'development';

    case 'Done':
      return 'completed';

    default:
      return 'refinement';
  }
}

/**
 * Calculates feature progress using milestone-based approach:
 * - Refinement phase (InRefinement, NeedsRefinement, etc): 0-50%
 * - Development phase (ReadyForDevelopment through InQA, NeedsChanges): 50-100%
 * - Done: 100%
 *
 * Calculation:
 * 1. Count tasks in each phase
 * 2. Refinement tasks progress: (count / total) * 50%
 * 3. Development tasks progress: 50% + ((count / total) * 50%)
 * 4. Done tasks: 100%
 * 5. Total: sum of all progresses / total tasks
 */
export function calculateProgress(tasks: Task[]): ProgressMetrics {
  if (tasks.length === 0) {
    return {
      percentage: 0,
      refinementCount: 0,
      developmentCount: 0,
      completedCount: 0,
      totalCount: 0,
    };
  }

  const refinementTasks = tasks.filter(t => getStatusPhase(t.status) === 'refinement');
  const developmentTasks = tasks.filter(t => getStatusPhase(t.status) === 'development');
  const completedTasks = tasks.filter(t => getStatusPhase(t.status) === 'completed');

  const totalCount = tasks.length;

  // Calculate progress contribution from each phase
  const refinementProgress = (refinementTasks.length / totalCount) * 50;
  const developmentProgress = (developmentTasks.length / totalCount) * 50;
  const completedProgress = (completedTasks.length / totalCount) * 100;

  // Total progress
  const totalProgress = refinementProgress + developmentProgress + completedProgress;

  return {
    percentage: Math.round(totalProgress),
    refinementCount: refinementTasks.length,
    developmentCount: developmentTasks.length,
    completedCount: completedTasks.length,
    totalCount,
  };
}

/**
 * Gets a progress color based on percentage (for UI visualization)
 */
export function getProgressColor(percentage: number): string {
  if (percentage < 25) return '#f44336'; // Red
  if (percentage < 50) return '#ff9800'; // Orange
  if (percentage < 75) return '#2196f3'; // Blue
  if (percentage < 100) return '#4caf50'; // Green
  return '#4caf50'; // Green for 100%
}

/**
 * Gets a progress status label based on percentage
 */
export function getProgressLabel(percentage: number): string {
  if (percentage === 0) return 'Not Started';
  if (percentage < 50) return 'In Refinement';
  if (percentage < 100) return 'In Development';
  return 'Completed';
}
