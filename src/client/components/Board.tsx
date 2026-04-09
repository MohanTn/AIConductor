import React, { useState, useCallback, useMemo } from 'react';
import { Task, TaskStatus } from '../types';
import { useAppState } from '../state/AppState';
import { APIClient } from '../api/client';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import styles from './Board.module.css';

interface BoardProps {
  tasks: Task[];
  onTaskTransition?: (taskId: string, newStatus: TaskStatus) => void;
  featureName?: string;
  progressPercentage?: number;
}

interface ColumnConfig {
  status: TaskStatus;
  label: string;
  isException?: boolean; // true for NeedsRefinement and NeedsChanges
}

// Flat kanban columns in exact workflow order
const COLUMN_CONFIG: ColumnConfig[] = [
  { status: 'InRefinement', label: 'In Refinement' },
  // Legacy support for deprecated statuses (map to InRefinement visually)
  { status: 'PendingProductDirector', label: 'In Refinement' },
  { status: 'PendingArchitect', label: 'In Refinement' },
  { status: 'PendingUiUxExpert', label: 'In Refinement' },
  { status: 'PendingSecurityOfficer', label: 'In Refinement' },
  { status: 'NeedsRefinement', label: 'Needs Refinement', isException: true },
  { status: 'ReadyForDevelopment', label: 'Ready for Dev' },
  { status: 'ToDo', label: 'To Do' },
  { status: 'InProgress', label: 'In Progress' },
  { status: 'InReview', label: 'In Review' },
  { status: 'InQA', label: 'In QA' },
  { status: 'NeedsChanges', label: 'Needs Changes', isException: true },
  { status: 'Done', label: 'Done' },
];

const Board: React.FC<BoardProps> = ({ tasks, onTaskTransition, featureName, progressPercentage }) => {
  const { currentRepo, currentFeatureSlug } = useAppState();
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Group tasks by status once; recompute only when tasks change
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    COLUMN_CONFIG.forEach(col => { grouped[col.status] = []; });

    tasks.forEach(task => {
      // Map deprecated statuses to InRefinement for grouping
      const displayStatus = ['PendingProductDirector', 'PendingArchitect', 'PendingUiUxExpert', 'PendingSecurityOfficer'].includes(task.status)
        ? 'InRefinement'
        : task.status;

      if (grouped[task.status] !== undefined) {
        grouped[task.status].push(task);
      }
    });
    return grouped;
  }, [tasks]);

  // Get unique active columns (columns with tasks or exception columns)
  const activeColumns = useMemo(() => {
    const uniqueStatuses = new Set<TaskStatus>();
    tasks.forEach(task => uniqueStatuses.add(task.status));

    return COLUMN_CONFIG.filter(col =>
      uniqueStatuses.has(col.status) || col.isException
    );
  }, [tasks]);

  // Total task count
  const totalTasks = useMemo(() => tasks.length, [tasks]);

  const handleTaskClick = useCallback(async (taskId: string) => {
    setModalOpen(true);
    setModalLoading(true);
    setModalError(null);
    setModalTask(null);
    try {
      const fullTask = await APIClient.getFullTask(currentRepo, currentFeatureSlug, taskId);
      setModalTask(fullTask);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err));
    } finally {
      setModalLoading(false);
    }
  }, [currentRepo, currentFeatureSlug]);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setModalTask(null);
    setModalError(null);
  }, []);

  return (
    <>
      <div className={styles.boardHeader}>
        <div className={styles.boardTitle}>
          {featureName && <h2>{featureName}</h2>}
          <span className={styles.boardStats}>
            {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'}
            {progressPercentage !== undefined && (
              <span className={styles.progressInfo}>
                {' • '}Progress: {progressPercentage}%
              </span>
            )}
          </span>
        </div>
      </div>

      <div className={styles.boardContainer} role="region" aria-label="Task kanban board">
        <div className={styles.board}>
          {activeColumns.map(col => {
            const columnTasks = tasksByStatus[col.status] ?? [];
            const isException = col.isException ?? false;

            return (
              <div
                key={col.status}
                className={`${styles.column} ${isException ? styles.columnException : ''}`}
                role="list"
                aria-label={col.label}
              >
                <div className={styles.columnHeader}>
                  {isException && <span className={styles.exceptionIcon}>⚠️</span>}
                  <span className={styles.columnTitle}>{col.label}</span>
                  <span className={styles.columnCount}>{columnTasks.length}</span>
                </div>
                <div className={styles.columnBody}>
                  {columnTasks.map(task => (
                    <TaskCard
                      key={task.taskId}
                      task={task}
                      onTaskClick={handleTaskClick}
                      onTransition={onTaskTransition}
                      featureSlug={currentFeatureSlug}
                      repoName={currentRepo}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modalOpen && (
        <TaskDetailModal
          task={modalTask}
          loading={modalLoading}
          error={modalError}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
};

export default Board;
