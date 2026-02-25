export interface Transition {
  from: string;
  to: string;
  approver?: string | null;
  actor?: string | null;
  timestamp: string;
  notes?: string | null;
  additionalData?: Record<string, any> | null;
}

export interface Task {
  taskId: string;
  title: string;
  description: string;
  status: TaskStatus;
  orderOfExecution: number;
  acceptanceCriteria: AcceptanceCriterion[];
  testScenarios: TestScenario[];
  estimatedHours?: number;
  tags?: string[];
  dependencies?: string[];
  outOfScope?: string[];
  stakeholderReviews?: StakeholderReview[];
  transitions?: Transition[];
}

export interface AcceptanceCriterion {
  id: string;
  priority: 'Must Have' | 'Should Have' | 'Could Have';
  criterion: string;
  verified: boolean;
}

export interface TestScenario {
  id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  manualOnly: boolean;
}

export interface StakeholderReview {
  role: StakeholderRole;
  decision: 'approve' | 'reject';
  notes: string;
  timestamp: string;
  additionalFields?: Record<string, any>;
}

export type TaskStatus =
  | 'PendingProductDirector'
  | 'PendingArchitect'
  | 'PendingUiUxExpert'
  | 'PendingSecurityOfficer'
  | 'NeedsRefinement'
  | 'ReadyForDevelopment'
  | 'InProgress'
  | 'InReview'
  | 'InQA'
  | 'NeedsChanges'
  | 'Done';

export type StakeholderRole = 
  | 'productDirector'
  | 'architect'
  | 'uiUxExpert'
  | 'securityOfficer';

export interface Clarification {
  id: number;
  question: string;
  answer?: string;
  askedBy: 'llm' | 'user';
  createdAt: string;
}

export interface RefinementStep {
  stepNumber: number;
  stepName: string;
  completed: boolean;
  completedAt?: string;
  summary?: string;
}

export interface Attachment {
  id: number;
  attachmentName: string;
  attachmentType: 'excel' | 'image' | 'document' | 'design';
  analysisSummary: string;
}

export interface Feature {
  featureSlug: string;
  title: string;
  description?: string;
  /** The higher-level goal or purpose this feature ultimately serves */
  intention?: string;
  repoName: string;
  createdAt: string;
  tasks?: Task[];
  totalTasks?: number;
  acceptanceCriteria?: AcceptanceCriterion[];
  testScenarios?: TestScenario[];
  clarifications?: Clarification[];
  refinementSteps?: RefinementStep[];
  attachments?: Attachment[];
}

export interface Repo {
  repoName: string;
  description?: string;
  features: Feature[];
}

export interface ReviewSummary {
  featureSlug: string;
  featureTitle: string;
  repoName: string;
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasks: Task[];
}
