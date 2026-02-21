import React, { useReducer, useRef, useEffect, useCallback } from 'react';
import { Task, TaskStatus } from '../types';
import { formatStatus, getBadgeClass } from '../utils/formatters';
import { APIClient } from '../api/client';
import styles from './TaskCard.module.css';

// ── Transition action descriptor ───────────────────────────────
interface TransitionAction {
  label: string;
  toStatus: TaskStatus;
  actor: 'developer' | 'codeReviewer' | 'qa';
  confirmLabel: string;
}

// ── Component props ────────────────────────────────────────────
interface TaskCardProps {
  task: Task;
  onTaskClick?: (taskId: string) => void;
  onTransition?: (taskId: string, newStatus: TaskStatus) => void;
  featureSlug?: string;
  repoName?: string;
}

// ── Inline-action FSM ─────────────────────────────────────────
type CardPhase = 'idle' | 'confirming' | 'submitting' | 'error';

interface CardState {
  phase: CardPhase;
  pendingAction: TransitionAction | null;
  error: string | null;
}

type CardAction =
  | { type: 'INITIATE'; action: TransitionAction }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' }
  | { type: 'SUCCESS' }
  | { type: 'ERROR'; error: string };

function cardReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'INITIATE':
      return { phase: 'confirming', pendingAction: action.action, error: null };
    case 'CANCEL':
      return { phase: 'idle', pendingAction: null, error: null };
    case 'CONFIRM':
      return { ...state, phase: 'submitting', error: null };
    case 'SUCCESS':
      return { phase: 'idle', pendingAction: null, error: null };
    case 'ERROR':
      return { ...state, phase: 'error', error: action.error };
    default:
      return state;
  }
}

// ── Available transitions per status ──────────────────────────
function getAvailableTransitions(status: TaskStatus): TransitionAction[] {
  switch (status) {
    case 'ReadyForDevelopment':
      return [{ label: 'Pick Up', toStatus: 'ToDo', actor: 'developer', confirmLabel: 'Yes, Pick Up' }];
    case 'ToDo':
      return [{ label: 'Start', toStatus: 'InProgress', actor: 'developer', confirmLabel: 'Yes, Start' }];
    case 'InProgress':
      return [{ label: 'Submit for Review', toStatus: 'InReview', actor: 'developer', confirmLabel: 'Yes, Submit' }];
    case 'InReview':
      return [
        { label: 'Approve', toStatus: 'InQA', actor: 'codeReviewer', confirmLabel: 'Yes, Approve' },
        { label: 'Request Changes', toStatus: 'NeedsChanges', actor: 'codeReviewer', confirmLabel: 'Yes, Reject' },
      ];
    case 'InQA':
      return [
        { label: 'Approve', toStatus: 'Done', actor: 'qa', confirmLabel: 'Yes, Approve' },
        { label: 'Reject', toStatus: 'NeedsChanges', actor: 'qa', confirmLabel: 'Yes, Reject' },
      ];
    case 'NeedsChanges':
      return [{ label: 'Restart', toStatus: 'InProgress', actor: 'developer', confirmLabel: 'Yes, Restart' }];
    default:
      return [];
  }
}

const INITIAL_STATE: CardState = { phase: 'idle', pendingAction: null, error: null };

// ── Component ─────────────────────────────────────────────────
const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onTaskClick,
  onTransition,
  featureSlug,
  repoName,
}) => {
  const [state, dispatch] = useReducer(cardReducer, INITIAL_STATE);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const transitions = getAvailableTransitions(task.status);

  // WCAG 2.4.3 — move focus to confirm button when entering confirming state
  useEffect(() => {
    if (state.phase === 'confirming') {
      confirmRef.current?.focus();
    }
  }, [state.phase]);

  const handleCardClick = useCallback(() => {
    if (state.phase === 'idle') {
      onTaskClick?.(task.taskId);
    }
  }, [state.phase, onTaskClick, task.taskId]);

  const handleCardKeyPress = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && state.phase === 'idle') {
      e.preventDefault();
      onTaskClick?.(task.taskId);
    }
  }, [state.phase, onTaskClick, task.taskId]);

  const handleInitiate = useCallback((t: TransitionAction, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'INITIATE', action: t });
  }, []);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: 'CANCEL' });
  }, []);

  const handleConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!state.pendingAction || !featureSlug || !repoName) return;
    const action = state.pendingAction;
    dispatch({ type: 'CONFIRM' });
    try {
      await APIClient.transitionTask(
        repoName,
        featureSlug,
        task.taskId,
        task.status,
        action.toStatus,
        action.actor,
      );
      dispatch({ type: 'SUCCESS' });
      onTransition?.(task.taskId, action.toStatus);
    } catch (err) {
      dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : 'Transition failed' });
    }
  }, [state.pendingAction, featureSlug, repoName, task.taskId, task.status, onTransition]);

  const actionRowClass = `${styles.actionRow}${state.phase !== 'idle' ? ` ${styles.actionRowActive}` : ''}`;

  return (
    <div
      className={styles.card}
      role="listitem"
      tabIndex={0}
      data-task-id={task.taskId}
      onClick={handleCardClick}
      onKeyPress={handleCardKeyPress}
    >
      <div className={styles.cardHeader}>
        <span className={styles.taskId}>{task.taskId}</span>
        <span className={`${styles.badge} ${styles[getBadgeClass(task.status)]}`}>
          {formatStatus(task.status)}
        </span>
      </div>

      <div className={styles.cardTitle}>{task.title}</div>

      {task.description && (
        <div className={styles.cardDesc}>{task.description}</div>
      )}

      <div className={styles.cardFooter}>
        {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
          <span className={styles.cardMeta}>✓ {task.acceptanceCriteria.length} AC</span>
        )}
        {task.testScenarios && task.testScenarios.length > 0 && (
          <span className={styles.cardMeta}>⚡ {task.testScenarios.length} TS</span>
        )}
        {task.estimatedHours && (
          <span className={styles.cardMeta}>⏱ {task.estimatedHours}h</span>
        )}
      </div>

      {transitions.length > 0 && (
        <div className={actionRowClass} onClick={e => e.stopPropagation()}>
          {state.phase === 'idle' && transitions.map(t => (
            <button
              key={t.toStatus}
              className={styles.actionBtn}
              onClick={e => handleInitiate(t, e)}
              type="button"
            >
              {t.label}
            </button>
          ))}

          {state.phase === 'confirming' && (
            <div className={styles.confirmRow} role="group" aria-label="Confirm action">
              <span className={styles.confirmText}>{state.pendingAction?.label}?</span>
              <button
                ref={confirmRef}
                className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                onClick={handleConfirm}
                type="button"
              >
                {state.pendingAction?.confirmLabel}
              </button>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}

          {state.phase === 'submitting' && (
            <span aria-live="polite" role="status" className={styles.submitStatus}>
              Submitting…
            </span>
          )}

          {state.phase === 'error' && (
            <div role="alert" className={styles.errorRow}>
              <span className={styles.errorText}>{state.error}</span>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                onClick={handleCancel}
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskCard;
