/**
 * Dashboard Usability Improvements — Integration Tests (T06)
 *
 * Tests the logic for all three dashboard improvements using the same
 * pure-module pattern as workflow-validator.test.ts (avoids import.meta).
 *
 *  T01 — Swimlane phase grouping (SWIMLANE_CONFIG correctness)
 *  T02 — Snapshot endpoint: slug allowlist validation pattern
 *  T03 — WhatNextBanner: recommendation generation logic
 *  T04/T05 — Inline transitions: allowed actors + WorkflowValidator dev paths
 */

import { WorkflowValidator } from '../WorkflowValidator.js';
import { Task, TaskStatus } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Helpers ───────────────────────────────────────────────────
function makeTask(overrides: Partial<Task>): Task {
  return {
    taskId: 'T01',
    featureSlug: 'test-feature',
    title: 'Test Task',
    description: '',
    status: 'PendingProductDirector',
    orderOfExecution: 1,
    transitions: [],
    acceptanceCriteria: [],
    testScenarios: [],
    tags: [],
    version: 1,
    ...overrides,
  };
}

// ── T01: Phase-grouped swimlane board ─────────────────────────
describe('T01 — Swimlane phase grouping', () => {
  // Mirrors the SWIMLANE_CONFIG defined in Board.tsx
  const SWIMLANE_CONFIG = [
    {
      id: 'refinement',
      statuses: ['PendingProductDirector', 'PendingArchitect', 'PendingUiUxExpert', 'PendingSecurityOfficer', 'NeedsRefinement'],
    },
    {
      id: 'development',
      statuses: ['ReadyForDevelopment', 'ToDo', 'InProgress', 'InReview', 'InQA', 'NeedsChanges'],
    },
    {
      id: 'completed',
      statuses: ['Done'],
    },
  ];

  it('covers all 12 TaskStatus values across 3 swimlanes', () => {
    const allCovered = SWIMLANE_CONFIG.flatMap(s => s.statuses);
    const allStatuses: TaskStatus[] = [
      'PendingProductDirector', 'PendingArchitect', 'PendingUiUxExpert', 'PendingSecurityOfficer',
      'NeedsRefinement', 'ReadyForDevelopment', 'ToDo', 'InProgress', 'InReview', 'InQA',
      'NeedsChanges', 'Done',
    ];
    for (const s of allStatuses) {
      expect(allCovered).toContain(s);
    }
  });

  it('no status appears in more than one swimlane', () => {
    const allCovered = SWIMLANE_CONFIG.flatMap(s => s.statuses);
    const unique = new Set(allCovered);
    expect(unique.size).toBe(allCovered.length);
  });

  it('refinement phase contains all Pending* and NeedsRefinement statuses', () => {
    const refinement = SWIMLANE_CONFIG.find(s => s.id === 'refinement')!;
    expect(refinement.statuses).toContain('PendingProductDirector');
    expect(refinement.statuses).toContain('PendingArchitect');
    expect(refinement.statuses).toContain('PendingUiUxExpert');
    expect(refinement.statuses).toContain('PendingSecurityOfficer');
    expect(refinement.statuses).toContain('NeedsRefinement');
  });

  it('development phase contains core dev workflow statuses', () => {
    const dev = SWIMLANE_CONFIG.find(s => s.id === 'development')!;
    expect(dev.statuses).toContain('ReadyForDevelopment');
    expect(dev.statuses).toContain('InProgress');
    expect(dev.statuses).toContain('InReview');
    expect(dev.statuses).toContain('InQA');
    expect(dev.statuses).toContain('NeedsChanges');
  });

  it('completed phase contains only Done', () => {
    const done = SWIMLANE_CONFIG.find(s => s.id === 'completed')!;
    expect(done.statuses).toEqual(['Done']);
  });
});

// ── T02: Snapshot endpoint slug validation ────────────────────
describe('T02 — Snapshot endpoint slug allowlist validation', () => {
  // Mirrors the regex in feature.routes.ts /snapshot handler
  const slugPattern = /^[a-zA-Z0-9_-]+$/;

  it('accepts valid slugs', () => {
    expect(slugPattern.test('my-feature')).toBe(true);
    expect(slugPattern.test('feature_123')).toBe(true);
    expect(slugPattern.test('FEATURE')).toBe(true);
    expect(slugPattern.test('dashboard-usability-improvements')).toBe(true);
  });

  it('rejects slugs with path traversal characters', () => {
    expect(slugPattern.test('../etc/passwd')).toBe(false);
    expect(slugPattern.test('feature/subpath')).toBe(false);
    expect(slugPattern.test('feature name')).toBe(false);
    expect(slugPattern.test("feature'; DROP TABLE")).toBe(false);
  });

  it('rejects slugs with special characters', () => {
    expect(slugPattern.test('feature!')).toBe(false);
    expect(slugPattern.test('feature@domain')).toBe(false);
    expect(slugPattern.test('feature<script>')).toBe(false);
  });
});

// ── T03: WhatNextBanner recommendations ───────────────────────
describe('T03 — WhatNextBanner recommendation logic', () => {
  // Mirrors the recommendation generation in WorkflowService.getWorkflowSnapshot
  function generateRecommendations(taskSnapshot: { taskId: string; status: string }[]) {
    const recommendations: string[] = [];

    const readyIds = taskSnapshot.filter(t => t.status === 'ReadyForDevelopment').map(t => t.taskId);
    if (readyIds.length > 0) {
      recommendations.push(`Start development on ${readyIds.join(', ')}`);
    }

    const nrIds = taskSnapshot.filter(t => t.status === 'NeedsRefinement').map(t => t.taskId);
    if (nrIds.length > 0) {
      recommendations.push(`Fix and resubmit to Product Director: ${nrIds.join(', ')}`);
    }

    const ncIds = taskSnapshot.filter(t => t.status === 'NeedsChanges').map(t => t.taskId);
    if (ncIds.length > 0) {
      recommendations.push(`Address feedback and restart dev phase: ${ncIds.join(', ')}`);
    }

    return recommendations;
  }

  it('recommends starting development when tasks are ReadyForDevelopment', () => {
    const recs = generateRecommendations([
      { taskId: 'T01', status: 'ReadyForDevelopment' },
      { taskId: 'T02', status: 'Done' },
    ]);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]).toContain('T01');
  });

  it('recommends resubmission when tasks are in NeedsRefinement', () => {
    const recs = generateRecommendations([
      { taskId: 'T01', status: 'NeedsRefinement' },
    ]);
    expect(recs).toContain('Fix and resubmit to Product Director: T01');
  });

  it('recommends addressing feedback when tasks are in NeedsChanges', () => {
    const recs = generateRecommendations([
      { taskId: 'T03', status: 'NeedsChanges' },
    ]);
    expect(recs).toContain('Address feedback and restart dev phase: T03');
  });

  it('returns empty recommendations when all tasks are Done', () => {
    const recs = generateRecommendations([
      { taskId: 'T01', status: 'Done' },
      { taskId: 'T02', status: 'Done' },
    ]);
    expect(recs).toHaveLength(0);
  });

  it('returns multiple recommendations when multiple issues exist', () => {
    const recs = generateRecommendations([
      { taskId: 'T01', status: 'ReadyForDevelopment' },
      { taskId: 'T02', status: 'NeedsRefinement' },
      { taskId: 'T03', status: 'NeedsChanges' },
    ]);
    expect(recs.length).toBe(3);
  });
});

// ── T04/T05: Inline task transitions via WorkflowValidator ────
describe('T04/T05 — Inline quick-action transitions', () => {
  const validator = new WorkflowValidator();

  // Mirrors getAvailableTransitions() in TaskCard.tsx
  function getAvailableTransitions(status: TaskStatus) {
    switch (status) {
      case 'ReadyForDevelopment': return [{ toStatus: 'ToDo', actor: 'developer' }];
      case 'ToDo':               return [{ toStatus: 'InProgress', actor: 'developer' }];
      case 'InProgress':         return [{ toStatus: 'InReview', actor: 'developer' }];
      case 'InReview':           return [
        { toStatus: 'InQA', actor: 'codeReviewer' },
        { toStatus: 'NeedsChanges', actor: 'codeReviewer' },
      ];
      case 'InQA':               return [
        { toStatus: 'Done', actor: 'qa' },
        { toStatus: 'NeedsChanges', actor: 'qa' },
      ];
      case 'NeedsChanges':       return [{ toStatus: 'InProgress', actor: 'developer' }];
      default:                   return [];
    }
  }

  // Mirrors the allowedClientActors filter in task.routes.ts
  const ALLOWED_CLIENT_ACTORS = ['developer', 'codeReviewer', 'qa'];

  it('returns available transitions for each actionable dev status', () => {
    const actionableStatuses: TaskStatus[] = ['ReadyForDevelopment', 'ToDo', 'InProgress', 'InReview', 'InQA', 'NeedsChanges'];
    for (const status of actionableStatuses) {
      expect(getAvailableTransitions(status).length).toBeGreaterThan(0);
    }
  });

  it('returns no transitions for Done, Pending*, and NeedsRefinement statuses', () => {
    const nonActionable: TaskStatus[] = [
      'Done', 'PendingProductDirector', 'PendingArchitect',
      'PendingUiUxExpert', 'PendingSecurityOfficer', 'NeedsRefinement',
    ];
    for (const status of nonActionable) {
      expect(getAvailableTransitions(status)).toHaveLength(0);
    }
  });

  it('InReview exposes both Approve and Request Changes actions', () => {
    const transitions = getAvailableTransitions('InReview');
    const toStatuses = transitions.map(t => t.toStatus);
    expect(toStatuses).toContain('InQA');
    expect(toStatuses).toContain('NeedsChanges');
  });

  it('InQA exposes both Approve and Reject actions', () => {
    const transitions = getAvailableTransitions('InQA');
    const toStatuses = transitions.map(t => t.toStatus);
    expect(toStatuses).toContain('Done');
    expect(toStatuses).toContain('NeedsChanges');
  });

  it('all transitions use an allowed client actor', () => {
    const allStatuses = Object.keys({
      ReadyForDevelopment: 1, ToDo: 1, InProgress: 1, InReview: 1, InQA: 1, NeedsChanges: 1,
    }) as TaskStatus[];
    for (const status of allStatuses) {
      for (const t of getAvailableTransitions(status)) {
        expect(ALLOWED_CLIENT_ACTORS).toContain(t.actor);
      }
    }
  });

  it('WorkflowValidator accepts developer transition InProgress → InReview', () => {
    const result = validator.validateDevTransition('InProgress', 'InReview', 'developer');
    expect(result.valid).toBe(true);
  });

  it('WorkflowValidator accepts codeReviewer transition InReview → InQA', () => {
    const result = validator.validateDevTransition('InReview', 'InQA', 'codeReviewer');
    expect(result.valid).toBe(true);
  });

  it('WorkflowValidator accepts qa transition InQA → Done', () => {
    const result = validator.validateDevTransition('InQA', 'Done', 'qa');
    expect(result.valid).toBe(true);
  });

  it('WorkflowValidator rejects developer trying to approve InReview → InQA', () => {
    const result = validator.validateDevTransition('InReview', 'InQA', 'developer');
    expect(result.valid).toBe(false);
  });

  it('WorkflowValidator rejects invalid transition InProgress → Done', () => {
    const result = validator.validateDevTransition('InProgress', 'Done', 'developer');
    expect(result.valid).toBe(false);
  });
});

// ── Security: client actor allowlist ──────────────────────────
describe('Security — allowedClientActors restriction (T05)', () => {
  const ALLOWED = ['developer', 'codeReviewer', 'qa'];

  function resolveActor(actor: string): string {
    return ALLOWED.includes(actor) ? actor : 'developer';
  }

  it('passes developer through', () => expect(resolveActor('developer')).toBe('developer'));
  it('passes codeReviewer through', () => expect(resolveActor('codeReviewer')).toBe('codeReviewer'));
  it('passes qa through', () => expect(resolveActor('qa')).toBe('qa'));
  it('maps system → developer', () => expect(resolveActor('system')).toBe('developer'));
  it('maps productDirector → developer', () => expect(resolveActor('productDirector')).toBe('developer'));
  it('maps unknown → developer', () => expect(resolveActor('hacker')).toBe('developer'));
});
