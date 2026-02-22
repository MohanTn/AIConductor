/**
 * WhatNextBanner — "What's next?" action panel shown above the board.
 * Polls the /api/features/:slug/snapshot endpoint and surfaces the top
 * recommendation plus blockage count so the team always knows what to do.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { APIClient } from '../api/client';
import styles from './WhatNextBanner.module.css';

interface Blockage {
  taskId: string;
  status: string;
  reason: string;
  roleLabel?: string;
}

interface SnapshotData {
  feature: { slug: string; name: string; totalTasks: number; progress: string };
  summary: string;
  blockages: Blockage[];
  recommendations: string[];
}

interface WhatNextBannerProps {
  repoName: string;
  featureSlug: string;
}

// Scroll the task card into view and briefly highlight it
function scrollToTask(taskId: string) {
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('taskHighlight');
  setTimeout(() => el.classList.remove('taskHighlight'), 1200);
}

const POLL_INTERVAL_MS = 15_000;

const WhatNextBanner: React.FC<WhatNextBannerProps> = ({ repoName, featureSlug }) => {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!featureSlug || !repoName) return;
    try {
      const data = await APIClient.getFeatureSnapshot(repoName, featureSlug);
      if (data.success) setSnapshot(data as SnapshotData);
    } catch {
      // Silently ignore — banner is informational, not critical
    }
  }, [repoName, featureSlug]);

  useEffect(() => {
    setSnapshot(null);
    fetchSnapshot();
    intervalRef.current = setInterval(fetchSnapshot, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchSnapshot]);

  if (!snapshot) return null;

  const topRec = snapshot.recommendations[0];
  const blockedCount = snapshot.blockages.length;
  const progress = snapshot.feature.progress;

  // No actionable information → hide banner
  if (!topRec && blockedCount === 0) return null;

  return (
    <div
      className={`${styles.banner} ${collapsed ? styles.bannerCollapsed : ''}`}
      role="region"
      aria-label="What's next"
    >
      <button
        className={styles.bannerToggle}
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        type="button"
      >
        <span className={styles.bannerIcon}>◈</span>
        <span className={styles.bannerTitle}>What's Next</span>
        <span className={styles.bannerProgress}>{progress} complete</span>
        {blockedCount > 0 && (
          <span className={styles.bannerBlockedBadge} aria-label={`${blockedCount} blocked`}>
            {blockedCount} blocked
          </span>
        )}
        <span className={`${styles.bannerChevron} ${collapsed ? styles.bannerChevronCollapsed : ''}`}>
          ▾
        </span>
      </button>

      {!collapsed && (
        <div className={styles.bannerBody} aria-live="polite">
          {topRec && (
            <p className={styles.bannerRec}>
              <strong>Suggested action:</strong> {topRec}
            </p>
          )}

          {blockedCount > 0 && (
            <div className={styles.blockageList}>
              {snapshot.blockages.map(b => (
                <button
                  key={b.taskId}
                  className={styles.blockageItem}
                  onClick={() => scrollToTask(b.taskId)}
                  type="button"
                  title={`Scroll to ${b.taskId}`}
                >
                  <span className={styles.blockageId}>{b.taskId}</span>
                  <span className={styles.blockageRole}>{b.roleLabel ?? b.status}</span>
                  <span className={styles.blockageReason}>{b.reason}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WhatNextBanner;
