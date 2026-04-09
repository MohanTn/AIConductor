---
name: refine-feature
description: Feature refinement workflow — captures intention, clarifications, AC, test scenarios, task breakdown, and drives 4-role stakeholder review cycle to ReadyForDevelopment.
---

# refine-feature — Compact State-Machine Reference

## HARD CONSTRAINTS
- Valid statuses ONLY: `PendingProductDirector → PendingArchitect → PendingUiUxExpert → PendingSecurityOfficer → ReadyForDevelopment`
- Rejection: any → `NeedsRefinement` → fix via `update_task` → `transition_task_status` back to `PendingProductDirector`
- **If no intention provided: STOP and ask** — "What bigger goal does this feature serve?"
- Do NOT store PII, credentials, or API keys in any field.

## Step 1 — Snapshot & Intention
1. `get_workflow_context(repoName, featureSlug)` — check prior work; if tasks exist past `PendingProductDirector`, skip to Step 6.
2. Capture intention: "We are building X *so that* Y." Store via `add_clarification(question, answer, askedBy: "llm")`.

## Step 2 — Clarifications (Ask ALL Upfront — Optimization 1.1)
**Ask all clarifications in ONE batch upfront, not 3-5 per batch with sequential waits.**

Collect: target users, success metrics, tech integrations, security/compliance, edge cases.
Store each: `add_clarification(question, userAnswer, askedBy: "llm")`.

**Why batch upfront?** Sequential batching (ask 2-3, wait → ask 2-3 more, wait) creates 2-3 blocking cycles = 30-45 min wasted. Batching upfront lets users answer in parallel = faster time-to-clarity.

## Step 3 — Feature-Level AC & Test Scenarios
- `add_feature_acceptance_criteria` — 5–8 SMART criteria; first 1–2 must verify the intention directly.
- `add_feature_test_scenarios` — 1:1+ mapping to AC; first scenario = end-to-end intention validation (P0).

## Step 4 — Task Breakdown & Validation
- `create_feature(featureSlug, featureName, description, intention, repoName)` — pass both `description` AND `intention`.
- `add_task` per task — `status: PendingProductDirector`; start description with `[Layer: Backend|API|Frontend|…]`.
- Layer coverage required: Database, Backend, API, Frontend, Integration, Navigation (skip with explicit justification only).
- `get_task_execution_plan` — review order and parallelizable phases.
- `get_refinement_status` — **block if** clarifications, acceptanceCriteria, or testScenarios are empty.

## Step 4.5 — Smart Refinement Inheritance (Optimization 1.6)
**When adding new tasks to a feature that's already been through stakeholder review:**

1. **Check Prior Approvals** — Does feature have tasks in ReadyForDevelopment or beyond?
2. **Analyze New Task Concerns** — Does the new task introduce new stakeholder concerns?
   - Product concerns? (market positioning, business value, user segment changes)
   - Architecture concerns? (new patterns, tech changes, complexity)
   - UX concerns? (user workflows, accessibility, interface changes)
   - Security concerns? (compliance, data handling, threat model changes)
3. **Apply Smart Inheritance:**
   - **No new concerns** → Inherit all prior approvals → Move new task directly to ReadyForDevelopment (system transition)
   - **New concerns detected** → Trigger targeted review ONLY for affected roles (not full 4-role cycle)

**Example:** Adding task T05 (automated research) to feature with T01-T04 ReadyForDevelopment:
- Analysis: No new Product/Architecture/UX/Security concerns (backend infrastructure only)
- Action: Inherit approvals from T01-T04
- Result: T05 moves directly to ReadyForDevelopment without re-review
- Time saved: 40 minutes (89% reduction)

**Why?** Eliminates redundant re-review of already-approved feature intent while maintaining quality gates for new concerns.

---

## Step 5 — Stakeholder Review Cycle (batched by role)
**`get_next_step` ONCE per batch → research once → `submit_role_batch_review` all tasks in one call.**

| Role | `stakeholder` | Required `additionalFields` |
|------|---------------|-----------------------------|
| Product Director | `productDirector` | `marketAnalysis` (str), `competitorAnalysis` (str), `quickSummary` (str) |
| Architect | `architect` | `technologyRecommendations` (str[]), `designPatterns` (str[]) |
| UI/UX Expert | `uiUxExpert` | `usabilityFindings` (str), `accessibilityRequirements` (str[]), `userBehaviorInsights` (str) |
| Security Officer | `securityOfficer` | `securityRequirements` (str[]), `complianceNotes` (str) |

**Per-role flow:**
1. `get_next_step(repoName, featureSlug, anyPendingTaskId)` — get systemPrompt for role (call once).
2. Research once for entire batch.
3. `submit_role_batch_review(repoName, featureSlug, stakeholder, reviews[{taskId, decision, notes, additionalFields}])`.
4. Approved → auto-transitions to next role. Rejected → `NeedsRefinement`.

**Rejected tasks:** `update_task` to address feedback → `transition_task_status` to `PendingProductDirector` → re-run cycle.

## Step 6 — Finalization
1. `get_tasks_by_status(ReadyForDevelopment)` — confirm all tasks present.
2. `save_workflow_checkpoint` — description: "All tasks ReadyForDevelopment - ready for dev workflow".
3. `update_feature(description, intention)` — persist final versions if refined during workflow.
4. Present: Intention Statement, AC count, test scenario count, task list with IDs.
