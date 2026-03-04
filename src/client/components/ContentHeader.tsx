import React, { useState } from 'react';
import { useAppState } from '../state/AppState';
import { Task, TaskStatus } from '../types';
import ResetDevModal from './ResetDevModal';
import styles from './ContentHeader.module.css';

/** Statuses that indicate a task has entered the dev pipeline */
const POST_DEV_STATUSES: TaskStatus[] = [
  'ToDo',
  'InProgress',
  'InReview',
  'InQA',
  'Done',
  'NeedsChanges',
];

interface ContentHeaderProps {
  featureTitle: string;
  tasks: Task[];
  onResetComplete?: () => void;
}

const ContentHeader: React.FC<ContentHeaderProps> = ({ featureTitle, tasks, onResetComplete }) => {
  const { searchQuery, setSearchQuery, currentRepo, currentFeatureSlug } = useAppState();
  const [copied, setCopied] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  const hasPostDevTasks = tasks.some(t => POST_DEV_STATUSES.includes(t.status));

  const stats = React.useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'Done').length;
    const inFlight = tasks.filter(t =>
      ['InProgress', 'InReview', 'InQA'].includes(t.status)
    ).length;
    const blocked = tasks.filter(t =>
      ['NeedsChanges', 'NeedsRefinement'].includes(t.status)
    ).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, inFlight, blocked, percent };
  }, [tasks]);

  const handleCopy = async () => {
    const text = `repoName: ${currentRepo}, featureName: ${currentFeatureSlug}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={styles.contentHeader}>
      <div className={styles.contentHeaderLeft}>
        <div className={styles.featureTitleRow}>
          <div className={styles.featureHeadline}>{featureTitle}</div>
          <button
            className={styles.copyBtn}
            onClick={handleCopy}
            title="Copy repo & feature name"
            aria-label="Copy repo and feature name"
          >
            {copied ? '✓' : '⎘'}
          </button>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Total</span>
            <span className={styles.statValue}>{stats.total}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Done</span>
            <span className={`${styles.statValue} ${styles.highlight}`}>{stats.done}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>In Flight</span>
            <span className={styles.statValue}>{stats.inFlight}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Blocked</span>
            <span className={styles.statValue}>{stats.blocked}</span>
          </div>
          <div className={styles.statItem}>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={stats.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={styles.progressFill} style={{ width: `${stats.percent}%` }}></div>
            </div>
            <span className={styles.statValue} style={{ fontSize: '13px', marginLeft: '6px' }}>
              {stats.percent}%
            </span>
          </div>
        </div>
      </div>

      <div className={styles.contentHeaderRight}>
        {hasPostDevTasks && (
          <button
            className={styles.resetDevBtn}
            onClick={() => setShowResetModal(true)}
            aria-label="Reset development workflow for this feature"
            title="Reset all tasks to ReadyForDevelopment"
          >
            ↺ Reset Dev
          </button>
        )}
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </div>

      {showResetModal && (
        <ResetDevModal
          repoName={currentRepo}
          featureSlug={currentFeatureSlug}
          taskCount={tasks.length}
          onClose={() => setShowResetModal(false)}
          onSuccess={() => {
            setShowResetModal(false);
            onResetComplete?.();
          }}
        />
      )}
    </div>
  );
};

export default ContentHeader;
