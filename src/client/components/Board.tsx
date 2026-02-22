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
}

interface SwimlaneConfig {
  id: string;
  label: string;
  statuses: { status: TaskStatus; label: string }[];
}

const SWIMLANE_CONFIG: SwimlaneConfig[] = [
  {
    id: 'refinement',
    label: 'Refinement Phase',
    statuses: [
      { status: 'PendingProductDirector', label: 'Pending Product' },
      { status: 'PendingArchitect', label: 'Pending Arch' },
      { status: 'PendingUiUxExpert', label: 'Pending UX' },
      { status: 'PendingSecurityOfficer', label: 'Pending Security' },
      { status: 'NeedsRefinement', label: 'Needs Refinement' },
    ],
  },
  {
    id: 'development',
    label: 'Development Phase',
    statuses: [
      { status: 'ReadyForDevelopment', label: 'Ready' },
      { status: 'ToDo', label: 'To Do' },
      { status: 'InProgress', label: 'In Progress' },
      { status: 'InReview', label: 'In Review' },
      { status: 'InQA', label: 'In QA' },
      { status: 'NeedsChanges', label: 'Needs Changes' },
    ],
  },
  {
    id: 'completed',
    label: 'Completed',
    statuses: [
      { status: 'Done', label: 'Done' },
    ],
  },
];

const Board: React.FC<BoardProps> = ({ tasks, onTaskTransition }) => {
  const { currentRepo, currentFeatureSlug } = useAppState();
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Group tasks by status once; recompute only when tasks change
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    SWIMLANE_CONFIG.forEach(swimlane =>
      swimlane.statuses.forEach(col => { grouped[col.status] = []; })
    );
    tasks.forEach(task => {
      if (grouped[task.status] !== undefined) {
        grouped[task.status].push(task);
      }
    });
    return grouped;
  }, [tasks]);

  // Total task count per swimlane — drives auto-collapse logic
  const swimlaneCounts = useMemo(() =>
    SWIMLANE_CONFIG.reduce((acc, swimlane) => {
      acc[swimlane.id] = swimlane.statuses.reduce(
        (sum, col) => sum + (tasksByStatus[col.status]?.length ?? 0), 0
      );
      return acc;
    }, {} as Record<string, number>),
  [tasksByStatus]);

  // null = auto; true = forced collapsed; false = forced expanded
  const [manualCollapse, setManualCollapse] = useState<Record<string, boolean | null>>({});

  const isCollapsed = useCallback((id: string) =>
    manualCollapse[id] != null ? manualCollapse[id]! : swimlaneCounts[id] === 0,
  [manualCollapse, swimlaneCounts]);

  const toggleSwimlane = useCallback((id: string) => {
    setManualCollapse(prev => ({ ...prev, [id]: !isCollapsed(id) }));
  }, [isCollapsed]);

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
      <div className={styles.boardContainer} role="region" aria-label="Task board">
        {SWIMLANE_CONFIG.map(swimlane => {
          const count = swimlaneCounts[swimlane.id];
          const collapsed = isCollapsed(swimlane.id);
          const bodyId = `swimlane-body-${swimlane.id}`;

          return (
            <div key={swimlane.id} className={styles.swimlane}>
              <button
                className={styles.swimlaneHeader}
                onClick={() => toggleSwimlane(swimlane.id)}
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                type="button"
              >
                <span className={`${styles.swimlaneChevron} ${collapsed ? styles.swimlaneChevronCollapsed : ''}`}>
                  ▾
                </span>
                <span className={styles.swimlaneLabel}>{swimlane.label}</span>
                <span className={styles.swimlaneCount}>
                  {count} {count === 1 ? 'task' : 'tasks'}
                </span>
              </button>

              <div
                id={bodyId}
                className={`${styles.swimlaneBody} ${collapsed ? styles.swimlaneBodyCollapsed : ''}`}
              >
                <div className={styles.board}>
                  {swimlane.statuses.map(col => {
                    const columnTasks = tasksByStatus[col.status] ?? [];

                    if (columnTasks.length === 0) {
                      return (
                        <div
                          key={col.status}
                          className={styles.columnCollapsed}
                          title={col.label}
                        >
                          <div className={styles.columnCollapsedHeader}>
                            <span className={styles.columnCollapsedCount}>0</span>
                            <span className={styles.columnCollapsedTitle}>{col.label}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={col.status}
                        className={styles.column}
                        role="list"
                        aria-label={col.label}
                      >
                        <div className={styles.columnHeader}>
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
            </div>
          );
        })}
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
