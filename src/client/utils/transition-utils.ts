/**
 * transition-utils.ts
 *
 * Pure (no DOM / no React) helpers for working with task Transition data.
 * Keeping these separate from formatters.ts makes them testable in a Node
 * environment without needing jsdom.
 */

export interface FileChange {
  filePath: string;
  addedLines: number;
  removedLines: number;
}

/**
 * Extract filesChanged from a transition's additionalData.
 * Supports both legacy string arrays and structured FileChange records.
 * Returns array of FileChange objects with file path and line counts.
 */
export function getFilesChanged(
  additionalData: Record<string, unknown> | null | undefined
): FileChange[] {
  if (!additionalData) return [];
  const files = additionalData['filesChanged'];
  if (!Array.isArray(files)) return [];

  return files
    .map((f): FileChange | null => {
      // Handle structured FileChangeRecord with { filePath, addedLines, removedLines }
      if (typeof f === 'object' && f !== null && 'filePath' in f) {
        const record = f as any;
        return {
          filePath: String(record.filePath || ''),
          addedLines: Number(record.addedLines || 0),
          removedLines: Number(record.removedLines || 0),
        };
      }
      // Handle legacy string format (just file path, no line counts)
      if (typeof f === 'string') {
        return {
          filePath: f,
          addedLines: 0,
          removedLines: 0,
        };
      }
      return null;
    })
    .filter((f): f is FileChange => f !== null);
}

/**
 * Format a FileChange record as a display string.
 * Example: "src/api.ts: +45, -12"
 */
export function formatFileChange(file: FileChange): string {
  const additions = file.addedLines > 0 ? `+${file.addedLines}` : '';
  const deletions = file.removedLines > 0 ? `-${file.removedLines}` : '';
  const counts = [additions, deletions].filter(Boolean).join(', ');
  return counts ? `${file.filePath}: ${counts}` : file.filePath;
}

/**
 * Calculate summary statistics for a list of file changes.
 */
export function calculateChangesSummary(files: FileChange[]): { totalFiles: number; totalAdditions: number; totalDeletions: number } {
  return {
    totalFiles: files.length,
    totalAdditions: files.reduce((sum, f) => sum + f.addedLines, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.removedLines, 0),
  };
}
