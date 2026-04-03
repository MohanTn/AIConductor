/**
 * Cron Scanner — Periodically scans all repos/features and enqueues
 * feature-level jobs when ALL tasks in a feature have reached
 * ReadyForDevelopment status.
 */
import { AIConductor } from './AIConductor.js';

export class CronScanner {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private manager: AIConductor;

  constructor(manager: AIConductor) {
    this.manager = manager;
  }

  /** Whether the cron loop is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the cron loop. Reads cronIntervalSeconds from settings on each tick
   * so configuration changes take effect without a restart.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
    console.log('[CronScanner] Started');
  }

  /** Stop the cron loop gracefully. */
  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    console.log('[CronScanner] Stopped');
  }

  /**
   * Run a single scan cycle:
   *  1. Check if worker is enabled in settings.
   *  2. List every registered repo.
   *  3. For each repo, list features.
   *  4. For each feature, check if ALL tasks are in ReadyForDevelopment status.
   *  5. If so, enqueue a single feature-level job (not per-task).
   *
   * Returns the number of newly enqueued features.
   */
  async scan(): Promise<number> {
    const settings = this.manager.getQueueSettings();
    if (!settings.workerEnabled) return 0;

    let enqueued = 0;

    try {
      // List all repos
      const reposResult = await this.manager.listRepos();
      const repoObjects: Array<{ repoName: string }> = reposResult.success ? (reposResult as any).repos ?? [] : [];

      for (const repo of repoObjects) {
        const repoName = repo.repoName;
        // List features for this repo
        const featuresResult = await this.manager.listFeatures(repoName);
        const features: Array<{ featureSlug: string }> = (featuresResult as any).features ?? [];

        for (const feat of features) {
          // Load all tasks for this feature
          const allTasksResult = await this.manager.getTasksByStatus({
            repoName,
            featureSlug: feat.featureSlug,
            status: 'ReadyForDevelopment',
          });
          const readyTasks: Array<{ taskId: string }> = (allTasksResult as any).tasks ?? [];

          // Skip features with zero ready tasks
          if (readyTasks.length === 0) continue;

          // Check total task count — ALL must be ReadyForDevelopment
          const featureData = await this.manager.verifyAllTasksComplete({
            repoName,
            featureSlug: feat.featureSlug,
          });
          const totalTasks = (featureData as any).totalTasks ?? 0;

          if (totalTasks > 0 && readyTasks.length === totalTasks) {
            // All tasks are ReadyForDevelopment — enqueue a feature-level job
            const { alreadyQueued } = this.manager.enqueueFeature(
              repoName,
              feat.featureSlug,
              settings.cliTool,
            );
            if (!alreadyQueued) enqueued++;
          }
        }
      }

      if (enqueued > 0) {
        console.log(`[CronScanner] Enqueued ${enqueued} feature(s)`);
      }
    } catch (err) {
      console.error('[CronScanner] Error during scan:', err);
    }

    return enqueued;
  }

  // ────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────

  private scheduleNext(): void {
    if (!this.running) return;

    // Re-read interval from settings on every tick so runtime changes are honoured
    const settings = this.manager.getQueueSettings();
    const ms = Math.max(settings.cronIntervalSeconds * 1000, 10_000);

    this.intervalId = setTimeout(async () => {
      try {
        await this.scan();
      } finally {
        this.scheduleNext();
      }
    }, ms);

    // Prevent the timer from keeping the process alive during shutdown
    if (this.intervalId && typeof this.intervalId === 'object' && 'unref' in this.intervalId) {
      this.intervalId.unref();
    }
  }
}
