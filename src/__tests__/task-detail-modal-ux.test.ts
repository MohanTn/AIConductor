/**
 * T05: Tests for badge contrast fix and Files Changed rendering helpers.
 *
 * These tests cover:
 *  1. getBadgeClass() – verifies the correct global CSS class name is returned
 *     for each task status (drives the T01 contrast fix).
 *  2. getFilesChanged() – verifies the exported helper that extracts
 *     filesChanged from transition additionalData (drives the T03 feature).
 */

import { getBadgeClass } from '../client/utils/badge-utils.js';
import { getFilesChanged } from '../client/utils/transition-utils.js';

// ---------------------------------------------------------------------------
// 1. getBadgeClass – badge class mapping
// ---------------------------------------------------------------------------

describe('getBadgeClass', () => {
  it('returns badge-done for Done status', () => {
    expect(getBadgeClass('Done')).toBe('badge-done');
  });

  it('returns badge-active for InProgress', () => {
    expect(getBadgeClass('InProgress')).toBe('badge-active');
  });

  it('returns badge-active for InReview', () => {
    expect(getBadgeClass('InReview')).toBe('badge-active');
  });

  it('returns badge-active for InQA', () => {
    expect(getBadgeClass('InQA')).toBe('badge-active');
  });

  it('returns badge-blocked for NeedsChanges', () => {
    expect(getBadgeClass('NeedsChanges')).toBe('badge-blocked');
  });

  it('returns badge-blocked for NeedsRefinement', () => {
    expect(getBadgeClass('NeedsRefinement')).toBe('badge-blocked');
  });

  it('returns badge-review for any Pending* status', () => {
    expect(getBadgeClass('PendingProductDirector')).toBe('badge-review');
    expect(getBadgeClass('PendingArchitect')).toBe('badge-review');
    expect(getBadgeClass('PendingUiUxExpert')).toBe('badge-review');
    expect(getBadgeClass('PendingSecurityOfficer')).toBe('badge-review');
  });

  it('returns badge-pending for ReadyForDevelopment', () => {
    expect(getBadgeClass('ReadyForDevelopment')).toBe('badge-pending');
  });

  it('returns badge-pending for unknown/empty statuses', () => {
    expect(getBadgeClass('')).toBe('badge-pending');
    expect(getBadgeClass('UnknownStatus')).toBe('badge-pending');
  });
});

// ---------------------------------------------------------------------------
// 2. getFilesChanged – extracting filesChanged from additionalData (T03)
// ---------------------------------------------------------------------------

describe('getFilesChanged', () => {
  it('returns an empty array when additionalData is null', () => {
    expect(getFilesChanged(null)).toEqual([]);
  });

  it('returns an empty array when additionalData is undefined', () => {
    expect(getFilesChanged(undefined)).toEqual([]);
  });

  it('returns an empty array when additionalData has no filesChanged key', () => {
    expect(getFilesChanged({ developerNotes: 'fixed the bug' })).toEqual([]);
  });

  it('returns an empty array when filesChanged is not an array', () => {
    expect(getFilesChanged({ filesChanged: 'src/foo.ts' })).toEqual([]);
    expect(getFilesChanged({ filesChanged: 42 })).toEqual([]);
  });

  it('returns the filesChanged array when present', () => {
    const additionalData = {
      filesChanged: ['src/client/components/TaskDetailModal.tsx', 'src/client/components/TaskDetailModal.module.css'],
      developerNotes: 'fixed contrast',
    };
    expect(getFilesChanged(additionalData)).toEqual([
      { filePath: 'src/client/components/TaskDetailModal.tsx', addedLines: 0, removedLines: 0 },
      { filePath: 'src/client/components/TaskDetailModal.module.css', addedLines: 0, removedLines: 0 },
    ]);
  });

  it('filters out non-string entries in filesChanged array', () => {
    const additionalData = {
      filesChanged: ['src/foo.ts', 42, null, 'src/bar.ts', undefined],
    };
    expect(getFilesChanged(additionalData)).toEqual([
      { filePath: 'src/foo.ts', addedLines: 0, removedLines: 0 },
      { filePath: 'src/bar.ts', addedLines: 0, removedLines: 0 },
    ]);
  });

  it('returns an empty array for an empty filesChanged array', () => {
    expect(getFilesChanged({ filesChanged: [] })).toEqual([]);
  });

  it('preserves realistic file paths with various extensions', () => {
    const files = [
      'src/client/components/TaskDetailModal.tsx',
      'src/client/components/TaskDetailModal.module.css',
      'src/__tests__/task-detail-modal-ux.test.ts',
    ];
    expect(getFilesChanged({ filesChanged: files })).toEqual([
      { filePath: 'src/client/components/TaskDetailModal.tsx', addedLines: 0, removedLines: 0 },
      { filePath: 'src/client/components/TaskDetailModal.module.css', addedLines: 0, removedLines: 0 },
      { filePath: 'src/__tests__/task-detail-modal-ux.test.ts', addedLines: 0, removedLines: 0 },
    ]);
  });
});
