import React, { useState, useEffect, useCallback } from 'react';
import { QueueAPI, QueueItem } from '../api/queue.api.js';
import { useAppState } from '../state/AppState.js';
import { useWebSocket } from '../hooks/useWebSocket';
import styles from './QueueAuditPanel.module.css';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  running: '▶',
  completed: '✓',
  failed: '✗',
};

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.max(0, e - s);
  if (diff < 1000) return '<1s';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ${Math.round((diff % 60_000) / 1000)}s`;
  return `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`;
}

const QueueAuditPanel: React.FC = () => {
  const { currentRepo, currentFeatureSlug } = useAppState();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const loadItems = useCallback(async () => {
    if (!currentFeatureSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await QueueAPI.getQueueItems(
        currentRepo || undefined,
        currentFeatureSlug,
      );
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentRepo, currentFeatureSlug]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useWebSocket({
    onMessage: useCallback((message: any) => {
      if (message.type === 'task-status-changed') {
        loadItems();
      }
    }, [loadItems]),
    onConnect: loadItems,
  });

  if (!currentFeatureSlug) return null;

  return (
    <div className={styles.panel} role="region" aria-label="Queue Audit Trail">
      <button
        className={styles.panelHeader}
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-controls="queue-audit-content"
      >
        <span className={styles.panelTitle}>
          Queue Audit Trail
          {items.length > 0 && (
            <span className={styles.badge}>{items.length}</span>
          )}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          {collapsed ? '▼' : '▲'}
        </span>
      </button>

      {!collapsed && (
        <div id="queue-audit-content" className={styles.panelBody}>
          {loading && items.length === 0 && (
            <div className={styles.loadingText}>Loading queue items…</div>
          )}

          {error && (
            <div className={styles.errorText} role="alert">
              {error}
              <button className={styles.retryBtn} onClick={loadItems}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className={styles.emptyText}>
              No queue items for this feature.
            </div>
          )}

          {items.length > 0 && (
            <div className={styles.timeline}>
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`${styles.timelineItem} ${styles[`status_${item.status}`] || ''}`}
                  >
                    <div className={styles.timelineDot} aria-hidden="true" />
                    <button
                      className={styles.timelineHeader}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : item.id)
                      }
                      aria-expanded={isExpanded}
                    >
                      <span className={styles.timelineIcon}>
                        {STATUS_ICONS[item.status] || '?'}
                      </span>
                      <span className={styles.timelineTask}>
                        Dev Workflow
                      </span>
                      <span
                        className={`${styles.statusBadge} ${styles[`statusBadge_${item.status}`] || ''}`}
                      >
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                      <span className={styles.timelineTime}>
                        {formatTimestamp(item.created_at)}
                      </span>
                      <span className={styles.expandIcon} aria-hidden="true">
                        {isExpanded ? '−' : '+'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className={styles.timelineDetails}>
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>CLI Tool:</span>
                          <span className={styles.detailValue}>
                            {item.cli_tool}
                          </span>
                        </div>
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>Created:</span>
                          <span className={styles.detailValue}>
                            {formatTimestamp(item.created_at)}
                          </span>
                        </div>
                        {item.started_at && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>Started:</span>
                            <span className={styles.detailValue}>
                              {formatTimestamp(item.started_at)}
                            </span>
                          </div>
                        )}
                        {item.completed_at && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              Completed:
                            </span>
                            <span className={styles.detailValue}>
                              {formatTimestamp(item.completed_at)}
                            </span>
                          </div>
                        )}
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>Duration:</span>
                          <span className={styles.detailValue}>
                            {formatDuration(item.started_at, item.completed_at)}
                          </span>
                        </div>
                        {item.retry_count > 0 && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>Retries:</span>
                            <span className={styles.detailValue}>
                              {item.retry_count}
                            </span>
                          </div>
                        )}
                        {item.worker_pid && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              Worker PID:
                            </span>
                            <span className={styles.detailValue}>
                              {item.worker_pid}
                            </span>
                          </div>
                        )}
                        {item.error_message && (
                          <div className={styles.errorBlock}>
                            <span className={styles.detailLabel}>Error:</span>
                            <pre className={styles.errorPre}>
                              {item.error_message}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QueueAuditPanel;
