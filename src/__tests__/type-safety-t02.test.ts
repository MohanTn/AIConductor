/**
 * Tests for T02: Replace 40+ `any` Types with Proper TypeScript Interfaces
 * Verifies that type safety improvements are in place and TypeScript compilation succeeds
 */

import { execSync } from 'child_process';
import path from 'path';

describe('T02: Replace 40+ `any` Types with Proper TypeScript Interfaces', () => {
  const projectRoot = path.join(__dirname, '..', '..');

  describe('TS-3: Type Safety - TypeScript Compilation', () => {
    it('should compile with zero TypeScript errors after type replacements', () => {
      try {
        // Run TypeScript compiler in check-only mode
        const output = execSync('npx tsc --noEmit 2>&1', {
          cwd: projectRoot,
          encoding: 'utf-8'
        });

        // If there are errors, tsc will exit with code 1, so we won't get here
        // If we get here, compilation succeeded
        expect(output.includes('error')).toBe(false);
      } catch (err: any) {
        // tsc exits with code 1 if there are errors
        const output = err.stdout?.toString() || err.message;
        if (output && output.includes('error')) {
          throw new Error(`TypeScript compilation errors found:\n${output}`);
        }
        // Other errors should be re-thrown
        throw err;
      }
    });
  });

  describe('TS-4: Type Safety - DatabaseHandler Types', () => {
    it('should have proper DatabaseTaskRow interface defined', () => {
      const typesPath = path.join(projectRoot, 'src', 'types.ts');
      const fs = require('fs');
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Check for DatabaseTaskRow interface definition
      expect(content).toContain('DatabaseTaskRow');
      expect(content).toContain('task_id: string');
      expect(content).toContain('status: TaskStatus');
    });

    it('should have proper DatabaseRepoRow interface defined', () => {
      const typesPath = path.join(projectRoot, 'src', 'types.ts');
      const fs = require('fs');
      const content = fs.readFileSync(typesPath, 'utf-8');

      expect(content).toContain('DatabaseRepoRow');
      expect(content).toContain('repo_name: string');
      expect(content).toContain('repo_path: string');
    });

    it('should have DatabaseHandler using typed methods', () => {
      const dbPath = path.join(projectRoot, 'src', 'DatabaseHandler.ts');
      const fs = require('fs');
      const content = fs.readFileSync(dbPath, 'utf-8');

      // Check that mapRowToTask uses proper type
      expect(content).toContain('mapRowToTask(featureSlug: string, repoName: string, row: DatabaseTaskRow)');
      expect(content).toContain('getRepo(repoName: string): Repo | null');
    });
  });

  describe('TS-5: Type Safety - Service Return Types', () => {
    it('should have proper types for database row objects', () => {
      const typesPath = path.join(projectRoot, 'src', 'types.ts');
      const fs = require('fs');
      const content = fs.readFileSync(typesPath, 'utf-8');

      // Check for database-related type definitions
      expect(content).toContain('DatabaseColumnInfo');
      expect(content).toContain('DatabaseRow');
      expect(content).toContain('DatabaseTransitionRow');
      expect(content).toContain('DatabaseCheckpointRow');
    });

    it('should support proper type inference in IDE', () => {
      const dbPath = path.join(projectRoot, 'src', 'DatabaseHandler.ts');
      const fs = require('fs');
      const content = fs.readFileSync(dbPath, 'utf-8');

      // Verify imports include new database types
      expect(content).toContain('DatabaseTaskRow');
      expect(content).toContain('DatabaseRepoRow');
      expect(content).toContain('Repo');
    });
  });
});
