import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Task, Transition, AcceptanceCriterion, TestScenario } from '../types';
import { formatStatus, getBadgeClass } from '../utils/badge-utils';
import { getFilesChanged, formatFileChange, calculateChangesSummary } from '../utils/transition-utils';
import styles from './TaskDetailModal.module.css';

interface TaskDetailModalProps {
  task: Task | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function formatTimestamp(ts: string): { relative: string; absolute: string } {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  let relative: string;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffHr < 24) relative = `${diffHr}h ago`;
  else if (diffDay < 30) relative = `${diffDay}d ago`;
  else relative = date.toLocaleDateString();

  const absolute = date.toLocaleString();
  return { relative, absolute };
}

function formatActor(actor: string | null | undefined, approver: string | null | undefined): string {
  const name = actor || approver || 'system';
  return name.replace(/([A-Z])/g, ' $1').trim();
}

function getPriorityClass(priority: string): string {
  if (priority === 'Must Have') return styles.priorityMust;
  if (priority === 'Should Have') return styles.priorityShould;
  return styles.priorityCould;
}

function getTsPriorityClass(priority: string): string {
  if (priority === 'P0') return styles.p0;
  if (priority === 'P1') return styles.p1;
  if (priority === 'P2') return styles.p2;
  return styles.p3;
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ task, loading, error, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // T03: track which timeline entries have their files list expanded
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());

  const toggleFiles = (idx: number) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  // Focus close button on open
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const content = (
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-task-title"
        ref={modalRef}
      >
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderInfo}>
            {task && (
              <>
                <div className={styles.modalTaskId}>{task.taskId}</div>
                <div id="modal-task-title" className={styles.modalTitle}>{task.title}</div>
                <div style={{ marginTop: 6 }}>
                  <span className={`${styles.badge} badge ${getBadgeClass(task.status)}`}>
                    {formatStatus(task.status)}
                  </span>
                </div>
              </>
            )}
            {loading && <div className={styles.modalTaskId}>Loading...</div>}
            {error && <div className={styles.modalTaskId}>Error</div>}
          </div>
          <button
            ref={closeButtonRef}
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close task detail modal"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {loading && (
            <div className={styles.loadingState}>Loading task details…</div>
          )}

          {error && !loading && (
            <div className={styles.errorState}>Failed to load task: {error}</div>
          )}

          {task && !loading && (
            <>
              {/* Description */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Description</div>
                {task.description ? (
                  <div className={styles.descriptionText}>{task.description}</div>
                ) : (
                  <div className={styles.emptyState}>No description provided.</div>
                )}
              </div>

              {/* Acceptance Criteria */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Acceptance Criteria ({task.acceptanceCriteria?.length ?? 0})
                </div>
                {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 ? (
                  <div className={styles.acList}>
                    {task.acceptanceCriteria.map((ac: AcceptanceCriterion) => (
                      <div key={ac.id} className={styles.acItem}>
                        <span
                          className={`${styles.acCheck} ${ac.verified ? styles.verified : styles.unverified}`}
                          title={ac.verified ? 'Verified' : 'Not verified'}
                        >
                          {ac.verified ? '✓' : '○'}
                        </span>
                        <span className={`${styles.acPriority} ${getPriorityClass(ac.priority)}`}>
                          {ac.priority === 'Must Have' ? 'Must' : ac.priority === 'Should Have' ? 'Should' : 'Could'}
                        </span>
                        <span>{ac.criterion}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>No acceptance criteria defined.</div>
                )}
              </div>

              {/* Test Scenarios */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Test Scenarios ({task.testScenarios?.length ?? 0})
                </div>
                {task.testScenarios && task.testScenarios.length > 0 ? (
                  <div className={styles.tsList}>
                    {task.testScenarios.map((ts: TestScenario) => (
                      <div key={ts.id} className={styles.tsItem}>
                        <div className={styles.tsHeader}>
                          <span className={styles.tsId}>{ts.id}</span>
                          <span className={`${styles.tsPriority} ${getTsPriorityClass(ts.priority)}`}>
                            {ts.priority}
                          </span>
                          <span className={styles.tsTitle}>{ts.title}</span>
                        </div>
                        {ts.description && (
                          <div className={styles.tsDesc}>{ts.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>No test scenarios defined.</div>
                )}
              </div>

              {/* Audit Trail */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Audit Trail ({task.transitions?.length ?? 0} transitions)
                </div>
                {task.transitions && task.transitions.length > 0 ? (
                  <div className={styles.timeline}>
                    {task.transitions.map((t: Transition, idx: number) => {
                      const { relative, absolute } = formatTimestamp(t.timestamp);
                      return (
                        <div key={idx} className={styles.timelineEntry}>
                          <div className={styles.timelineLeft}>
                            <div className={styles.timelineDot} />
                          </div>
                          <div className={styles.timelineContent}>
                            <div className={styles.timelineTransition}>
                              <span className={styles.timelineActor}>
                                {formatActor(t.actor, t.approver)}
                              </span>
                              <span className={styles.timelineArrow}>moved</span>
                              <span className={`${styles.badge} badge ${getBadgeClass(t.from)}`}>
                                {formatStatus(t.from)}
                              </span>
                              <span className={styles.timelineArrow}>→</span>
                              <span className={`${styles.badge} badge ${getBadgeClass(t.to)}`}>
                                {formatStatus(t.to)}
                              </span>
                            </div>
                            <div className={styles.timelineTimestamp} title={absolute}>
                              {relative} · {absolute}
                            </div>
                            {t.notes && (
                              <div className={styles.timelineNotes}>{t.notes}</div>
                            )}
                            {/* Code Changes Section - collapsible with summary */}
                            {(() => {
                              const files = getFilesChanged(t.additionalData);
                              if (files.length === 0) return null;
                              const isOpen = expandedFiles.has(idx);
                              const summary = calculateChangesSummary(files);
                              return (
                                <div className={styles.filesChanged}>
                                  <button
                                    className={styles.filesToggle}
                                    onClick={() => toggleFiles(idx)}
                                    aria-expanded={isOpen}
                                    aria-controls={`files-${idx}`}
                                  >
                                    <span className={styles.filesToggleIcon}>
                                      {isOpen ? '▾' : '▸'}
                                    </span>
                                    {summary.totalFiles} file{summary.totalFiles !== 1 ? 's' : ''} changed, <span className={styles.additions}>+{summary.totalAdditions}</span> <span className={styles.deletions}>-{summary.totalDeletions}</span>
                                  </button>
                                  {isOpen && (
                                    <ul
                                      id={`files-${idx}`}
                                      className={styles.filesList}
                                      aria-label="Files changed"
                                    >
                                      {files.map((file, fi) => (
                                        <li key={fi} className={styles.fileItem}>
                                          {formatFileChange(file)}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyState}>No transitions recorded yet.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default TaskDetailModal;
