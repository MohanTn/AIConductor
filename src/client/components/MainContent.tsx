import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from '../state/AppState';
import { APIClient } from '../api/client';
import { Feature } from '../types';
import ContentHeader from './ContentHeader';
import Board from './Board';
import WhatNextBanner from './WhatNextBanner';
import DetailPanel from './DetailPanel';
import SettingsPage from './SettingsPage';
import QueueAuditPanel from './QueueAuditPanel';
import { useWebSocket } from '../hooks/useWebSocket';
import styles from './MainContent.module.css';

const DEFAULT_DETAIL_PERCENT = 40;
const MIN_DETAIL_PERCENT = 15;
const MAX_DETAIL_PERCENT = 70;

const MainContent: React.FC = () => {
  const {
    currentRepo,
    currentFeatureSlug,
    currentTasks,
    setCurrentTasks,
    currentView,
    setLoading,
  } = useAppState();

  // Split panel state
  const [detailPercent, setDetailPercent] = useState(DEFAULT_DETAIL_PERCENT);
  const isDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const prevDetailPercent = useRef(DEFAULT_DETAIL_PERCENT);

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      const offsetFromRight = rect.right - moveEvent.clientX;
      const newDetailPercent = Math.round((offsetFromRight / totalWidth) * 100);
      const clamped = Math.min(MAX_DETAIL_PERCENT, Math.max(MIN_DETAIL_PERCENT, newDetailPercent));
      setDetailPercent(clamped);
      prevDetailPercent.current = clamped;
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);


  const [featureTitle, setFeatureTitle] = useState('');
  const [currentFeature, setCurrentFeature] = useState<Feature | null>(null);
  const [showEmpty, setShowEmpty] = useState(true);

  const loadFeatureTasks = useCallback(async () => {
    if (!currentFeatureSlug) return;

    setLoading(true);
    try {
      const [summary, feature, details] = await Promise.all([
        APIClient.getTasks(currentRepo, currentFeatureSlug),
        APIClient.getFeature(currentRepo, currentFeatureSlug),
        APIClient.getFeatureDetails(currentRepo, currentFeatureSlug).catch(() => null)
      ]);

      setFeatureTitle(summary.featureTitle || currentFeatureSlug);
      setCurrentTasks(summary.tasks || []);

      // Merge feature with details (AC, test scenarios, clarifications, steps, attachments)
      const featureWithDetails = {
        ...feature,
        acceptanceCriteria: details?.acceptanceCriteria || [],
        testScenarios: details?.testScenarios || [],
        description: details?.feature?.description || feature.description || '',
        clarifications: details?.clarifications || [],
        refinementSteps: details?.refinementSteps || [],
        attachments: details?.attachments || [],
      };
      setCurrentFeature(featureWithDetails);
      setShowEmpty(false);
    } catch (error) {
      console.error('Failed to load tasks:', error);
      setShowEmpty(true);
    } finally {
      setLoading(false);
    }
  }, [currentFeatureSlug, currentRepo]);

  // Called by TaskCard after a successful inline transition — refresh the board
  const handleTaskTransition = useCallback(() => {
    loadFeatureTasks();
  }, [loadFeatureTasks]);

  useEffect(() => {
    if (currentFeatureSlug) {
      loadFeatureTasks();
    } else {
      setShowEmpty(true);
    }
  }, [currentFeatureSlug, currentRepo, loadFeatureTasks]);

  // Refresh tasks on WebSocket task/feature change events
  useWebSocket({
    onMessage: useCallback((message: any) => {
      if (!currentFeatureSlug) return;
      if (
        message.type === 'task-status-changed' ||
        message.type === 'feature-changed'
      ) {
        loadFeatureTasks();
      }
    }, [currentFeatureSlug, loadFeatureTasks]),
  });

  if (showEmpty || !currentFeatureSlug) {
    // Still allow settings view even with no feature selected
    if (currentView === 'settings') {
      return <SettingsPage />;
    }
    return (
      <main className={styles.mainContent} id="main-content" role="main">
        <div className={styles.emptyBoard}>
          <div className={styles.emptyBoardInner}>
            <div className={styles.emptyBoardIcon}>&#9688;</div>
            <p className={styles.emptyBoardText}>Select a feature to view tasks</p>
            <p className={styles.emptyBoardHint}>
              Choose from the sidebar or create a new feature
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (currentView === 'settings') {
    return <SettingsPage />;
  }

  return (
    <main className={styles.mainContent} id="main-content" role="main">
      <ContentHeader
        featureTitle={featureTitle}
        tasks={currentTasks}
        onResetComplete={loadFeatureTasks}
      />

      <div className={styles.splitContainer} ref={splitContainerRef}>
        {/* Board panel — takes remaining space */}
        <div className={styles.boardPanel}>
          <WhatNextBanner repoName={currentRepo} featureSlug={currentFeatureSlug} />
          <Board tasks={currentTasks} onTaskTransition={handleTaskTransition} />
        </div>

        {/* Resizer handle */}
        <div
          className={styles.resizer}
          onMouseDown={handleResizerMouseDown}
          role="separator"
          aria-label="Resize panels"
          aria-orientation="vertical"
        />

        {/* Detail panel */}
        <div
          className={styles.detailPanel}
          style={{ width: `${detailPercent}%` }}
        >
          <DetailPanel tasks={currentTasks} feature={currentFeature} />
          <QueueAuditPanel />
        </div>
      </div>
    </main>
  );
};

export default MainContent;
