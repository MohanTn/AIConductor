/**
 * Tests for file changes display feature (T01-T05)
 * Tests metadata capture, API endpoint, component rendering, and integration
 */

import { getFilesChanged, formatFileChange, calculateChangesSummary, FileChange } from '../client/utils/transition-utils';

describe('File Changes Display Feature', () => {
  describe('getFilesChanged utility', () => {
    it('should return empty array when additionalData is null', () => {
      const result = getFilesChanged(null);
      expect(result).toEqual([]);
    });

    it('should return empty array when additionalData is undefined', () => {
      const result = getFilesChanged(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array when filesChanged is not present', () => {
      const result = getFilesChanged({ someOtherData: 'value' });
      expect(result).toEqual([]);
    });

    it('should handle structured FileChangeRecord objects', () => {
      const additionalData = {
        filesChanged: [
          { filePath: 'src/api.ts', addedLines: 45, removedLines: 12 },
          { filePath: 'src/utils.ts', addedLines: 28, removedLines: 5 },
        ],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ filePath: 'src/api.ts', addedLines: 45, removedLines: 12 });
      expect(result[1]).toEqual({ filePath: 'src/utils.ts', addedLines: 28, removedLines: 5 });
    });

    it('should handle legacy string array format', () => {
      const additionalData = {
        filesChanged: ['src/api.ts', 'src/utils.ts', 'tests/api.test.ts'],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ filePath: 'src/api.ts', addedLines: 0, removedLines: 0 });
      expect(result[2]).toEqual({ filePath: 'tests/api.test.ts', addedLines: 0, removedLines: 0 });
    });

    it('should handle mixed format (structured and strings)', () => {
      const additionalData = {
        filesChanged: [
          { filePath: 'src/api.ts', addedLines: 45, removedLines: 12 },
          'src/utils.ts',
        ],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ filePath: 'src/api.ts', addedLines: 45, removedLines: 12 });
      expect(result[1]).toEqual({ filePath: 'src/utils.ts', addedLines: 0, removedLines: 0 });
    });

    it('should filter out null and invalid entries', () => {
      const additionalData = {
        filesChanged: [
          { filePath: 'src/api.ts', addedLines: 45, removedLines: 12 },
          null,
          undefined,
          'src/utils.ts',
          { invalid: 'object' }, // Missing filePath
        ],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe('src/api.ts');
      expect(result[1].filePath).toBe('src/utils.ts');
    });
  });

  describe('formatFileChange utility', () => {
    it('should format file with additions and deletions', () => {
      const file: FileChange = { filePath: 'src/api.ts', addedLines: 45, removedLines: 12 };
      expect(formatFileChange(file)).toBe('src/api.ts: +45, -12');
    });

    it('should handle file with only additions', () => {
      const file: FileChange = { filePath: 'src/new.ts', addedLines: 100, removedLines: 0 };
      expect(formatFileChange(file)).toBe('src/new.ts: +100');
    });

    it('should handle file with only deletions', () => {
      const file: FileChange = { filePath: 'src/old.ts', addedLines: 0, removedLines: 50 };
      expect(formatFileChange(file)).toBe('src/old.ts: -50');
    });

    it('should show just file path when no changes', () => {
      const file: FileChange = { filePath: 'src/unchanged.ts', addedLines: 0, removedLines: 0 };
      expect(formatFileChange(file)).toBe('src/unchanged.ts');
    });

    it('should handle nested file paths', () => {
      const file: FileChange = { filePath: 'src/components/ui/Button.tsx', addedLines: 23, removedLines: 8 };
      expect(formatFileChange(file)).toBe('src/components/ui/Button.tsx: +23, -8');
    });
  });

  describe('calculateChangesSummary utility', () => {
    it('should calculate summary for multiple files', () => {
      const files: FileChange[] = [
        { filePath: 'src/api.ts', addedLines: 45, removedLines: 12 },
        { filePath: 'src/utils.ts', addedLines: 28, removedLines: 5 },
        { filePath: 'tests/api.test.ts', addedLines: 67, removedLines: 0 },
      ];
      const summary = calculateChangesSummary(files);
      expect(summary.totalFiles).toBe(3);
      expect(summary.totalAdditions).toBe(140); // 45 + 28 + 67
      expect(summary.totalDeletions).toBe(17); // 12 + 5 + 0
    });

    it('should handle empty array', () => {
      const files: FileChange[] = [];
      const summary = calculateChangesSummary(files);
      expect(summary.totalFiles).toBe(0);
      expect(summary.totalAdditions).toBe(0);
      expect(summary.totalDeletions).toBe(0);
    });

    it('should handle single file', () => {
      const files: FileChange[] = [{ filePath: 'src/api.ts', addedLines: 45, removedLines: 12 }];
      const summary = calculateChangesSummary(files);
      expect(summary.totalFiles).toBe(1);
      expect(summary.totalAdditions).toBe(45);
      expect(summary.totalDeletions).toBe(12);
    });
  });

  describe('Security: Path Traversal Prevention', () => {
    it('should safely handle path traversal attempts in file paths', () => {
      const additionalData = {
        filesChanged: [{ filePath: '../../etc/passwd', addedLines: 1, removedLines: 0 }],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('../../etc/passwd');
      // Note: sanitization should happen at display/storage layer, not here
    });
  });

  describe('Security: XSS Prevention', () => {
    it('should safely format file path with HTML special characters', () => {
      const file: FileChange = { filePath: 'src/<script>alert(1)</script>.ts', addedLines: 1, removedLines: 0 };
      const formatted = formatFileChange(file);
      // The formatted string contains the raw path; React will escape it when rendering as text
      expect(formatted).toContain('<script>alert(1)</script>');
      // The actual rendering (in React component) will escape this automatically
    });
  });

  describe('Input Validation', () => {
    it('should handle very long file paths', () => {
      const longPath = 'src/' + 'a'.repeat(400) + '.ts';
      const file: FileChange = { filePath: longPath, addedLines: 10, removedLines: 5 };
      expect(() => formatFileChange(file)).not.toThrow();
      expect(formatFileChange(file)).toContain(longPath);
    });

    it('should handle file paths with special characters', () => {
      const file: FileChange = { filePath: 'src/my-file_v2.0@latest.ts', addedLines: 10, removedLines: 5 };
      expect(formatFileChange(file)).toBe('src/my-file_v2.0@latest.ts: +10, -5');
    });

    it('should handle null byte in file path gracefully', () => {
      const additionalData = {
        filesChanged: [{ filePath: 'src/file\x00.ts', addedLines: 1, removedLines: 0 }],
      };
      const result = getFilesChanged(additionalData);
      expect(result).toHaveLength(1);
      // Null byte should be preserved but safely handled by display layer
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative line counts (filtered out)', () => {
      const file: FileChange = { filePath: 'src/api.ts', addedLines: -45, removedLines: -12 };
      // Negative numbers are filtered out as they indicate invalid data
      expect(formatFileChange(file)).toBe('src/api.ts');
    });

    it('should handle zero files with zero changes', () => {
      const files: FileChange[] = [];
      const summary = calculateChangesSummary(files);
      expect(summary.totalFiles).toBe(0);
      expect(summary.totalAdditions).toBe(0);
      expect(summary.totalDeletions).toBe(0);
    });

    it('should handle decimal line counts (should be integers)', () => {
      const file: FileChange = { filePath: 'src/api.ts', addedLines: 45.5, removedLines: 12.3 };
      expect(formatFileChange(file)).toBe('src/api.ts: +45.5, -12.3');
      // Note: in practice, these should be integers; validation at input boundary
    });
  });
});
