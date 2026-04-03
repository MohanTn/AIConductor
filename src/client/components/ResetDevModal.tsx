import React, { useEffect, useRef, useState } from 'react';
import { FeatureAPI } from '../api/features.api';
import styles from './ResetDevModal.module.css';

interface ResetDevModalProps {
  repoName: string;
  featureSlug: string;
  taskCount: number;
  onClose: () => void;
  onSuccess: () => void;
}

const ResetDevModal: React.FC<ResetDevModalProps> = ({
  repoName,
  featureSlug,
  taskCount,
  onClose,
  onSuccess,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel on open (safer default for destructive action)
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, onClose]);

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await FeatureAPI.resetDevWorkflow(repoName, featureSlug);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dev-modal-title"
        className={styles.modal}
      >
        <h2 id="reset-dev-modal-title" className={styles.title}>
          Reset Dev Workflow?
        </h2>

        <p className={styles.body}>
          This will reset all <strong>{taskCount}</strong> task{taskCount !== 1 ? 's' : ''} to{' '}
          <strong>ReadyForDevelopment</strong>.{' '}
          <span className={styles.warning}>This action cannot be undone.</span>
        </p>

        {error && (
          <p className={styles.errorMsg} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={isLoading}
            aria-label={`Confirm reset of ${taskCount} task${taskCount !== 1 ? 's' : ''} to ReadyForDevelopment`}
          >
            {isLoading ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetDevModal;
