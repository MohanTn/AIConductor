/**
 * Type definitions for AIConductor MCP server
 */

export type TaskStatus =
  | 'PendingProductDirector'
  | 'PendingArchitect'
  | 'PendingUiUxExpert'
  | 'PendingSecurityOfficer'
  | 'ReadyForDevelopment'
  | 'NeedsRefinement'
  | 'ToDo'
  | 'InProgress'
  | 'InReview'
  | 'InQA'
  | 'NeedsChanges'
  | 'Done';

export type StakeholderRole = 'productDirector' | 'architect' | 'uiUxExpert' | 'securityOfficer';

export type ActorType = StakeholderRole | 'system' | 'developer' | 'codeReviewer' | 'qa';

export type ReviewDecision = 'approve' | 'reject';

export type PipelineRole =
  | 'productDirector'
  | 'architect'
  | 'uiUxExpert'
  | 'securityOfficer'
  | 'developer'
  | 'codeReviewer'
  | 'qa';

export interface FileChangeRecord {
  filePath: string;
  addedLines: number;
  removedLines: number;
}

export type PipelinePhase = 'review' | 'execution';

export interface Transition {
  from: TaskStatus;
  to: TaskStatus;
  approver?: StakeholderRole;
  actor?: ActorType;
  timestamp: string;
  notes?: string;
  // Product Director
  productDirectorNotes?: string;
  marketAnalysis?: string;
  competitorAnalysis?: string;
  requiredChanges?: string;
  // Architect
  architectNotes?: string;
  technologyRecommendations?: string;
  designPatterns?: string;
  technicalConcerns?: string;
  // UI/UX Expert
  uiUxNotes?: string;
  usabilityFindings?: string;
  accessibilityRequirements?: string;
  userBehaviorInsights?: string;
  // Security Officer
  securityOfficerNotes?: string;
  securityRequirements?: string;
  complianceGuidelines?: string;
  securityConcerns?: string;
  mandatoryControls?: string;
  // Developer
  developerNotes?: string;
  filesChanged?: string[] | FileChangeRecord[]; // Support both array of strings (legacy) and structured records
  testFiles?: string[];
  docsUpdated?: string[]; // Documentation files that were updated
  documentationNotes?: string; // Explanation of what docs were updated and why, or why no updates were needed
  // Code Reviewer
  codeReviewerNotes?: string;
  testResultsSummary?: string;
  codeQualityConcerns?: string;
  // QA
  qaNotes?: string;
  bugsFound?: string;
  deploymentReadiness?: string;
  acceptanceCriteriaMet?: boolean;
  testExecutionSummary?: string;
}

export interface AcceptanceCriterion {
  id: string;
  criterion: string;
  priority: 'Must Have' | 'Should Have' | 'Could Have';
  verified: boolean;
}

export interface TestScenario {
  id: string;
  title: string;
  description: string;
  manualOnly: boolean;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface StakeholderReview {
  productDirector?: {
    approved: boolean;
    notes: string;
    marketAnalysis?: string;
    competitorAnalysis?: string;
  };
  architect?: {
    approved: boolean;
    notes: string;
    technologyRecommendations?: string[];
    designPatterns?: string[];
  };
  uiUxExpert?: {
    approved: boolean;
    notes: string;
    usabilityFindings?: string;
    accessibilityRequirements?: string[];
    userBehaviorInsights?: string;
  };
  securityOfficer?: {
    approved: boolean;
    notes: string;
    securityRequirements?: string[];
    complianceNotes?: string;
  };
}

export interface Task {
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  testScenarios?: TestScenario[];
  outOfScope?: string[];
  estimatedHours?: number;
  status: TaskStatus;
  assignedTo?: string;
  dependencies: string[];
  transitions: Transition[];
  stakeholderReview: StakeholderReview;
  order?: number;
  orderOfExecution: number;
  tags?: string[];
  /** Optimistic concurrency version. Incremented on every write. */
  version?: number;
}

export interface TaskFile {
  featureSlug: string;
  featureName: string;
  createdAt: string;
  lastModified: string;
  tasks: Task[];
}

export interface ReviewInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  stakeholder: StakeholderRole;
  decision: ReviewDecision;
  notes: string;
  additionalFields?: {
    // Product Director
    marketAnalysis?: string;
    competitorAnalysis?: string;
    // Architect
    technologyRecommendations?: string[];
    designPatterns?: string[];
    // UI/UX Expert
    usabilityFindings?: string;
    accessibilityRequirements?: string[];
    userBehaviorInsights?: string;
    // Security Officer
    securityRequirements?: string[];
    complianceNotes?: string;
  };
}

export interface ReviewResult {
  success: boolean;
  taskId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  transition: Transition;
  message?: string;
  error?: string;
}

export interface TaskStatusResult {
  taskId: string;
  status: TaskStatus;
  currentStakeholder: StakeholderRole | null;
  completedReviews: StakeholderRole[];
  pendingReviews: StakeholderRole[];
  canTransitionTo: TaskStatus[];
  orderOfExecution: number;
}

export interface ReviewSummary {
  featureSlug: string;
  featureName: string;
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  completionPercentage: number;
  stakeholderProgress: {
    productDirector: { completed: number; pending: number };
    architect: { completed: number; pending: number };
    uiUxExpert: { completed: number; pending: number };
    securityOfficer: { completed: number; pending: number };
  };
  tasks: Array<{
    taskId: string;
    title: string;
    status: TaskStatus;
    estimatedHours?: number;
    orderOfExecution: number;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  currentStatus: TaskStatus;
  expectedStakeholder: StakeholderRole | null;
  allowedTransitions: TaskStatus[];
}

export interface WorkflowRule {
  expectedStakeholder: StakeholderRole;
  onApprove: TaskStatus;
  onReject: TaskStatus;
  allowedPreviousStatuses: TaskStatus[];
}

export const WORKFLOW_RULES: Record<TaskStatus, WorkflowRule | null> = {
  PendingProductDirector: {
    expectedStakeholder: 'productDirector',
    onApprove: 'PendingArchitect',
    onReject: 'NeedsRefinement',
    allowedPreviousStatuses: ['PendingProductDirector', 'NeedsRefinement'],
  },
  PendingArchitect: {
    expectedStakeholder: 'architect',
    onApprove: 'PendingUiUxExpert',
    onReject: 'NeedsRefinement',
    allowedPreviousStatuses: ['PendingProductDirector'],
  },
  PendingUiUxExpert: {
    expectedStakeholder: 'uiUxExpert',
    onApprove: 'PendingSecurityOfficer',
    onReject: 'NeedsRefinement',
    allowedPreviousStatuses: ['PendingArchitect'],
  },
  PendingSecurityOfficer: {
    expectedStakeholder: 'securityOfficer',
    onApprove: 'ReadyForDevelopment',
    onReject: 'NeedsRefinement',
    allowedPreviousStatuses: ['PendingUiUxExpert'],
  },
  ReadyForDevelopment: null,
  NeedsRefinement: null,
  ToDo: null,
  InProgress: null,
  InReview: null,
  InQA: null,
  NeedsChanges: null,
  Done: null,
};

// Development workflow transition rules
export interface DevWorkflowRule {
  allowedActors: ActorType[];
  allowedTransitions: TaskStatus[];
}

export const DEV_WORKFLOW_RULES: Record<TaskStatus, DevWorkflowRule> = {
  PendingProductDirector: { allowedActors: ['productDirector', 'system'], allowedTransitions: ['PendingArchitect', 'NeedsRefinement'] },
  PendingArchitect: { allowedActors: ['architect', 'system'], allowedTransitions: ['PendingUiUxExpert', 'NeedsRefinement'] },
  PendingUiUxExpert: { allowedActors: ['uiUxExpert', 'system'], allowedTransitions: ['PendingSecurityOfficer', 'NeedsRefinement'] },
  PendingSecurityOfficer: { allowedActors: ['securityOfficer', 'system'], allowedTransitions: ['ReadyForDevelopment', 'NeedsRefinement'] },
  ReadyForDevelopment: { allowedActors: ['system'], allowedTransitions: ['ToDo'] },
  NeedsRefinement: { allowedActors: ['system'], allowedTransitions: ['PendingProductDirector'] },
  ToDo: { allowedActors: ['system', 'developer'], allowedTransitions: ['InProgress'] },
  InProgress: { allowedActors: ['developer'], allowedTransitions: ['InReview'] },
  InReview: { allowedActors: ['codeReviewer'], allowedTransitions: ['InQA', 'NeedsChanges'] },
  InQA: { allowedActors: ['qa'], allowedTransitions: ['Done', 'NeedsChanges'] },
  NeedsChanges: { allowedActors: ['developer'], allowedTransitions: ['InProgress'] },
  Done: { allowedActors: [], allowedTransitions: [] },
};

// Tool input/output interfaces

export interface TransitionTaskInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  actor: ActorType;
  notes?: string;
  metadata?: Partial<Transition>;
}

export interface TransitionTaskResult {
  success: boolean;
  taskId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  transition: Transition;
  message?: string;
  error?: string;
}

export interface GetNextTaskInput {
  repoName: string;
  featureSlug: string;
  statusFilter: TaskStatus[];
}

export interface GetNextTaskResult {
  success: boolean;
  task?: Task;
  message?: string;
  error?: string;
}

export interface GetNextStepInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
}

export interface GetNextStepResult {
  success: boolean;
  taskId: string;
  currentStatus: TaskStatus;
  phase: PipelinePhase;
  nextRole: PipelineRole;
  systemPrompt: string;
  allowedDecisions: string[];
  transitionOnSuccess: TaskStatus;
  transitionOnFailure: TaskStatus;
  focusAreas: string[];
  researchInstructions: string;
  requiredOutputFields: string[];
  previousRoleNotes: Record<string, string>;
  message?: string;
  error?: string;
}

export interface UpdateAcceptanceCriteriaInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  criterionId: string;
  verified: boolean;
}

export interface UpdateAcceptanceCriteriaResult {
  success: boolean;
  taskId: string;
  criterionId: string;
  verified: boolean;
  message?: string;
  error?: string;
}

export interface GetTasksByStatusInput {
  repoName: string;
  featureSlug: string;
  status: TaskStatus;
}

export interface GetTasksByStatusResult {
  success: boolean;
  tasks: Task[];
  count: number;
  message?: string;
  error?: string;
}

export interface VerifyAllTasksCompleteInput {
  repoName: string;
  featureSlug: string;
}

export interface VerifyAllTasksCompleteResult {
  success: boolean;
  allComplete: boolean;
  totalTasks: number;
  completedTasks: number;
  incompleteTasks: Array<{
    taskId: string;
    title: string;
    status: TaskStatus;
  }>;
  message?: string;
  error?: string;
}

// Feature & Task creation types

export interface CreateFeatureInput {
  repoName: string;
  featureSlug: string;
  featureName: string;
  description?: string;
}

export interface CreateFeatureResult {
  success: boolean;
  featureSlug: string;
  message?: string;
  error?: string;
}

export interface UpdateFeatureInput {
  repoName: string;
  featureSlug: string;
  featureName?: string;
  description?: string;
}

export interface UpdateFeatureResult {
  success: boolean;
  featureSlug: string;
  message?: string;
  error?: string;
}

export interface AddTaskInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  title: string;
  description: string;
  orderOfExecution: number;
  acceptanceCriteria?: AcceptanceCriterion[];
  testScenarios?: TestScenario[];
  outOfScope?: string[];
  estimatedHours?: number;
  dependencies?: string[];
  tags?: string[];
}

export interface AddTaskResult {
  success: boolean;
  featureSlug: string;
  taskId: string;
  message?: string;
  error?: string;
}

export interface ListFeaturesResult {
  success: boolean;
  features: Array<{
    featureSlug: string;
    featureName: string;
    lastModified: string;
    totalTasks: number;
  }>;
  message?: string;
  error?: string;
}

export interface DeleteFeatureResult {
  success: boolean;
  featureSlug: string;
  message?: string;
  error?: string;
}

export interface DeleteRepoResult {
  success: boolean;
  repoName: string;
  featureCount?: number;
  taskCount?: number;
  message?: string;
  error?: string;
}

export interface GetFeatureResult {
  success: boolean;
  feature?: TaskFile;
  message?: string;
  error?: string;
}

// Update and Delete Task types

export interface UpdateTaskInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  updates: {
    title?: string;
    description?: string;
    orderOfExecution?: number;
    acceptanceCriteria?: AcceptanceCriterion[];
    testScenarios?: TestScenario[];
    outOfScope?: string[];
    estimatedHours?: number;
    dependencies?: string[];
    tags?: string[];
    // Note: status updates should go through transition_task_status tool
  };
}

export interface UpdateTaskResult {
  success: boolean;
  featureSlug: string;
  taskId: string;
  message?: string;
  error?: string;
}

export interface DeleteTaskInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
}

export interface DeleteTaskResult {
  success: boolean;
  featureSlug: string;
  taskId: string;
  message?: string;
  error?: string;
}

// ============================================================================
// Multi-Repo Support Types
// ============================================================================

export interface Repo {
  repoName: string;
  repoPath: string;
  repoUrl?: string | null;
  defaultBranch: string;
  createdAt: string;
  lastAccessedAt: string;
  metadata?: Record<string, any> | null;
}

export interface RegisterRepoInput {
  repoName: string;
  repoPath: string;
  repoUrl?: string;
  defaultBranch?: string;
  metadata?: Record<string, any>;
}

export interface RegisterRepoResult {
  success: boolean;
  repoName: string;
  message?: string;
  error?: string;
}

export interface ListReposResult {
  success: boolean;
  repos: Array<{
    repoName: string;
    repoPath: string;
    featureCount: number;
    totalTasks: number;
    completedTasks: number;
    lastAccessedAt: string;
  }>;
  message?: string;
  error?: string;
}

export interface GetCurrentRepoResult {
  success: boolean;
  repoName?: string;
  repoPath?: string;
  registered: boolean;
  message?: string;
  error?: string;
}

// ============================================================================
// Refinement Step Types
// ============================================================================

export interface RefinementStep {
  stepNumber: number;
  stepName: string;
  completed: boolean;
  completedAt?: string;
  summary?: string;
  data?: Record<string, any>;
}

export interface UpdateRefinementStepInput {
  repoName: string;
  featureSlug: string;
  stepNumber: number;
  completed: boolean;
  summary: string;
  data?: Record<string, any>;
}

export interface UpdateRefinementStepResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  stepNumber: number;
  completed: boolean;
  message?: string;
  error?: string;
}

// ============================================================================
// Feature-Level Acceptance Criteria Types
// ============================================================================

export interface FeatureAcceptanceCriterion {
  criterionId: string;
  criterion: string;
  priority: 'Must Have' | 'Should Have' | 'Could Have';
  source: 'user' | 'generated' | 'attachment';
  createdAt: string;
}

export interface AddFeatureAcceptanceCriteriaInput {
  repoName: string;
  featureSlug: string;
  criteria: Array<{
    criterionId: string;
    criterion: string;
    priority: 'Must Have' | 'Should Have' | 'Could Have';
    source?: 'user' | 'generated' | 'attachment';
  }>;
}

export interface AddFeatureAcceptanceCriteriaResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  criteriaAdded: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Feature-Level Test Scenario Types
// ============================================================================

export interface FeatureTestScenario {
  scenarioId: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  type: 'automated' | 'manual' | 'both';
  preconditions?: string;
  expectedResult?: string;
  createdAt: string;
}

export interface AddFeatureTestScenariosInput {
  repoName: string;
  featureSlug: string;
  scenarios: Array<{
    scenarioId: string;
    title: string;
    description: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    type?: 'automated' | 'manual' | 'both';
    preconditions?: string;
    expectedResult?: string;
  }>;
}

export interface AddFeatureTestScenariosResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  scenariosAdded: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Clarification Types
// ============================================================================

export interface Clarification {
  id: number;
  question: string;
  answer?: string;
  askedAt: string;
  answeredAt?: string;
  askedBy: 'llm' | 'user';
}

export interface AddClarificationInput {
  repoName: string;
  featureSlug: string;
  question: string;
  answer?: string;
  askedBy?: 'llm' | 'user';
}

export interface AddClarificationResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  clarificationId: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Attachment Analysis Types
// ============================================================================

export interface FeatureAttachment {
  id: number;
  attachmentName: string;
  attachmentType: 'excel' | 'image' | 'document' | 'design';
  filePath?: string;
  fileUrl?: string;
  analysisSummary: string;
  extractedData?: Record<string, any>;
  analyzedAt: string;
}

export interface AddAttachmentAnalysisInput {
  repoName: string;
  featureSlug: string;
  attachmentName: string;
  attachmentType: 'excel' | 'image' | 'document' | 'design';
  filePath?: string;
  fileUrl?: string;
  analysisSummary: string;
  extractedData?: Record<string, any>;
}

export interface AddAttachmentAnalysisResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  attachmentId: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Refinement Status Types
// ============================================================================

export interface GetRefinementStatusInput {
  repoName: string;
  featureSlug: string;
}

export interface GetRefinementStatusResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  featureName: string;
  currentStep: string;
  progressPercentage: number;
  completedSteps: number;
  totalSteps: number;
  steps: RefinementStep[];
  acceptanceCriteriaCount: number;
  testScenariosCount: number;
  clarificationsCount: number;
  attachmentsCount: number;
  tasksCount: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Report Generation Types
// ============================================================================

export interface GenerateRefinementReportInput {
  repoName: string;
  featureSlug: string;
  format: 'markdown' | 'html' | 'json';
  outputPath?: string;
  includeSections?: string[];
}

export interface GenerateRefinementReportResult {
  success: boolean;
  repoName: string;
  featureSlug: string;
  format: string;
  content: string;
  sectionsIncluded: string[];
  filePath?: string;
  message?: string;
  error?: string;
}

// ============================================================================
// Update existing types to include repoName
// ============================================================================

// Update ReviewInput to include repoName
export interface ReviewInputWithRepo extends ReviewInput {
  repoName: string;
}

// Update all input types that need repoName
export interface CreateFeatureInputWithRepo extends CreateFeatureInput {
  repoName: string;
  jiraTicketKey?: string;
}

export interface AddTaskInputWithRepo extends AddTaskInput {
  repoName: string;
}

export interface TransitionTaskInputWithRepo extends TransitionTaskInput {
  repoName: string;
}

export interface GetNextTaskInputWithRepo extends GetNextTaskInput {
  repoName: string;
}

export interface GetNextStepInputWithRepo extends GetNextStepInput {
  repoName: string;
}

export interface UpdateAcceptanceCriteriaInputWithRepo extends UpdateAcceptanceCriteriaInput {
  repoName: string;
}

export interface GetTasksByStatusInputWithRepo extends GetTasksByStatusInput {
  repoName: string;
}

export interface VerifyAllTasksCompleteInputWithRepo extends VerifyAllTasksCompleteInput {
  repoName: string;
}

export interface UpdateTaskInputWithRepo extends UpdateTaskInput {
  repoName: string;
}

export interface DeleteTaskInputWithRepo extends DeleteTaskInput {
  repoName: string;
}

// ============================================================================
// Workflow Snapshot Tool Types (Recommendation 1: Context Compression)
// ============================================================================

export interface GetWorkflowSnapshotInput {
  repoName: string;
  featureSlug: string;
}

export interface WorkflowTaskSnapshot {
  taskId: string;
  title: string;
  status: TaskStatus;
  orderOfExecution: number;
  currentRole?: string;
  lastDecision?: string;
}

export interface WorkflowBlockage {
  taskId: string;
  status: TaskStatus;
  reason: string;
  waitingSince?: string;
}

export interface GetWorkflowSnapshotResult {
  success: boolean;
  feature: {
    slug: string;
    name: string;
    totalTasks: number;
    progress: string;
  };
  summary: string;
  taskSnapshot: WorkflowTaskSnapshot[];
  blockages: WorkflowBlockage[];
  recommendations: string[];
  message?: string;
  error?: string;
}

// ============================================================================
// Batch Task Mutation Tool Types (Recommendation 2: Batch Mutations)
// ============================================================================

export interface BatchTransitionTasksInput {
  repoName: string;
  featureSlug: string;
  taskIds: string[];
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  actor: ActorType;
  notes?: string;
  metadata?: Partial<Transition>;
}

export interface BatchTransitionResult {
  taskId: string;
  success: boolean;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  error?: string;
}

export interface BatchTransitionTasksResult {
  success: boolean;
  results: BatchTransitionResult[];
  successCount: number;
  failureCount: number;
  message?: string;
  error?: string;
}

export interface BatchCriteriaUpdate {
  taskId: string;
  criterionId: string;
  verified: boolean;
}

export interface BatchUpdateAcceptanceCriteriaInput {
  repoName: string;
  featureSlug: string;
  updates: BatchCriteriaUpdate[];
}

export interface BatchCriteriaUpdateResult {
  taskId: string;
  criterionId: string;
  verified: boolean;
  success: boolean;
  error?: string;
}

export interface BatchUpdateAcceptanceCriteriaResult {
  success: boolean;
  results: BatchCriteriaUpdateResult[];
  successCount: number;
  failureCount: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Recommendation 3: Workflow Checkpoints & Rollback
// ============================================================================

export interface CheckpointTaskSnapshot {
  taskId: string;
  status: TaskStatus;
}

export interface WorkflowCheckpoint {
  id: number;
  repoName: string;
  featureSlug: string;
  description: string;
  savedAt: string;
  snapshot: CheckpointTaskSnapshot[];
}

export interface SaveWorkflowCheckpointInput {
  repoName: string;
  featureSlug: string;
  description: string;
}

export interface SaveWorkflowCheckpointResult {
  success: boolean;
  checkpointId?: number;
  savedAt?: string;
  taskCount?: number;
  message?: string;
  error?: string;
}

export interface ListWorkflowCheckpointsInput {
  repoName: string;
  featureSlug: string;
}

export interface ListWorkflowCheckpointsResult {
  success: boolean;
  checkpoints: WorkflowCheckpoint[];
  message?: string;
  error?: string;
}

export interface RestoreWorkflowCheckpointInput {
  repoName: string;
  featureSlug: string;
  checkpointId: number;
}

export interface RestoreWorkflowCheckpointResult {
  success: boolean;
  checkpointId?: number;
  restoredTasks?: number;
  message?: string;
  error?: string;
}

export interface RollbackLastDecisionInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
}

export interface RollbackLastDecisionResult {
  success: boolean;
  taskId?: string;
  rolledBackFrom?: TaskStatus;
  rolledBackTo?: TaskStatus;
  message?: string;
  error?: string;
}

// ============================================================================
// Recommendation 4: Smart Task Dependency & Ordering
// ============================================================================

export interface GetTaskExecutionPlanInput {
  repoName: string;
  featureSlug: string;
}

export interface GetTaskExecutionPlanResult {
  success: boolean;
  optimalOrder: string[];
  parallelizable: Record<string, string[]>;
  criticalPath: string[];
  warnings: string[];
  totalDeps?: number;
  hasCircularDeps?: boolean;
  message?: string;
  error?: string;
}

// ============================================================================
// Recommendation 5: Quality Metrics & Workflow Health
// ============================================================================

export interface WorkflowAlert {
  level: 'error' | 'warning' | 'info';
  msg: string;
}

export interface GetWorkflowMetricsInput {
  repoName: string;
  featureSlug: string;
}

export interface GetWorkflowMetricsResult {
  success: boolean;
  healthScore: number;
  totalTasks?: number;
  completedTasks?: number;
  avgTimeByPhase?: Record<string, string>;
  rejectionRate?: Record<string, number>;
  reworkCycles?: number;
  longestWaitingTask?: { taskId: string; status: TaskStatus; duration: string };
  alerts: WorkflowAlert[];
  message?: string;
  error?: string;
}

// ============================================================================
// Recommendation 7: Role-Specific Review Completeness Validation
// ============================================================================

export interface ValidateReviewCompletenessInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  stakeholder: StakeholderRole;
}

export interface ValidateReviewCompletenessResult {
  success: boolean;
  isComplete: boolean;
  missingFields: string[];
  warnings: string[];
  message?: string;
  error?: string;
}

// ============================================================================
// Database Row Types (T02: Type Safety Improvement)
// ============================================================================

/**
 * SQLite table column information from pragma table_info
 */
export interface DatabaseColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: 0 | 1;
}

/**
 * Generic database row interface
 */
export interface DatabaseRow {
  [key: string]: any;
}

/**
 * Task row as stored in database
 * Note: Database stores JSON-serialized strings for complex fields (out_of_scope, dependencies, tags)
 */
export interface DatabaseTaskRow extends DatabaseRow {
  task_id: string;
  feature_slug: string;
  repo_name: string;
  title: string;
  description: string;
  status: TaskStatus;
  order_of_execution: number;
  assigned_to?: string;
  out_of_scope?: string; // JSON-serialized array
  estimated_hours?: number;
  dependencies?: string; // JSON-serialized array
  tags?: string; // JSON-serialized array
  version?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Feature row as stored in database
 */
export interface DatabaseFeatureRow extends DatabaseRow {
  feature_slug: string;
  repo_name: string;
  feature_name: string;
  description: string | null;
  created_at: string;
  last_modified: string;
  version: number;
}

/**
 * Repository row as stored in database
 */
export interface DatabaseRepoRow extends DatabaseRow {
  repo_name: string;
  repo_path: string;
  repo_url: string | null;
  default_branch: string;
  created_at: string;
  last_accessed_at: string;
  metadata: string | null;
}

/**
 * Transition row as stored in database
 */
export interface DatabaseTransitionRow extends DatabaseRow {
  id: number;
  task_id: string;
  feature_slug: string;
  repo_name: string;
  from_status: TaskStatus;
  to_status: TaskStatus;
  actor: ActorType | null;
  notes: string | null;
  additional_data: string | null;
  timestamp: string;
}

/**
 * Checkpoint row as stored in database
 */
export interface DatabaseCheckpointRow extends DatabaseRow {
  id: number;
  repo_name: string;
  feature_slug: string;
  description: string;
  saved_at: string;
  snapshot_json: string;
}

// ============================================================================
// Recommendation 8: Similar Task Reference
// ============================================================================

export interface SimilarTask {
  featureSlug: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  similarity: number;
  sharedTags?: string[];
}

export interface GetSimilarTasksInput {
  repoName: string;
  featureSlug: string;
  taskId: string;
  limit?: number;
}

export interface GetSimilarTasksResult {
  success: boolean;
  referenceTask?: { taskId: string; title: string; tags?: string[] };
  similarTasks: SimilarTask[];
  message?: string;
  error?: string;
}
