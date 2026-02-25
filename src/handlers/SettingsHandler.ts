import { BaseHandler } from './BaseHandler.js';

/**
 * SettingsHandler manages application settings and configuration.
 */
export class SettingsHandler extends BaseHandler {
  /**
   * Get a setting value.
   * @param key - Setting key
   * @returns Setting value or null
   */
  getSetting(key: string): any {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row: any = stmt.get(key);
    return row ? row.value : null;
  }

  /**
   * Set a setting value.
   * @param key - Setting key
   * @param value - Setting value
   */
  setSetting(key: string, value: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);
    stmt.run(key, typeof value === 'object' ? JSON.stringify(value) : value);
  }

  /**
   * Get all settings.
   * @returns Record of all settings
   */
  getAllSettings(): Record<string, any> {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows: any[] = stmt.all() || [];
    const settings: Record<string, any> = {};
    rows.forEach(row => {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    });
    return settings;
  }

  /**
   * Get role prompt for a specific role.
   * @param role - Role name
   * @returns Role prompt or null
   */
  getRolePrompt(role: string): string | null {
    const stmt = this.db.prepare('SELECT prompt FROM role_prompts WHERE role = ?');
    const row: any = stmt.get(role);
    return row ? row.prompt : null;
  }

  /**
   * Set role prompt.
   * @param role - Role name
   * @param prompt - Role prompt text
   */
  setRolePrompt(role: string, prompt: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO role_prompts (role, prompt, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(role) DO UPDATE SET
        prompt = excluded.prompt,
        updated_at = datetime('now')
    `);
    stmt.run(role, prompt);
  }
}
