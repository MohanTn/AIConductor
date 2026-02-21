/**
 * DatabaseHandler - SQLite database operations for task management
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';
import { TaskFile, Task, Transition, AcceptanceCriterion, TestScenario, StakeholderReview } from './types.js';
import { ROLE_SYSTEM_PROMPTS, RolePromptConfig } from './rolePrompts.js';
import { PipelineRole } from './types.js';

/** Row interface for the dev_queue table (feature-level, not task-level). */
export interface DevQueueRow {
  id: number;
  repo_name: string;
  feature_slug: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  cli_tool: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  worker_pid: number | null;
}
export class DatabaseHandler {
  private db: Database.Database;
  private workspaceRoot: string;

  constructor(workspaceRoot?: string, dbPath?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    
    // Priority: 1) explicit dbPath, 2) DATABASE_PATH env var, 3) tasks.db in workspace root
    const defaultDbPath = path.join(this.workspaceRoot, 'tasks.db');
    const finalDbPath = dbPath || process.env.DATABASE_PATH || defaultDbPath;
    
    // Ensure directory exists before opening database
    const dbDir = path.dirname(finalDbPath);
    fs.ensureDirSync(dbDir);
    
    this.db = new Database(finalDbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrency

    this.initializeTables();
    this.runMigrations();
    this.migrateOldRoles();
    this.seedRolePrompts();
    this.seedDefaultSettings();
  }

  /**
   * Initialize database tables
   */
  private initializeTables(): void {
    this.db.exec(`
      -- Features table
      CREATE TABLE IF NOT EXISTS features (
        feature_slug TEXT PRIMARY KEY,
        feature_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_modified TEXT NOT NULL
      );

      -- Tasks table
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_slug TEXT NOT NULL,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_to TEXT,
        estimated_hours REAL,
        order_of_execution INTEGER NOT NULL DEFAULT 0,
        tags TEXT, -- JSON array
        dependencies TEXT, -- JSON array
        out_of_scope TEXT, -- JSON array
        UNIQUE(feature_slug, task_id),
        FOREIGN KEY(feature_slug) REFERENCES features(feature_slug) ON DELETE CASCADE
      );

      -- Transitions table
      CREATE TABLE IF NOT EXISTS transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_slug TEXT NOT NULL,
        task_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        approver TEXT,
        actor TEXT,
        timestamp TEXT NOT NULL,
        notes TEXT,
        additional_data TEXT, -- JSON for all additional fields
        FOREIGN KEY(feature_slug, task_id) REFERENCES tasks(feature_slug, task_id) ON DELETE CASCADE
      );

      -- Acceptance Criteria table
      CREATE TABLE IF NOT EXISTS acceptance_criteria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_slug TEXT NOT NULL,
        task_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        criterion TEXT NOT NULL,
        priority TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        UNIQUE(feature_slug, task_id, criterion_id),
        FOREIGN KEY(feature_slug, task_id) REFERENCES tasks(feature_slug, task_id) ON DELETE CASCADE
      );

      -- Test Scenarios table
      CREATE TABLE IF NOT EXISTS test_scenarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_slug TEXT NOT NULL,
        task_id TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        manual_only INTEGER NOT NULL DEFAULT 0,
        priority TEXT NOT NULL,
        UNIQUE(feature_slug, task_id, scenario_id),
        FOREIGN KEY(feature_slug, task_id) REFERENCES tasks(feature_slug, task_id) ON DELETE CASCADE
      );

      -- Stakeholder Reviews table
      CREATE TABLE IF NOT EXISTS stakeholder_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_slug TEXT NOT NULL,
        task_id TEXT NOT NULL,
        stakeholder TEXT NOT NULL,
        approved INTEGER NOT NULL,
        notes TEXT NOT NULL,
        additional_data TEXT, -- JSON for role-specific fields
        UNIQUE(feature_slug, task_id, stakeholder),
        FOREIGN KEY(feature_slug, task_id) REFERENCES tasks(feature_slug, task_id) ON DELETE CASCADE
      );

      -- Workflow Checkpoints table (Recommendation 3)
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        description TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        FOREIGN KEY(feature_slug) REFERENCES features(feature_slug) ON DELETE CASCADE
      );

      -- Feature Refinement Steps table
      CREATE TABLE IF NOT EXISTS feature_refinement_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        step_name TEXT NOT NULL,
        completed BOOLEAN DEFAULT 0,
        completed_at TEXT,
        summary TEXT,
        data TEXT,
        UNIQUE(repo_name, feature_slug, step_number),
        FOREIGN KEY(feature_slug) REFERENCES features(feature_slug) ON DELETE CASCADE
      );

      -- Feature Attachments table
      CREATE TABLE IF NOT EXISTS feature_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        attachment_name TEXT NOT NULL,
        attachment_type TEXT NOT NULL,
        file_path TEXT,
        file_url TEXT,
        analysis_summary TEXT,
        extracted_data TEXT,
        FOREIGN KEY(feature_slug) REFERENCES features(feature_slug) ON DELETE CASCADE
      );

      -- Feature Clarifications table
      CREATE TABLE IF NOT EXISTS feature_clarifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT,
        asked_by TEXT DEFAULT 'llm',
        created_at TEXT NOT NULL,
        FOREIGN KEY(feature_slug) REFERENCES features(feature_slug) ON DELETE CASCADE
      );

      -- Reviewer Presence table (T03: Presence Tracking)
      CREATE TABLE IF NOT EXISTS reviewer_presence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reviewer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'online',
        current_feature TEXT,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(reviewer_id)
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_tasks_feature ON tasks(feature_slug);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_transitions_task ON transitions(feature_slug, task_id);
      CREATE INDEX IF NOT EXISTS idx_acceptance_criteria_task ON acceptance_criteria(feature_slug, task_id);
      CREATE INDEX IF NOT EXISTS idx_test_scenarios_task ON test_scenarios(feature_slug, task_id);
      CREATE INDEX IF NOT EXISTS idx_stakeholder_reviews_task ON stakeholder_reviews(feature_slug, task_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_feature ON workflow_checkpoints(repo_name, feature_slug);
      CREATE INDEX IF NOT EXISTS idx_presence_reviewer ON reviewer_presence(reviewer_id);
      CREATE INDEX IF NOT EXISTS idx_presence_expiry ON reviewer_presence(expires_at);
      CREATE INDEX IF NOT EXISTS idx_presence_status ON reviewer_presence(status);

      -- Dev Queue table (feature-level: one entry per feature, not per task)
      CREATE TABLE IF NOT EXISTS dev_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_name TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        cli_tool TEXT NOT NULL DEFAULT 'claude',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        worker_pid INTEGER,
        UNIQUE(repo_name, feature_slug, status)
      );

      CREATE INDEX IF NOT EXISTS idx_dev_queue_status ON dev_queue(status);
      CREATE INDEX IF NOT EXISTS idx_dev_queue_repo_feature ON dev_queue(repo_name, feature_slug);
      CREATE INDEX IF NOT EXISTS idx_dev_queue_composite ON dev_queue(repo_name, feature_slug, status);

      -- Application Settings table (key-value store)
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Role Prompts table
      CREATE TABLE IF NOT EXISTS role_prompts (
        role_id TEXT PRIMARY KEY,
        system_prompt TEXT NOT NULL,
        focus_areas TEXT NOT NULL DEFAULT '[]',
        research_instructions TEXT NOT NULL DEFAULT '',
        required_output_fields TEXT NOT NULL DEFAULT '[]',
        phase TEXT NOT NULL DEFAULT 'review',
        is_custom INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Seed default application settings.
   * Idempotent — uses INSERT OR IGNORE to skip existing keys.
   */
  private seedDefaultSettings(): void {
    const defaults: Record<string, string> = {
      cronIntervalSeconds: '60',
      baseReposFolder: '',
      cliTool: 'claude',
      workerEnabled: 'false',
    };
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`
    );
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(defaults)) {
      insert.run(key, value, now);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Application Settings CRUD
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Get a single setting value by key. Returns undefined if not found.
   */
  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Set a single setting value (upsert).
   */
  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  /**
   * Get all settings as a key-value map.
   */
  getAllSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Get the default dev workflow script template.
   */
  private getDefaultDevWorkflowScript(): string {
    return `#!/bin/bash
# Dev Workflow Script Template
# This script is executed when a feature is queued for development

cd "{repoPath}"

# Copy prompts based on CLI tool
if [ "{cliTool}" = "claude" ]; then
  echo "Copying Claude prompts..."
  mkdir -p ~/.claude/commands
  cp -r ./.claude/commands/* ~/.claude/commands/ 2>/dev/null || true
else
  echo "Copying GitHub Copilot prompts..."
  mkdir -p ~/.copilot/prompts
  cp -r ./.github/prompts/* ~/.copilot/prompts/ 2>/dev/null || true
fi

# Run the dev-workflow command
echo "Starting dev workflow for {featureName}..."
{cliTool} -p "/dev-workflow repoName: {repoName}, featureName: {featureName}" --allow-all-tool`;
  }

  /**
   * Get queue-specific settings as a typed object.
   */
  getQueueSettings(): { cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript?: string } {
    const all = this.getAllSettings();
    return {
      cronIntervalSeconds: parseInt(all['cronIntervalSeconds'] ?? '60', 10),
      baseReposFolder: all['baseReposFolder'] ?? '',
      cliTool: all['cliTool'] ?? 'claude',
      workerEnabled: all['workerEnabled'] === 'true',
      devWorkflowScript: all['devWorkflowScript'] ?? this.getDefaultDevWorkflowScript(),
    };
  }

  /**
   * Update multiple queue settings at once.
   */
  updateQueueSettings(updates: Partial<{ cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript: string }>): void {
    if (updates.cronIntervalSeconds !== undefined) {
      this.setSetting('cronIntervalSeconds', String(updates.cronIntervalSeconds));
    }
    if (updates.baseReposFolder !== undefined) {
      this.setSetting('baseReposFolder', updates.baseReposFolder);
    }
    if (updates.cliTool !== undefined) {
      this.setSetting('cliTool', updates.cliTool);
    }
    if (updates.workerEnabled !== undefined) {
      this.setSetting('workerEnabled', String(updates.workerEnabled));
    }
    if (updates.devWorkflowScript !== undefined) {
      this.setSetting('devWorkflowScript', updates.devWorkflowScript);
    }
  }


  // ─────────────────────────────────────────────────────────────────────
  // Dev Queue CRUD (T02)
  // ─────────────────────────────────────────────────────────────────────

  /** Strip potential secrets from CLI error output before persisting. */
  private sanitizeErrorMessage(msg: string | null | undefined): string | null {
    if (!msg) return null;
    // Replace common secret patterns: API keys, tokens, passwords
    return msg
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(?:api[_-]?key|token|password|secret|authorization)[=: ]+\S+/gi, '[REDACTED]')
      .substring(0, 4096); // cap length
  }

  /**
   * Enqueue a feature for automated development.
   * Uses INSERT OR IGNORE to skip duplicates (repo+feature+pending uniqueness).
   * Feature-level: one queue entry per feature, not per task.
   */
  enqueueFeature(repoName: string, featureSlug: string, cliTool: string): { id: number; alreadyQueued: boolean } {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO dev_queue (repo_name, feature_slug, status, cli_tool, created_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(repoName, featureSlug, cliTool, new Date().toISOString());

    if (result.changes === 0) {
      // Already queued — find the existing row
      const existing = this.db.prepare(`
        SELECT id FROM dev_queue
        WHERE repo_name = ? AND feature_slug = ? AND status IN ('pending', 'running')
      `).get(repoName, featureSlug) as { id: number } | undefined;
      return { id: existing?.id ?? 0, alreadyQueued: true };
    }
    return { id: Number(result.lastInsertRowid), alreadyQueued: false };
  }

  /**
   * Get the next pending queue item (FIFO) and mark it as running.
   * Returns null if nothing pending.
   */
  claimNextQueueItem(workerPid: number): DevQueueRow | null {
    const row = this.db.prepare(`
      SELECT id, repo_name, feature_slug, status, cli_tool, created_at,
             started_at, completed_at, error_message, retry_count, worker_pid
      FROM dev_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as DevQueueRow | undefined;

    if (!row) return null;

    this.db.prepare(`
      UPDATE dev_queue SET status = 'running', started_at = ?, worker_pid = ?
      WHERE id = ?
    `).run(new Date().toISOString(), workerPid, row.id);

    return { ...row, status: 'running', worker_pid: workerPid };
  }

  /**
   * Mark a queue item as completed.
   */
  completeQueueItem(id: number): void {
    this.db.prepare(`
      UPDATE dev_queue SET status = 'completed', completed_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  /**
   * Mark a queue item as failed with a sanitized error message.
   */
  failQueueItem(id: number, errorMessage: string): void {
    this.db.prepare(`
      UPDATE dev_queue SET status = 'failed', completed_at = ?, error_message = ?, retry_count = retry_count + 1
      WHERE id = ?
    `).run(new Date().toISOString(), this.sanitizeErrorMessage(errorMessage), id);
  }

  /**
   * Get all queue items for a given feature, optionally filtered by status.
   */
  getQueueItems(repoName?: string, featureSlug?: string, status?: string): DevQueueRow[] {
    let sql = `SELECT id, repo_name, feature_slug, status, cli_tool,
                      created_at, started_at, completed_at, error_message, retry_count, worker_pid
               FROM dev_queue WHERE 1=1`;
    const params: any[] = [];

    if (repoName) { sql += ' AND repo_name = ?'; params.push(repoName); }
    if (featureSlug) { sql += ' AND feature_slug = ?'; params.push(featureSlug); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at ASC';

    return this.db.prepare(sql).all(...params) as DevQueueRow[];
  }

  /**
   * Get queue statistics: pending, running, completed, failed counts.
   */
  getQueueStats(): { pending: number; running: number; completed: number; failed: number; total: number } {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as cnt FROM dev_queue GROUP BY status
    `).all() as Array<{ status: string; cnt: number }>;

    const stats = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
    for (const row of rows) {
      if (row.status in stats) (stats as any)[row.status] = row.cnt;
      stats.total += row.cnt;
    }
    return stats;
  }

  /**
   * Get a single queue item by ID.
   */
  getQueueItem(id: number): DevQueueRow | null {
    const row = this.db.prepare(`
      SELECT id, repo_name, feature_slug, status, cli_tool,
             created_at, started_at, completed_at, error_message, retry_count, worker_pid
      FROM dev_queue WHERE id = ?
    `).get(id) as DevQueueRow | undefined;
    return row ?? null;
  }

  /**
   * Re-enqueue a failed queue item: reset to 'pending' with retry_count=0,
   * error_message=null, started_at=null, completed_at=null.
   * Uses atomic WHERE clause to validate status='failed'.
   */
  reenqueueItem(id: number): { success: boolean; item?: DevQueueRow; error?: string } {
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return { success: false, error: 'Invalid item ID: must be a positive integer' };
    }

    const existing = this.getQueueItem(idNum);
    if (!existing) {
      return { success: false, error: `Queue item ${idNum} not found` };
    }
    if (existing.status !== 'failed') {
      return { success: false, error: `Cannot re-enqueue item in '${existing.status}' status. Item must be in 'failed' status.` };
    }

    // Check if there's already a pending item for the same feature
    const pendingDup = this.db.prepare(`
      SELECT id FROM dev_queue
      WHERE repo_name = ? AND feature_slug = ? AND status = 'pending'
    `).get(existing.repo_name, existing.feature_slug) as { id: number } | undefined;

    if (pendingDup) {
      return { success: false, error: `Cannot re-enqueue: a pending item already exists for feature ${existing.feature_slug} (item #${pendingDup.id})` };
    }

    const result = this.db.prepare(`
      UPDATE dev_queue
      SET status = 'pending', retry_count = 0, error_message = NULL,
          started_at = NULL, completed_at = NULL, worker_pid = NULL
      WHERE id = ? AND status = 'failed'
    `).run(idNum);

    if (result.changes === 0) {
      return { success: false, error: 'Failed to re-enqueue item (concurrent modification)' };
    }

    const updated = this.getQueueItem(idNum);
    return { success: true, item: updated! };
  }

  /**
   * Cancel (remove) a pending queue item.
   * Only items in 'pending' status can be cancelled.
   */
  cancelQueueItem(id: number): { success: boolean; error?: string } {
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return { success: false, error: 'Invalid item ID: must be a positive integer' };
    }

    const existing = this.getQueueItem(idNum);
    if (!existing) {
      return { success: false, error: `Queue item ${idNum} not found` };
    }
    if (existing.status !== 'pending') {
      return { success: false, error: `Cannot cancel item in '${existing.status}' status. Item must be in 'pending' status.` };
    }

    const result = this.db.prepare(`
      DELETE FROM dev_queue WHERE id = ? AND status = 'pending'
    `).run(idNum);

    if (result.changes === 0) {
      return { success: false, error: 'Failed to cancel item (concurrent modification)' };
    }

    return { success: true };
  }

  /**
   * Clear completed or failed queue items older than the given number of days.
   */
  pruneQueueItems(olderThanDays: number = 7): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM dev_queue WHERE status IN ('completed', 'failed') AND completed_at < ?
    `).run(cutoff);
    return Number(result.changes);
  }

  /**
   * Seed default role prompts from ROLE_SYSTEM_PROMPTS if the table is empty.
   * Idempotent — only runs when the role_prompts table has no rows.
   */
  private seedRolePrompts(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as cnt FROM role_prompts').get() as { cnt: number }).cnt;
    if (count > 0) return;

    const insert = this.db.prepare(`
      INSERT INTO role_prompts (role_id, system_prompt, focus_areas, research_instructions, required_output_fields, phase, is_custom, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const seedAll = this.db.transaction(() => {
      for (const [roleId, config] of Object.entries(ROLE_SYSTEM_PROMPTS)) {
        insert.run(
          roleId,
          config.systemPrompt,
          JSON.stringify(config.focusAreas),
          config.researchInstructions,
          JSON.stringify(config.requiredOutputFields),
          config.phase,
          new Date().toISOString()
        );
      }
    });

    seedAll();
  }

  /**
   * Retrieve a single role prompt config from the database.
   * Falls back to static default if no row found.
   */
  getRolePrompt(roleId: PipelineRole): RolePromptConfig {
    const row = this.db.prepare(
      'SELECT * FROM role_prompts WHERE role_id = ?'
    ).get(roleId) as {
      role_id: string;
      system_prompt: string;
      focus_areas: string;
      research_instructions: string;
      required_output_fields: string;
      phase: string;
      is_custom: number;
      updated_at: string;
    } | undefined;

    if (!row) {
      // Fallback to static default
      return ROLE_SYSTEM_PROMPTS[roleId];
    }

    return {
      systemPrompt: row.system_prompt,
      focusAreas: JSON.parse(row.focus_areas),
      researchInstructions: row.research_instructions,
      requiredOutputFields: JSON.parse(row.required_output_fields),
      phase: row.phase as 'review' | 'execution',
    };
  }

  /**
   * Retrieve all role prompt configs from the database.
   */
  getAllRolePrompts(): Array<RolePromptConfig & { roleId: string; isCustom: boolean; updatedAt: string }> {
    const rows = this.db.prepare('SELECT * FROM role_prompts ORDER BY role_id').all() as Array<{
      role_id: string;
      system_prompt: string;
      focus_areas: string;
      research_instructions: string;
      required_output_fields: string;
      phase: string;
      is_custom: number;
      updated_at: string;
    }>;

    return rows.map(row => ({
      roleId: row.role_id,
      systemPrompt: row.system_prompt,
      focusAreas: JSON.parse(row.focus_areas),
      researchInstructions: row.research_instructions,
      requiredOutputFields: JSON.parse(row.required_output_fields),
      phase: row.phase as 'review' | 'execution',
      isCustom: row.is_custom === 1,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update a role prompt config. Marks is_custom = 1.
   */
  updateRolePrompt(
    roleId: PipelineRole,
    update: Partial<Pick<RolePromptConfig, 'systemPrompt' | 'focusAreas' | 'researchInstructions' | 'requiredOutputFields'>>
  ): void {
    // Ensure the row exists first (may not if DB was freshly created with just seeds)
    const existing = this.db.prepare('SELECT role_id FROM role_prompts WHERE role_id = ?').get(roleId);
    if (!existing) {
      // Insert default first, then update
      const defaults = ROLE_SYSTEM_PROMPTS[roleId];
      this.db.prepare(`
        INSERT INTO role_prompts (role_id, system_prompt, focus_areas, research_instructions, required_output_fields, phase, is_custom, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        roleId,
        defaults.systemPrompt,
        JSON.stringify(defaults.focusAreas),
        defaults.researchInstructions,
        JSON.stringify(defaults.requiredOutputFields),
        defaults.phase,
        new Date().toISOString()
      );
    }

    const current = this.getRolePrompt(roleId);
    this.db.prepare(`
      UPDATE role_prompts
      SET system_prompt = ?,
          focus_areas = ?,
          research_instructions = ?,
          required_output_fields = ?,
          is_custom = 1,
          updated_at = ?
      WHERE role_id = ?
    `).run(
      update.systemPrompt ?? current.systemPrompt,
      JSON.stringify(update.focusAreas ?? current.focusAreas),
      update.researchInstructions ?? current.researchInstructions,
      JSON.stringify(update.requiredOutputFields ?? current.requiredOutputFields),
      new Date().toISOString(),
      roleId
    );
  }

  /**
   * Reset a role prompt to its static default. Sets is_custom = 0.
   */
  resetRolePrompt(roleId: PipelineRole): RolePromptConfig {
    const defaults = ROLE_SYSTEM_PROMPTS[roleId];
    this.db.prepare(`
      UPDATE role_prompts
      SET system_prompt = ?,
          focus_areas = ?,
          research_instructions = ?,
          required_output_fields = ?,
          phase = ?,
          is_custom = 0,
          updated_at = ?
      WHERE role_id = ?
    `).run(
      defaults.systemPrompt,
      JSON.stringify(defaults.focusAreas),
      defaults.researchInstructions,
      JSON.stringify(defaults.requiredOutputFields),
      defaults.phase,
      new Date().toISOString(),
      roleId
    );
    return defaults;
  }

  /**
   * Migrate old role names and statuses to new pipeline roles.
   * Runs once on startup; idempotent (safe to re-run).
   */
  private migrateOldRoles(): void {
    const migrate = this.db.transaction(() => {
      // Migrate task statuses
      this.db.prepare(`UPDATE tasks SET status = 'PendingUiUxExpert' WHERE status = 'PendingLeadEngineer'`).run();
      this.db.prepare(`UPDATE tasks SET status = 'PendingSecurityOfficer' WHERE status IN ('PendingCFO', 'PendingCSO')`).run();

      // Migrate transition statuses
      this.db.prepare(`UPDATE transitions SET from_status = 'PendingUiUxExpert' WHERE from_status = 'PendingLeadEngineer'`).run();
      this.db.prepare(`UPDATE transitions SET to_status = 'PendingUiUxExpert' WHERE to_status = 'PendingLeadEngineer'`).run();
      this.db.prepare(`UPDATE transitions SET from_status = 'PendingSecurityOfficer' WHERE from_status IN ('PendingCFO', 'PendingCSO')`).run();
      this.db.prepare(`UPDATE transitions SET to_status = 'PendingSecurityOfficer' WHERE to_status IN ('PendingCFO', 'PendingCSO')`).run();

      // Migrate approver/actor role names in transitions
      this.db.prepare(`UPDATE transitions SET approver = 'uiUxExpert' WHERE approver = 'leadEngineer'`).run();
      this.db.prepare(`UPDATE transitions SET approver = 'securityOfficer' WHERE approver IN ('cfo', 'cso')`).run();
      this.db.prepare(`UPDATE transitions SET actor = 'uiUxExpert' WHERE actor = 'leadEngineer'`).run();
      this.db.prepare(`UPDATE transitions SET actor = 'securityOfficer' WHERE actor IN ('cfo', 'cso')`).run();
      this.db.prepare(`UPDATE transitions SET actor = 'codeReviewer' WHERE actor = 'reviewer'`).run();

      // Migrate stakeholder review role names
      this.db.prepare(`UPDATE stakeholder_reviews SET stakeholder = 'uiUxExpert' WHERE stakeholder = 'leadEngineer'`).run();
      this.db.prepare(`UPDATE stakeholder_reviews SET stakeholder = 'securityOfficer' WHERE stakeholder IN ('cfo', 'cso')`).run();

      // Remove orphaned CFO reviews (no direct equivalent in new pipeline)
      this.db.prepare(`DELETE FROM stakeholder_reviews WHERE stakeholder = 'cfo'`).run();
    });

    migrate();
  }

  /**
   * Run database migrations
   * Automatically applies pending migrations on startup
   */
  private runMigrations(): void {
    // Create migrations tracking table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // Check if multi-repo migration has been applied
    const multiRepoMigration = this.db.prepare(`
      SELECT * FROM _migrations WHERE name = '001_add_multi_repo_support'
    `).get();

    if (!multiRepoMigration) {
      // Read and execute the migration
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const migrationPath = path.join(__dirname, 'migrations', '001_add_multi_repo_support.sql');

      try {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
        this.db.exec(migrationSQL);

        // Record that migration was applied
        this.db.prepare(`
          INSERT INTO _migrations (name, applied_at) VALUES (?, ?)
        `).run('001_add_multi_repo_support', new Date().toISOString());
      } catch (error) {
        // Migration file might not exist in production build
        // In that case, we'll create the essential multi-repo structures inline
        console.warn('Migration file not found, applying inline migration...');
        this.applyMultiRepoMigrationInline();
      }
    }

    // Migration 002: Add description column to features table
    const descriptionMigration = this.db.prepare(`
      SELECT * FROM _migrations WHERE name = '002_add_feature_description'
    `).get();

    if (!descriptionMigration) {
      try {
        this.db.exec(`ALTER TABLE features ADD COLUMN description TEXT`);
      } catch (e) {
        // Column may already exist if DB was manually altered — safe to ignore
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)
      `).run('002_add_feature_description', new Date().toISOString());
    }

    // Migration 003: Convert dev_queue from task-level to feature-level
    const queueMigration = this.db.prepare(`
      SELECT * FROM _migrations WHERE name = '003_feature_level_queue'
    `).get();

    if (!queueMigration) {
      try {
        this.db.exec(`
          -- Recreate dev_queue without task_id column
          DROP TABLE IF EXISTS dev_queue;
          CREATE TABLE dev_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_name TEXT NOT NULL,
            feature_slug TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending', 'running', 'completed', 'failed')),
            cli_tool TEXT NOT NULL DEFAULT 'claude',
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            error_message TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            worker_pid INTEGER,
            UNIQUE(repo_name, feature_slug, status)
          );
          CREATE INDEX IF NOT EXISTS idx_dev_queue_status ON dev_queue(status);
          CREATE INDEX IF NOT EXISTS idx_dev_queue_repo_feature ON dev_queue(repo_name, feature_slug);
          CREATE INDEX IF NOT EXISTS idx_dev_queue_composite ON dev_queue(repo_name, feature_slug, status);
        `);
      } catch (e) {
        console.warn('dev_queue migration warning:', e);
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)
      `).run('003_feature_level_queue', new Date().toISOString());
    }
  }

  /**
   * Apply multi-repo migration inline (fallback if migration file not found)
   */
  private applyMultiRepoMigrationInline(): void {
    try {
      this.db.exec(`
        BEGIN TRANSACTION;

        -- Create repos table
        CREATE TABLE IF NOT EXISTS repos (
          repo_name TEXT PRIMARY KEY,
          repo_path TEXT NOT NULL,
          repo_url TEXT,
          default_branch TEXT DEFAULT 'main',
          created_at TEXT NOT NULL,
          last_accessed_at TEXT NOT NULL,
          metadata TEXT
        );

        -- Create view
        CREATE VIEW IF NOT EXISTS v_repo_summary AS
        SELECT
          r.repo_name,
          r.repo_path,
          r.last_accessed_at,
          COUNT(DISTINCT f.feature_slug) as feature_count,
          COUNT(DISTINCT t.task_id) as total_tasks,
          SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) as completed_tasks
        FROM repos r
        LEFT JOIN features f ON r.repo_name = f.repo_name
        LEFT JOIN tasks t ON f.repo_name = t.repo_name AND f.feature_slug = t.feature_slug
        GROUP BY r.repo_name, r.repo_path, r.last_accessed_at;

        -- Insert default repo
        INSERT OR IGNORE INTO repos (repo_name, repo_path, created_at, last_accessed_at)
        VALUES ('default', '', datetime('now'), datetime('now'));

        COMMIT;
      `);

      // Add repo_name columns (these might fail if already exist, that's ok)
      const columnsToAdd = [
        { table: 'features', column: 'repo_name' },
        { table: 'tasks', column: 'repo_name' },
        { table: 'transitions', column: 'repo_name' },
        { table: 'acceptance_criteria', column: 'repo_name' },
        { table: 'test_scenarios', column: 'repo_name' },
        { table: 'stakeholder_reviews', column: 'repo_name' }
      ];

      for (const { table, column } of columnsToAdd) {
        try {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
        } catch (e) {
          // Column already exists, ignore
        }
      }

      // Update existing records
      this.db.exec(`
        UPDATE features SET repo_name = 'default' WHERE repo_name IS NULL;
        UPDATE tasks SET repo_name = 'default' WHERE repo_name IS NULL;
        UPDATE transitions SET repo_name = 'default' WHERE repo_name IS NULL;
        UPDATE acceptance_criteria SET repo_name = 'default' WHERE repo_name IS NULL;
        UPDATE test_scenarios SET repo_name = 'default' WHERE repo_name IS NULL;
        UPDATE stakeholder_reviews SET repo_name = 'default' WHERE repo_name IS NULL;
      `);

      // Create unique indexes required for ON CONFLICT upserts
      const indexStatements = [
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_features_repo_slug ON features(repo_name, feature_slug)`,
        `CREATE INDEX IF NOT EXISTS idx_tasks_repo_feature ON tasks(repo_name, feature_slug)`,
        `CREATE INDEX IF NOT EXISTS idx_transitions_repo_task ON transitions(repo_name, feature_slug, task_id)`,
        `CREATE INDEX IF NOT EXISTS idx_acceptance_criteria_repo_task ON acceptance_criteria(repo_name, feature_slug, task_id)`,
        `CREATE INDEX IF NOT EXISTS idx_test_scenarios_repo_task ON test_scenarios(repo_name, feature_slug, task_id)`,
        `CREATE INDEX IF NOT EXISTS idx_stakeholder_reviews_repo_task ON stakeholder_reviews(repo_name, feature_slug, task_id)`,
      ];
      for (const stmt of indexStatements) {
        try {
          this.db.exec(stmt);
        } catch (e) {
          // Index may already exist, ignore
        }
      }
    } catch (error) {
      console.error('Error applying inline migration:', error);
    }

    // Record that migration was applied
    this.db.prepare(`
      INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)
    `).run('001_add_multi_repo_support', new Date().toISOString());
  }

  /**
   * Load task file by feature_slug and repo_name
   */
  async loadByFeatureSlug(featureSlug: string, repoName: string = 'default'): Promise<TaskFile> {
    try {
      // Get feature
      const feature = this.db.prepare(`
        SELECT feature_slug, feature_name, created_at, last_modified
        FROM features
        WHERE feature_slug = ? AND repo_name = ?
      `).get(featureSlug, repoName) as any;

      if (!feature) {
        throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
      }

      // Get all tasks for this feature
      const tasks = this.loadTasksForFeature(featureSlug, repoName);

      return {
        featureSlug: feature.feature_slug,
        featureName: feature.feature_name,
        createdAt: feature.created_at,
        lastModified: feature.last_modified,
        tasks
      };
    } catch (error) {
      throw new Error(
        `Failed to load feature: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load all tasks for a feature
   */
  private loadTasksForFeature(featureSlug: string, repoName: string = 'default'): Task[] {
    const taskRows = this.db.prepare(`
      SELECT * FROM tasks WHERE feature_slug = ? AND repo_name = ? ORDER BY order_of_execution
    `).all(featureSlug, repoName) as any[];

    return taskRows.map(row => this.mapRowToTask(featureSlug, repoName, row));
  }

  /**
   * Map database row to Task object
   */
  private mapRowToTask(featureSlug: string, repoName: string, row: any): Task {
    // Load related data
    const transitions = this.loadTransitions(featureSlug, repoName, row.task_id);
    const acceptanceCriteria = this.loadAcceptanceCriteria(featureSlug, repoName, row.task_id);
    const testScenarios = this.loadTestScenarios(featureSlug, repoName, row.task_id);
    const stakeholderReview = this.loadStakeholderReview(featureSlug, repoName, row.task_id);

    return {
      taskId: row.task_id,
      title: row.title,
      description: row.description,
      acceptanceCriteria,
      testScenarios,
      outOfScope: row.out_of_scope ? JSON.parse(row.out_of_scope) : [],
      estimatedHours: row.estimated_hours,
      status: row.status,
      assignedTo: row.assigned_to,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      transitions,
      stakeholderReview,
      orderOfExecution: row.order_of_execution,
      tags: row.tags ? JSON.parse(row.tags) : []
    };
  }

  /**
   * Load transitions for a task
   */
  private loadTransitions(featureSlug: string, repoName: string, taskId: string): Transition[] {
    const rows = this.db.prepare(`
      SELECT * FROM transitions
      WHERE feature_slug = ? AND repo_name = ? AND task_id = ?
      ORDER BY timestamp
    `).all(featureSlug, repoName, taskId) as any[];

    return rows.map(row => {
      const additional = row.additional_data ? JSON.parse(row.additional_data) : {};
      return {
        from: row.from_status,
        to: row.to_status,
        approver: row.approver,
        actor: row.actor,
        timestamp: row.timestamp,
        notes: row.notes,
        ...additional
      };
    });
  }

  /**
   * Load acceptance criteria for a task
   */
  private loadAcceptanceCriteria(featureSlug: string, repoName: string, taskId: string): AcceptanceCriterion[] {
    const rows = this.db.prepare(`
      SELECT * FROM acceptance_criteria
      WHERE feature_slug = ? AND repo_name = ? AND task_id = ?
    `).all(featureSlug, repoName, taskId) as any[];

    return rows.map(row => ({
      id: row.criterion_id,
      criterion: row.criterion,
      priority: row.priority,
      verified: Boolean(row.verified)
    }));
  }

  /**
   * Load test scenarios for a task
   */
  private loadTestScenarios(featureSlug: string, repoName: string, taskId: string): TestScenario[] {
    const rows = this.db.prepare(`
      SELECT * FROM test_scenarios
      WHERE feature_slug = ? AND repo_name = ? AND task_id = ?
    `).all(featureSlug, repoName, taskId) as any[];

    return rows.map(row => ({
      id: row.scenario_id,
      title: row.title,
      description: row.description,
      manualOnly: Boolean(row.manual_only),
      priority: row.priority
    }));
  }

  /**
   * Load stakeholder review for a task
   */
  private loadStakeholderReview(featureSlug: string, repoName: string, taskId: string): StakeholderReview {
    const rows = this.db.prepare(`
      SELECT * FROM stakeholder_reviews
      WHERE feature_slug = ? AND repo_name = ? AND task_id = ?
    `).all(featureSlug, repoName, taskId) as any[];

    const review: StakeholderReview = {};

    for (const row of rows) {
      const additional = row.additional_data ? JSON.parse(row.additional_data) : {};
      review[row.stakeholder as keyof StakeholderReview] = {
        approved: Boolean(row.approved),
        notes: row.notes,
        ...additional
      } as any;
    }

    return review;
  }

  /**
   * Save task file by feature_slug
   */
  async saveByFeatureSlug(featureSlug: string, taskFile: TaskFile, repoName: string = 'default'): Promise<void> {
    // Ensure featureSlug matches taskFile.featureSlug
    if (featureSlug !== taskFile.featureSlug) {
      throw new Error(`Feature slug mismatch: ${featureSlug} !== ${taskFile.featureSlug}`);
    }

    const saveTransaction = this.db.transaction((data: TaskFile, repo: string) => {
      const now = new Date().toISOString();

      // Upsert feature
      this.db.prepare(`
        INSERT INTO features (repo_name, feature_slug, feature_name, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(repo_name, feature_slug) DO UPDATE SET
          feature_name = excluded.feature_name,
          last_modified = excluded.last_modified
      `).run(repo, data.featureSlug, data.featureName, data.createdAt || now, now);

      // Delete existing tasks and related data (CASCADE will handle related tables)
      this.db.prepare(`DELETE FROM tasks WHERE repo_name = ? AND feature_slug = ?`).run(repo, data.featureSlug);

      // Insert all tasks
      for (const task of data.tasks) {
        this.saveTask(data.featureSlug, task, repo);
      }
    });

    try {
      saveTransaction(taskFile, repoName);
    } catch (error) {
      throw new Error(
        `Failed to save feature: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Save a single task with all related data
   */
  private saveTask(featureSlug: string, task: Task, repoName: string = 'default'): void {
    // Insert task
    this.db.prepare(`
      INSERT INTO tasks (
        repo_name, feature_slug, task_id, title, description, status,
        assigned_to, estimated_hours, order_of_execution,
        tags, dependencies, out_of_scope
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      repoName,
      featureSlug,
      task.taskId,
      task.title,
      task.description,
      task.status,
      task.assignedTo || null,
      task.estimatedHours || null,
      task.orderOfExecution,
      task.tags ? JSON.stringify(task.tags) : null,
      task.dependencies ? JSON.stringify(task.dependencies) : null,
      task.outOfScope ? JSON.stringify(task.outOfScope) : null
    );

    // Insert transitions
    for (const transition of task.transitions) {
      const { from, to, approver, actor, timestamp, notes, ...additional } = transition;
      this.db.prepare(`
        INSERT INTO transitions (
          repo_name, feature_slug, task_id, from_status, to_status,
          approver, actor, timestamp, notes, additional_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        repoName,
        featureSlug,
        task.taskId,
        from,
        to,
        approver || null,
        actor || null,
        timestamp,
        notes || null,
        JSON.stringify(additional)
      );
    }

    // Insert acceptance criteria
    for (const criterion of task.acceptanceCriteria) {
      this.db.prepare(`
        INSERT INTO acceptance_criteria (
          repo_name, feature_slug, task_id, criterion_id, criterion, priority, verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        repoName,
        featureSlug,
        task.taskId,
        criterion.id,
        criterion.criterion,
        criterion.priority,
        criterion.verified ? 1 : 0
      );
    }

    // Insert test scenarios
    if (task.testScenarios) {
      for (const scenario of task.testScenarios) {
        this.db.prepare(`
          INSERT INTO test_scenarios (
            repo_name, feature_slug, task_id, scenario_id, title, description, manual_only, priority
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          repoName,
          featureSlug,
          task.taskId,
          scenario.id,
          scenario.title,
          scenario.description,
          scenario.manualOnly ? 1 : 0,
          scenario.priority
        );
      }
    }

    // Insert stakeholder reviews
    for (const [stakeholder, review] of Object.entries(task.stakeholderReview)) {
      if (review) {
        const { approved, notes, ...additional } = review;
        this.db.prepare(`
          INSERT INTO stakeholder_reviews (
            repo_name, feature_slug, task_id, stakeholder, approved, notes, additional_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          repoName,
          featureSlug,
          task.taskId,
          stakeholder,
          approved ? 1 : 0,
          notes,
          JSON.stringify(additional)
        );
      }
    }
  }

  /**
   * Validate feature exists
   */
  async validateFeatureSlug(featureSlug: string, repoName: string = 'default'): Promise<{ valid: boolean; error?: string }> {
    try {
      const feature = this.db.prepare(`
        SELECT feature_slug FROM features WHERE feature_slug = ? AND repo_name = ?
      `).get(featureSlug, repoName);

      if (!feature) {
        return { valid: false, error: 'Feature does not exist' };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Load task file with lock (same as loadByFeatureSlug for now, SQLite handles locking)
   */
  async loadByFeatureSlugWithLock(featureSlug: string, repoName: string = 'default'): Promise<TaskFile> {
    return this.loadByFeatureSlug(featureSlug, repoName);
  }

  /**
   * Save a workflow checkpoint (Recommendation 3)
   */
  saveCheckpoint(repoName: string, featureSlug: string, description: string, tasks: any[]): number {
    const snapshot = JSON.stringify(tasks.map(t => ({ taskId: t.taskId, status: t.status })));
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      INSERT INTO workflow_checkpoints (repo_name, feature_slug, description, saved_at, snapshot)
      VALUES (?, ?, ?, ?, ?)
    `).run(repoName, featureSlug, description, now, snapshot);

    return result.lastInsertRowid as number;
  }

  /**
   * List all checkpoints for a feature (Recommendation 3)
   */
  listCheckpoints(repoName: string, featureSlug: string): any[] {
    const rows = this.db.prepare(`
      SELECT id, repo_name, feature_slug, description, saved_at, snapshot
      FROM workflow_checkpoints
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY saved_at DESC
    `).all(repoName, featureSlug) as any[];

    return rows.map(row => ({
      id: row.id,
      repoName: row.repo_name,
      featureSlug: row.feature_slug,
      description: row.description,
      savedAt: row.saved_at,
      snapshot: JSON.parse(row.snapshot)
    }));
  }

  /**
   * Get a specific checkpoint (Recommendation 3)
   */
  getCheckpoint(repoName: string, featureSlug: string, checkpointId: number): any {
    const row = this.db.prepare(`
      SELECT id, repo_name, feature_slug, description, saved_at, snapshot
      FROM workflow_checkpoints
      WHERE repo_name = ? AND feature_slug = ? AND id = ?
    `).get(repoName, featureSlug, checkpointId) as any;

    if (!row) return null;

    return {
      id: row.id,
      repoName: row.repo_name,
      featureSlug: row.feature_slug,
      description: row.description,
      savedAt: row.saved_at,
      snapshot: JSON.parse(row.snapshot)
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get all feature slugs
   */
  getAllFeatures(repoName: string = 'default'): Array<{ featureSlug: string; featureName: string; description: string; lastModified: string; totalTasks: number }> {
    const rows = this.db.prepare(`
      SELECT
        f.feature_slug,
        f.feature_name,
        f.description,
        f.last_modified,
        COUNT(t.id) as total_tasks
      FROM features f
      LEFT JOIN tasks t ON f.feature_slug = t.feature_slug AND f.repo_name = t.repo_name
      WHERE f.repo_name = ?
      GROUP BY f.feature_slug, f.feature_name, f.description, f.last_modified
      ORDER BY f.last_modified DESC
    `).all(repoName) as any[];

    return rows.map(row => ({
      featureSlug: row.feature_slug,
      featureName: row.feature_name,
      description: row.description || '',
      lastModified: row.last_modified,
      totalTasks: row.total_tasks
    }));
  }

  /**
   * Create a new feature
   */
  createFeature(featureSlug: string, featureName: string, repoName: string = 'default', description?: string): void {
    const now = new Date().toISOString();
    const cleanDescription = description ? description.replace(/\x00/g, '').trim().slice(0, 10000) : null;

    this.db.prepare(`
      INSERT INTO features (repo_name, feature_slug, feature_name, description, created_at, last_modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(repoName, featureSlug, featureName, cleanDescription, now, now);
  }

  /**
   * Update a feature's name and/or description
   */
  updateFeature(featureSlug: string, repoName: string = 'default', updates: { featureName?: string; description?: string }): void {
    const existing = this.db.prepare(
      `SELECT feature_slug FROM features WHERE feature_slug = ? AND repo_name = ?`
    ).get(featureSlug, repoName);
    if (!existing) {
      throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
    }

    const now = new Date().toISOString();
    const fields: string[] = ['last_modified = ?'];
    const values: any[] = [now];

    if (updates.featureName !== undefined) {
      fields.push('feature_name = ?');
      values.push(updates.featureName);
    }
    if (updates.description !== undefined) {
      const clean = updates.description.replace(/\x00/g, '').trim().slice(0, 10000);
      fields.push('description = ?');
      values.push(clean);
    }

    values.push(featureSlug, repoName);
    this.db.prepare(
      `UPDATE features SET ${fields.join(', ')} WHERE feature_slug = ? AND repo_name = ?`
    ).run(...values);
  }

  /**
   * Delete a feature and all its tasks
   */
  deleteFeature(featureSlug: string, repoName: string = 'default'): void {
    this.db.prepare(`DELETE FROM features WHERE feature_slug = ? AND repo_name = ?`).run(featureSlug, repoName);
  }

  /**
   * Delete a repo and all associated features, tasks, and related data
   */
  deleteRepo(repoName: string): { deleted: boolean; featureCount: number; taskCount: number } {
    // Validate repo exists
    const repo = this.db.prepare(`SELECT repo_name FROM repos WHERE repo_name = ?`).get(repoName) as any;
    if (!repo) {
      return { deleted: false, featureCount: 0, taskCount: 0 };
    }

    const featureCount = (this.db.prepare(`SELECT COUNT(*) as count FROM features WHERE repo_name = ?`).get(repoName) as any).count;
    const taskCount = (this.db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE repo_name = ?`).get(repoName) as any).count;

    const doDelete = this.db.transaction(() => {
      // Delete in child-first order (FK cascades handle most, but explicit for clarity)
      this.db.prepare(`DELETE FROM feature_clarifications WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM feature_attachments WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM feature_acceptance_criteria WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM feature_test_scenarios WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM feature_refinement_steps WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM workflow_checkpoints WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM stakeholder_reviews WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM test_scenarios WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM acceptance_criteria WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM transitions WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM tasks WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM features WHERE repo_name = ?`).run(repoName);
      this.db.prepare(`DELETE FROM repos WHERE repo_name = ?`).run(repoName);
    });

    doDelete();
    console.log(`[deleteRepo] Deleted repo '${repoName}': ${featureCount} features, ${taskCount} tasks removed at ${new Date().toISOString()}`);
    return { deleted: true, featureCount, taskCount };
  }

  /**
   * Add a task to a feature
   */
  addTask(featureSlug: string, task: Partial<Task>, repoName: string = 'default'): string {
    const now = new Date().toISOString();

    // Ensure feature exists
    const feature = this.db.prepare(`SELECT feature_slug FROM features WHERE feature_slug = ? AND repo_name = ?`).get(featureSlug, repoName);
    if (!feature) {
      throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
    }

    const taskId = task.taskId || `T${Date.now()}`;

    // Insert task
    this.db.prepare(`
      INSERT INTO tasks (
        repo_name, feature_slug, task_id, title, description, status,
        assigned_to, estimated_hours, order_of_execution,
        tags, dependencies, out_of_scope
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      repoName,
      featureSlug,
      taskId,
      task.title || 'New Task',
      task.description || '',
      task.status || 'PendingProductDirector',
      task.assignedTo || null,
      task.estimatedHours || null,
      task.orderOfExecution || 0,
      task.tags ? JSON.stringify(task.tags) : null,
      task.dependencies ? JSON.stringify(task.dependencies) : '[]',
      task.outOfScope ? JSON.stringify(task.outOfScope) : '[]'
    );

    // Insert acceptance criteria
    if (task.acceptanceCriteria) {
      for (const criterion of task.acceptanceCriteria) {
        this.db.prepare(`
          INSERT INTO acceptance_criteria (
            repo_name, feature_slug, task_id, criterion_id, criterion, priority, verified
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          repoName, featureSlug, taskId,
          criterion.id, criterion.criterion, criterion.priority,
          criterion.verified ? 1 : 0
        );
      }
    }

    // Insert test scenarios
    if (task.testScenarios) {
      for (const scenario of task.testScenarios) {
        this.db.prepare(`
          INSERT INTO test_scenarios (
            repo_name, feature_slug, task_id, scenario_id, title, description, manual_only, priority
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          repoName, featureSlug, taskId,
          scenario.id, scenario.title, scenario.description,
          scenario.manualOnly ? 1 : 0, scenario.priority
        );
      }
    }

    // Update feature last_modified
    this.db.prepare(`
      UPDATE features SET last_modified = ? WHERE feature_slug = ? AND repo_name = ?
    `).run(now, featureSlug, repoName);

    return taskId;
  }

  /**
   * Update specific fields of a task
   */
  updateTask(featureSlug: string, taskId: string, updates: Partial<Task>, repoName: string = 'default'): void {
    const now = new Date().toISOString();

    const updateTransaction = this.db.transaction(() => {
      // Verify feature exists
      const feature = this.db.prepare(`SELECT feature_slug FROM features WHERE feature_slug = ? AND repo_name = ?`).get(featureSlug, repoName);
      if (!feature) {
        throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
      }

      // Verify task exists
      const task = this.db.prepare(`SELECT task_id FROM tasks WHERE feature_slug = ? AND repo_name = ? AND task_id = ?`).get(featureSlug, repoName, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Update basic task fields if provided
      const updateFields: string[] = [];
      const updateValues: any[] = [];

      if (updates.title !== undefined) {
        updateFields.push('title = ?');
        updateValues.push(updates.title);
      }
      if (updates.description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(updates.description);
      }
      if (updates.orderOfExecution !== undefined) {
        updateFields.push('order_of_execution = ?');
        updateValues.push(updates.orderOfExecution);
      }
      if (updates.estimatedHours !== undefined) {
        updateFields.push('estimated_hours = ?');
        updateValues.push(updates.estimatedHours);
      }
      if (updates.tags !== undefined) {
        updateFields.push('tags = ?');
        updateValues.push(JSON.stringify(updates.tags));
      }
      if (updates.dependencies !== undefined) {
        updateFields.push('dependencies = ?');
        updateValues.push(JSON.stringify(updates.dependencies));
      }
      if (updates.outOfScope !== undefined) {
        updateFields.push('out_of_scope = ?');
        updateValues.push(JSON.stringify(updates.outOfScope));
      }

      // Only execute update if there are fields to update
      if (updateFields.length > 0) {
        updateValues.push(repoName, featureSlug, taskId);
        this.db.prepare(`
          UPDATE tasks
          SET ${updateFields.join(', ')}
          WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
        `).run(...updateValues);
      }

      // Handle acceptance criteria - delete old and insert new
      if (updates.acceptanceCriteria !== undefined) {
        this.db.prepare(`
          DELETE FROM acceptance_criteria WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
        `).run(repoName, featureSlug, taskId);

        for (const criterion of updates.acceptanceCriteria) {
          this.db.prepare(`
            INSERT INTO acceptance_criteria (
              repo_name, feature_slug, task_id, criterion_id, criterion, priority, verified
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            repoName, featureSlug, taskId,
            criterion.id, criterion.criterion, criterion.priority,
            criterion.verified ? 1 : 0
          );
        }
      }

      // Handle test scenarios - delete old and insert new
      if (updates.testScenarios !== undefined) {
        this.db.prepare(`
          DELETE FROM test_scenarios WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
        `).run(repoName, featureSlug, taskId);

        for (const scenario of updates.testScenarios) {
          this.db.prepare(`
            INSERT INTO test_scenarios (
              repo_name, feature_slug, task_id, scenario_id, title, description, manual_only, priority
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            repoName, featureSlug, taskId,
            scenario.id, scenario.title, scenario.description,
            scenario.manualOnly ? 1 : 0, scenario.priority
          );
        }
      }

      // Update feature last_modified
      this.db.prepare(`
        UPDATE features SET last_modified = ? WHERE feature_slug = ? AND repo_name = ?
      `).run(now, featureSlug, repoName);
    });

    updateTransaction();
  }

  /**
   * Delete a task from a feature
   */
  deleteTask(featureSlug: string, taskId: string, repoName: string = 'default'): void {
    const now = new Date().toISOString();

    const deleteTransaction = this.db.transaction(() => {
      // Verify feature exists
      const feature = this.db.prepare(`SELECT feature_slug FROM features WHERE feature_slug = ? AND repo_name = ?`).get(featureSlug, repoName);
      if (!feature) {
        throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
      }

      // Verify task exists before deletion
      const task = this.db.prepare(`SELECT task_id FROM tasks WHERE repo_name = ? AND feature_slug = ? AND task_id = ?`).get(repoName, featureSlug, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Delete task (CASCADE will automatically delete related data)
      this.db.prepare(`
        DELETE FROM tasks WHERE repo_name = ? AND feature_slug = ? AND task_id = ?
      `).run(repoName, featureSlug, taskId);

      // Update feature last_modified
      this.db.prepare(`
        UPDATE features SET last_modified = ? WHERE feature_slug = ? AND repo_name = ?
      `).run(now, featureSlug, repoName);
    });

    deleteTransaction();
  }

  // ============================================================================
  // Multi-Repo Support Methods
  // ============================================================================

  /**
   * Register a new repository
   */
  registerRepo(repoName: string, repoPath: string, repoUrl?: string, defaultBranch?: string, metadata?: Record<string, any>): void {
    // Check if repo already exists
    const existing = this.db.prepare(`
      SELECT repo_name FROM repos WHERE repo_name = ?
    `).get(repoName);

    if (existing) {
      throw new Error(`Repository "${repoName}" is already registered`);
    }

    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO repos (repo_name, repo_path, repo_url, default_branch, created_at, last_accessed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      repoName,
      repoPath,
      repoUrl || null,
      defaultBranch || 'main',
      now,
      now,
      metadata ? JSON.stringify(metadata) : null
    );
  }

  /**
   * Get a specific repository
   */
  getRepo(repoName: string): any | null {
    const repo = this.db.prepare(`
      SELECT * FROM repos WHERE repo_name = ?
    `).get(repoName) as any;

    if (!repo) return null;

    return {
      repoName: repo.repo_name,
      repoPath: repo.repo_path,
      repoUrl: repo.repo_url,
      defaultBranch: repo.default_branch,
      createdAt: repo.created_at,
      lastAccessedAt: repo.last_accessed_at,
      metadata: repo.metadata ? JSON.parse(repo.metadata) : null
    };
  }

  /**
   * Get all repositories with summary data
   */
  getAllRepos(): any[] {
    const repos = this.db.prepare(`
      SELECT * FROM v_repo_summary ORDER BY last_accessed_at DESC
    `).all() as any[];

    return repos.map(repo => ({
      repoName: repo.repo_name,
      repoPath: repo.repo_path,
      featureCount: repo.feature_count || 0,
      totalTasks: repo.total_tasks || 0,
      completedTasks: repo.completed_tasks || 0,
      lastAccessedAt: repo.last_accessed_at
    }));
  }

  /**
   * Get current repository based on working directory
   */
  getCurrentRepo(): { repoName: string; repoPath: string; registered: boolean } | null {
    const cwd = process.cwd();

    // Try to find repo by exact path match
    const repo = this.db.prepare(`
      SELECT repo_name, repo_path FROM repos WHERE repo_path = ?
    `).get(cwd) as any;

    if (repo) {
      return {
        repoName: repo.repo_name,
        repoPath: repo.repo_path,
        registered: true
      };
    }

    // If not found, try to extract repo name from path
    const pathParts = cwd.split(/[/\\]/);
    const repoName = pathParts[pathParts.length - 1] || 'unknown';

    return {
      repoName,
      repoPath: cwd,
      registered: false
    };
  }

  // ============================================================================
  // Refinement Step Methods
  // ============================================================================

  /**
   * Update a refinement step for a feature
   */
  updateRefinementStep(
    repoName: string,
    featureSlug: string,
    stepNumber: number,
    completed: boolean,
    summary: string,
    data?: Record<string, any>
  ): void {
    const now = new Date().toISOString();
    const stepName = `step${stepNumber}`;

    this.db.prepare(`
      INSERT INTO feature_refinement_steps (
        repo_name, feature_slug, step_number, step_name, completed, completed_at, summary, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_name, feature_slug, step_number) DO UPDATE SET
        completed = excluded.completed,
        completed_at = excluded.completed_at,
        summary = excluded.summary,
        data = excluded.data
    `).run(
      repoName,
      featureSlug,
      stepNumber,
      stepName,
      completed ? 1 : 0,
      completed ? now : null,
      summary,
      data ? JSON.stringify(data) : null
    );
  }

  /**
   * Get all refinement steps for a feature
   */
  getRefinementSteps(repoName: string, featureSlug: string): any[] {
    const steps = this.db.prepare(`
      SELECT * FROM feature_refinement_steps
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY step_number
    `).all(repoName, featureSlug) as any[];

    return steps.map(step => ({
      stepNumber: step.step_number,
      stepName: step.step_name,
      completed: Boolean(step.completed),
      completedAt: step.completed_at,
      summary: step.summary,
      data: step.data ? JSON.parse(step.data) : null
    }));
  }

  /**
   * Initialize refinement steps for a new feature (Steps 1-8)
   */
  initializeRefinementSteps(repoName: string, featureSlug: string): void {
    const steps = [
      { number: 1, name: 'step1' },
      { number: 2, name: 'step2' },
      { number: 3, name: 'step3' },
      { number: 4, name: 'step4' },
      { number: 5, name: 'step5' },
      { number: 6, name: 'step6' },
      { number: 7, name: 'step7' },
      { number: 8, name: 'step8' }
    ];

    for (const step of steps) {
      this.db.prepare(`
        INSERT OR IGNORE INTO feature_refinement_steps (
          repo_name, feature_slug, step_number, step_name, completed
        ) VALUES (?, ?, ?, ?, 0)
      `).run(repoName, featureSlug, step.number, step.name);
    }
  }

  // ============================================================================
  // Feature-Level Acceptance Criteria Methods
  // ============================================================================

  /**
   * Add acceptance criteria to a feature
   */
  addFeatureAcceptanceCriteria(
    repoName: string,
    featureSlug: string,
    criteria: Array<{ criterionId: string; criterion: string; priority: string; source?: string }>
  ): number {
    const now = new Date().toISOString();
    let count = 0;

    for (const ac of criteria) {
      this.db.prepare(`
        INSERT INTO feature_acceptance_criteria (
          repo_name, feature_slug, criterion_id, criterion, priority, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_name, feature_slug, criterion_id) DO UPDATE SET
          criterion = excluded.criterion,
          priority = excluded.priority,
          source = excluded.source
      `).run(
        repoName,
        featureSlug,
        ac.criterionId,
        ac.criterion,
        ac.priority,
        ac.source || 'generated',
        now
      );
      count++;
    }

    return count;
  }

  /**
   * Get feature-level acceptance criteria
   */
  getFeatureAcceptanceCriteria(repoName: string, featureSlug: string): any[] {
    const criteria = this.db.prepare(`
      SELECT * FROM feature_acceptance_criteria
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY created_at
    `).all(repoName, featureSlug) as any[];

    return criteria.map(ac => ({
      criterionId: ac.criterion_id,
      criterion: ac.criterion,
      priority: ac.priority,
      source: ac.source,
      createdAt: ac.created_at
    }));
  }

  // ============================================================================
  // Feature-Level Test Scenario Methods
  // ============================================================================

  /**
   * Add test scenarios to a feature
   */
  addFeatureTestScenarios(
    repoName: string,
    featureSlug: string,
    scenarios: Array<{
      scenarioId: string;
      title: string;
      description: string;
      priority: string;
      type?: string;
      preconditions?: string;
      expectedResult?: string;
    }>
  ): number {
    const now = new Date().toISOString();
    let count = 0;

    for (const scenario of scenarios) {
      this.db.prepare(`
        INSERT INTO feature_test_scenarios (
          repo_name, feature_slug, scenario_id, title, description, priority, type,
          preconditions, expected_result, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_name, feature_slug, scenario_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          priority = excluded.priority,
          type = excluded.type,
          preconditions = excluded.preconditions,
          expected_result = excluded.expected_result
      `).run(
        repoName,
        featureSlug,
        scenario.scenarioId,
        scenario.title,
        scenario.description,
        scenario.priority,
        scenario.type || 'automated',
        scenario.preconditions || null,
        scenario.expectedResult || null,
        now
      );
      count++;
    }

    return count;
  }

  /**
   * Get feature-level test scenarios
   */
  getFeatureTestScenarios(repoName: string, featureSlug: string): any[] {
    const scenarios = this.db.prepare(`
      SELECT * FROM feature_test_scenarios
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY created_at
    `).all(repoName, featureSlug) as any[];

    return scenarios.map(ts => ({
      scenarioId: ts.scenario_id,
      title: ts.title,
      description: ts.description,
      priority: ts.priority,
      type: ts.type,
      preconditions: ts.preconditions,
      expectedResult: ts.expected_result,
      createdAt: ts.created_at
    }));
  }

  // ============================================================================
  // Clarification Methods
  // ============================================================================

  /**
   * Add a clarification (Q&A) to a feature
   */
  addClarification(
    repoName: string,
    featureSlug: string,
    question: string,
    answer?: string,
    askedBy: 'llm' | 'user' = 'llm'
  ): number {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      INSERT INTO feature_clarifications (
        repo_name, feature_slug, question, answer, asked_at, answered_at, asked_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      repoName,
      featureSlug,
      question,
      answer || null,
      now,
      answer ? now : null,
      askedBy
    );

    return Number(result.lastInsertRowid);
  }

  /**
   * Get all clarifications for a feature
   */
  getClarifications(repoName: string, featureSlug: string): any[] {
    const clarifications = this.db.prepare(`
      SELECT * FROM feature_clarifications
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY asked_at
    `).all(repoName, featureSlug) as any[];

    return clarifications.map(c => ({
      id: c.id,
      question: c.question,
      answer: c.answer,
      askedAt: c.asked_at,
      answeredAt: c.answered_at,
      askedBy: c.asked_by
    }));
  }

  // ============================================================================
  // Attachment Analysis Methods
  // ============================================================================

  /**
   * Add attachment analysis to a feature
   */
  addAttachmentAnalysis(
    repoName: string,
    featureSlug: string,
    attachmentName: string,
    attachmentType: string,
    analysisSummary: string,
    filePath?: string,
    fileUrl?: string,
    extractedData?: Record<string, any>
  ): number {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      INSERT INTO feature_attachments (
        repo_name, feature_slug, attachment_name, attachment_type, file_path, file_url,
        analysis_summary, extracted_data, analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      repoName,
      featureSlug,
      attachmentName,
      attachmentType,
      filePath || null,
      fileUrl || null,
      analysisSummary,
      extractedData ? JSON.stringify(extractedData) : null,
      now
    );

    return Number(result.lastInsertRowid);
  }

  /**
   * Get all attachment analyses for a feature
   */
  getAttachments(repoName: string, featureSlug: string): any[] {
    const attachments = this.db.prepare(`
      SELECT * FROM feature_attachments
      WHERE repo_name = ? AND feature_slug = ?
      ORDER BY analyzed_at
    `).all(repoName, featureSlug) as any[];

    return attachments.map(a => ({
      id: a.id,
      attachmentName: a.attachment_name,
      attachmentType: a.attachment_type,
      filePath: a.file_path,
      fileUrl: a.file_url,
      analysisSummary: a.analysis_summary,
      extractedData: a.extracted_data ? JSON.parse(a.extracted_data) : null,
      analyzedAt: a.analyzed_at
    }));
  }

  // ============================================================================
  // Refinement Status Methods
  // ============================================================================

  /**
   * Get comprehensive refinement status for a feature
   */
  getRefinementStatus(repoName: string, featureSlug: string): any {
    // Get feature info
    const feature = this.db.prepare(`
      SELECT feature_name FROM features WHERE repo_name = ? AND feature_slug = ?
    `).get(repoName, featureSlug) as any;

    if (!feature) {
      throw new Error(`Feature not found: ${featureSlug} in repo ${repoName}`);
    }

    // Get refinement steps
    const steps = this.getRefinementSteps(repoName, featureSlug);
    const completedSteps = steps.filter(s => s.completed).length;
    const totalSteps = steps.length || 8;
    const progressPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Determine current step
    const firstIncomplete = steps.find(s => !s.completed);
    const currentStep = firstIncomplete ? firstIncomplete.stepName : 'step8';

    // Get counts
    const acceptanceCriteria = this.getFeatureAcceptanceCriteria(repoName, featureSlug);
    const testScenarios = this.getFeatureTestScenarios(repoName, featureSlug);
    const clarifications = this.getClarifications(repoName, featureSlug);
    const attachments = this.getAttachments(repoName, featureSlug);

    // Get task count
    const taskCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM tasks WHERE repo_name = ? AND feature_slug = ?
    `).get(repoName, featureSlug) as any;

    return {
      repoName,
      featureSlug,
      featureName: feature.feature_name,
      currentStep,
      progressPercentage,
      completedSteps,
      totalSteps,
      steps,
      acceptanceCriteriaCount: acceptanceCriteria.length,
      testScenariosCount: testScenarios.length,
      clarificationsCount: clarifications.length,
      attachmentsCount: attachments.length,
      tasksCount: taskCount.count
    };
  }

  // ============================================================================
  // Presence Tracking Methods (T03)
  // ============================================================================

  /**
   * Record or update reviewer presence
   * @param reviewerId Unique identifier for the reviewer
   * @param status Presence status (online, idle, offline)
   * @param currentFeature Current feature/task being reviewed
   * @param ttlMinutes Time-to-live in minutes (default 30)
   */
  recordPresence(reviewerId: string, status: string = 'online', currentFeature?: string, ttlMinutes: number = 30): void {
    const now = Math.floor(Date.now() / 1000); // seconds since epoch
    const expiresAt = now + (ttlMinutes * 60);

    this.db.prepare(`
      INSERT INTO reviewer_presence (reviewer_id, status, current_feature, started_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(reviewer_id) DO UPDATE SET
        status = excluded.status,
        current_feature = excluded.current_feature,
        started_at = excluded.started_at,
        expires_at = excluded.expires_at
    `).run(
      reviewerId,
      status,
      currentFeature || null,
      now,
      expiresAt,
      new Date().toISOString()
    );
  }

  /**
   * Get active presence records
   */
  getActivePresence(): any[] {
    const now = Math.floor(Date.now() / 1000);

    return this.db.prepare(`
      SELECT reviewer_id, status, current_feature, started_at, expires_at
      FROM reviewer_presence
      WHERE expires_at > ?
      ORDER BY started_at DESC
    `).all(now) as any[];
  }

  /**
   * Mark reviewer as offline
   */
  markOffline(reviewerId: string): void {
    this.db.prepare(`
      UPDATE reviewer_presence
      SET status = 'offline'
      WHERE reviewer_id = ?
    `).run(reviewerId);
  }

  /**
   * Remove presence record
   */
  removePresence(reviewerId: string): void {
    this.db.prepare(`
      DELETE FROM reviewer_presence
      WHERE reviewer_id = ?
    `).run(reviewerId);
  }

  /**
   * Clean up expired presence records (TTL-based cleanup)
   * Called periodically to remove stale presence data
   */
  cleanupExpiredPresence(): number {
    const now = Math.floor(Date.now() / 1000);

    const result = this.db.prepare(`
      DELETE FROM reviewer_presence
      WHERE expires_at < ?
    `).run(now);

    return Number(result.changes);
  }

  /**
   * Schedule automatic cleanup of expired presence records
   * @param intervalMinutes How often to run cleanup (default 5 minutes)
   */
  schedulePresenceCleanup(intervalMinutes: number = 5): NodeJS.Timeout {
    return setInterval(() => {
      try {
        const removed = this.cleanupExpiredPresence();
        if (removed > 0) {
          console.error(`[Presence Cleanup] Removed ${removed} expired records`);
        }
      } catch (err) {
        console.error(`[Presence Cleanup] Error: ${err}`);
      }
    }, intervalMinutes * 60 * 1000);
  }
}
