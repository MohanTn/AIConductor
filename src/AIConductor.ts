/**
 * AIConductor — thin facade that delegates to domain services.
 *
 * This class preserves all public method signatures for backward compatibility.
 * Business logic has been extracted to the service classes in src/services/.
 */
import {
  ReviewInput,
  ReviewResult,
  TaskStatusResult,
  ReviewSummary,
  ValidationResult,
  StakeholderRole,
  PipelineRole,
  TransitionTaskInput,
  TransitionTaskResult,
  GetNextTaskInput,
  GetNextTaskResult,
  GetNextStepInput,
  GetNextStepResult,
  UpdateAcceptanceCriteriaInput,
  UpdateAcceptanceCriteriaResult,
  GetTasksByStatusInput,
  GetTasksByStatusResult,
  VerifyAllTasksCompleteInput,
  VerifyAllTasksCompleteResult,
  CreateFeatureInput,
  CreateFeatureResult,
  UpdateFeatureInput,
  UpdateFeatureResult,
  AddTaskInput,
  AddTaskResult,
  ListFeaturesResult,
  DeleteFeatureResult,
  DeleteRepoResult,
  GetFeatureResult,
  UpdateTaskInput,
  UpdateTaskResult,
  DeleteTaskResult,
  RegisterRepoInput,
  RegisterRepoResult,
  ListReposResult,
  GetCurrentRepoResult,
  UpdateRefinementStepInput,
  UpdateRefinementStepResult,
  AddFeatureAcceptanceCriteriaInput,
  AddFeatureAcceptanceCriteriaResult,
  AddFeatureTestScenariosInput,
  AddFeatureTestScenariosResult,
  AddClarificationInput,
  AddClarificationResult,
  AddAttachmentAnalysisInput,
  AddAttachmentAnalysisResult,
  GetRefinementStatusInput,
  GetRefinementStatusResult,
  GenerateRefinementReportInput,
  GenerateRefinementReportResult,
  GetWorkflowSnapshotResult,
  BatchTransitionTasksInput,
  BatchTransitionTasksResult,
  BatchUpdateAcceptanceCriteriaInput,
  BatchUpdateAcceptanceCriteriaResult,
  SaveWorkflowCheckpointInput,
  SaveWorkflowCheckpointResult,
  ListWorkflowCheckpointsInput,
  ListWorkflowCheckpointsResult,
  RestoreWorkflowCheckpointInput,
  RestoreWorkflowCheckpointResult,
  RollbackLastDecisionInput,
  RollbackLastDecisionResult,
  GetTaskExecutionPlanInput,
  GetTaskExecutionPlanResult,
  GetWorkflowMetricsInput,
  GetWorkflowMetricsResult,
  ValidateReviewCompletenessInput,
  ValidateReviewCompletenessResult,
  GetSimilarTasksInput,
  GetSimilarTasksResult,
} from './types.js';
import { DatabaseHandler } from './DatabaseHandler.js';
import { WorkflowValidator } from './WorkflowValidator.js';
import { RolePromptConfig } from './rolePrompts.js';

// Domain services
import { ReviewService } from './services/ReviewService.js';
import { TransitionService } from './services/TransitionService.js';
import { FeatureService } from './services/FeatureService.js';
import { RefinementService } from './services/RefinementService.js';
import { WorkflowService } from './services/WorkflowService.js';

export class AIConductor {
  private dbHandler: DatabaseHandler;
  private validator: WorkflowValidator;

  // Domain services
  private reviewService: ReviewService;
  private transitionService: TransitionService;
  private featureService: FeatureService;
  private refinementService: RefinementService;
  private workflowService: WorkflowService;

  constructor(workspaceRoot?: string, dbPath?: string) {
    this.dbHandler = new DatabaseHandler(workspaceRoot, dbPath);
    this.validator = new WorkflowValidator();

    this.reviewService     = new ReviewService(this.dbHandler, this.validator);
    this.transitionService = new TransitionService(this.dbHandler, this.validator);
    this.featureService    = new FeatureService(this.dbHandler, this.validator);
    this.refinementService = new RefinementService(this.dbHandler, this.validator);
    this.workflowService   = new WorkflowService(this.dbHandler, this.validator);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Review Service — stakeholder review workflow
  // ─────────────────────────────────────────────────────────────────────

  async addReview(input: ReviewInput): Promise<ReviewResult> {
    return this.reviewService.addReview(input);
  }

  async getTaskStatus(repoName: string, featureSlug: string, taskId: string): Promise<TaskStatusResult> {
    return this.reviewService.getTaskStatus(repoName, featureSlug, taskId);
  }

  async getReviewSummary(repoName: string, featureSlug: string): Promise<ReviewSummary> {
    return this.reviewService.getReviewSummary(repoName, featureSlug);
  }

  async validateWorkflow(
    repoName: string, featureSlug: string, taskId: string, stakeholder: StakeholderRole
  ): Promise<ValidationResult> {
    return this.reviewService.validateWorkflow(repoName, featureSlug, taskId, stakeholder);
  }

  async getNextStep(input: GetNextStepInput): Promise<GetNextStepResult> {
    return this.reviewService.getNextStep(input);
  }

  async validateReviewCompleteness(
    input: ValidateReviewCompletenessInput
  ): Promise<ValidateReviewCompletenessResult> {
    return this.reviewService.validateReviewCompleteness(input);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Transition Service — development pipeline status transitions
  // ─────────────────────────────────────────────────────────────────────

  async transitionTaskStatus(input: TransitionTaskInput): Promise<TransitionTaskResult> {
    return this.transitionService.transitionTaskStatus(input);
  }

  async getNextTask(input: GetNextTaskInput): Promise<GetNextTaskResult> {
    return this.transitionService.getNextTask(input);
  }

  async updateAcceptanceCriteria(
    input: UpdateAcceptanceCriteriaInput
  ): Promise<UpdateAcceptanceCriteriaResult> {
    return this.transitionService.updateAcceptanceCriteria(input);
  }

  async getTasksByStatus(input: GetTasksByStatusInput): Promise<GetTasksByStatusResult> {
    return this.transitionService.getTasksByStatus(input);
  }

  async verifyAllTasksComplete(
    input: VerifyAllTasksCompleteInput
  ): Promise<VerifyAllTasksCompleteResult> {
    return this.transitionService.verifyAllTasksComplete(input);
  }

  async batchTransitionTasks(input: BatchTransitionTasksInput): Promise<BatchTransitionTasksResult> {
    return this.transitionService.batchTransitionTasks(input);
  }

  async batchUpdateAcceptanceCriteria(
    input: BatchUpdateAcceptanceCriteriaInput
  ): Promise<BatchUpdateAcceptanceCriteriaResult> {
    return this.transitionService.batchUpdateAcceptanceCriteria(input);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Feature Service — feature, task, and repo CRUD
  // ─────────────────────────────────────────────────────────────────────

  async createFeature(input: CreateFeatureInput): Promise<CreateFeatureResult> {
    return this.featureService.createFeature(input);
  }

  async updateFeature(input: UpdateFeatureInput): Promise<UpdateFeatureResult> {
    return this.featureService.updateFeature(input);
  }

  async addTask(input: AddTaskInput): Promise<AddTaskResult> {
    return this.featureService.addTask(input);
  }

  async listFeatures(repoName: string): Promise<ListFeaturesResult> {
    return this.featureService.listFeatures(repoName);
  }

  async deleteRepo(repoName: string): Promise<DeleteRepoResult> {
    return this.featureService.deleteRepo(repoName);
  }

  async deleteFeature(repoName: string, featureSlug: string): Promise<DeleteFeatureResult> {
    return this.featureService.deleteFeature(repoName, featureSlug);
  }

  async getFeature(repoName: string, featureSlug: string): Promise<GetFeatureResult> {
    return this.featureService.getFeature(repoName, featureSlug);
  }

  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
    return this.featureService.updateTask(input);
  }

  async deleteTask(repoName: string, featureSlug: string, taskId: string): Promise<DeleteTaskResult> {
    return this.featureService.deleteTask(repoName, featureSlug, taskId);
  }

  async registerRepo(input: RegisterRepoInput): Promise<RegisterRepoResult> {
    return this.featureService.registerRepo(input);
  }

  async listRepos(): Promise<ListReposResult> {
    return this.featureService.listRepos();
  }

  async getCurrentRepo(): Promise<GetCurrentRepoResult> {
    return this.featureService.getCurrentRepo();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Refinement Service — refinement steps and artefacts
  // ─────────────────────────────────────────────────────────────────────

  async updateRefinementStep(
    input: UpdateRefinementStepInput
  ): Promise<UpdateRefinementStepResult> {
    return this.refinementService.updateRefinementStep(input);
  }

  async addFeatureAcceptanceCriteria(
    input: AddFeatureAcceptanceCriteriaInput
  ): Promise<AddFeatureAcceptanceCriteriaResult> {
    return this.refinementService.addFeatureAcceptanceCriteria(input);
  }

  async addFeatureTestScenarios(
    input: AddFeatureTestScenariosInput
  ): Promise<AddFeatureTestScenariosResult> {
    return this.refinementService.addFeatureTestScenarios(input);
  }

  async addClarification(input: AddClarificationInput): Promise<AddClarificationResult> {
    return this.refinementService.addClarification(input);
  }

  async addAttachmentAnalysis(
    input: AddAttachmentAnalysisInput
  ): Promise<AddAttachmentAnalysisResult> {
    return this.refinementService.addAttachmentAnalysis(input);
  }

  async getRefinementStatus(
    input: GetRefinementStatusInput
  ): Promise<GetRefinementStatusResult> {
    return this.refinementService.getRefinementStatus(input);
  }

  async generateRefinementReport(
    input: GenerateRefinementReportInput
  ): Promise<GenerateRefinementReportResult> {
    return this.refinementService.generateRefinementReport(input);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Workflow Service — snapshots, metrics, checkpoints, execution plans
  // ─────────────────────────────────────────────────────────────────────

  async getWorkflowSnapshot(
    repoName: string, featureSlug: string
  ): Promise<GetWorkflowSnapshotResult> {
    return this.workflowService.getWorkflowSnapshot(repoName, featureSlug);
  }

  async saveWorkflowCheckpoint(
    input: SaveWorkflowCheckpointInput
  ): Promise<SaveWorkflowCheckpointResult> {
    return this.workflowService.saveWorkflowCheckpoint(input);
  }

  async listWorkflowCheckpoints(
    input: ListWorkflowCheckpointsInput
  ): Promise<ListWorkflowCheckpointsResult> {
    return this.workflowService.listWorkflowCheckpoints(input);
  }

  async restoreWorkflowCheckpoint(
    input: RestoreWorkflowCheckpointInput
  ): Promise<RestoreWorkflowCheckpointResult> {
    return this.workflowService.restoreWorkflowCheckpoint(input);
  }

  async rollbackLastDecision(
    input: RollbackLastDecisionInput
  ): Promise<RollbackLastDecisionResult> {
    return this.workflowService.rollbackLastDecision(input);
  }

  async getTaskExecutionPlan(
    input: GetTaskExecutionPlanInput
  ): Promise<GetTaskExecutionPlanResult> {
    return this.workflowService.getTaskExecutionPlan(input);
  }

  async getWorkflowMetrics(input: GetWorkflowMetricsInput): Promise<GetWorkflowMetricsResult> {
    return this.workflowService.getWorkflowMetrics(input);
  }

  async getSimilarTasks(input: GetSimilarTasksInput): Promise<GetSimilarTasksResult> {
    return this.workflowService.getSimilarTasks(input);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Queue & Worker Settings (thin pass-throughs — no logic here)
  // ─────────────────────────────────────────────────────────────────────

  getQueueSettings(): { cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript?: string } {
    return this.dbHandler.getQueueSettings();
  }

  updateQueueSettings(updates: Partial<{ cronIntervalSeconds: number; baseReposFolder: string; cliTool: string; workerEnabled: boolean; devWorkflowScript: string }>): void {
    this.dbHandler.updateQueueSettings(updates);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dev Queue Operations (thin pass-throughs)
  // ─────────────────────────────────────────────────────────────────────

  enqueueFeature(repoName: string, featureSlug: string, cliTool: string) {
    return this.dbHandler.enqueueFeature(repoName, featureSlug, cliTool);
  }

  claimNextQueueItem(workerPid: number) {
    return this.dbHandler.claimNextQueueItem(workerPid);
  }

  completeQueueItem(id: number) { this.dbHandler.completeQueueItem(id); }

  failQueueItem(id: number, errorMessage: string) { this.dbHandler.failQueueItem(id, errorMessage); }

  getQueueItems(repoName?: string, featureSlug?: string, status?: string) {
    return this.dbHandler.getQueueItems(repoName, featureSlug, status);
  }

  getQueueStats() { return this.dbHandler.getQueueStats(); }

  pruneQueueItems(olderThanDays?: number) { return this.dbHandler.pruneQueueItems(olderThanDays); }

  getQueueItem(id: number) { return this.dbHandler.getQueueItem(id); }

  reenqueueItem(id: number) { return this.dbHandler.reenqueueItem(id); }

  cancelQueueItem(id: number) { return this.dbHandler.cancelQueueItem(id); }

  // ─────────────────────────────────────────────────────────────────────
  // Role Prompt Settings (thin pass-throughs)
  // ─────────────────────────────────────────────────────────────────────

  getAllRolePrompts(): Array<RolePromptConfig & { roleId: string; isCustom: boolean; updatedAt: string }> {
    return this.dbHandler.getAllRolePrompts();
  }

  getRolePrompt(roleId: PipelineRole): RolePromptConfig {
    return this.dbHandler.getRolePrompt(roleId);
  }

  updateRolePrompt(
    roleId: PipelineRole,
    update: Partial<Pick<RolePromptConfig, 'systemPrompt' | 'focusAreas' | 'researchInstructions' | 'requiredOutputFields'>>
  ): void {
    this.dbHandler.updateRolePrompt(roleId, update);
  }

  resetRolePrompt(roleId: PipelineRole): RolePromptConfig {
    return this.dbHandler.resetRolePrompt(roleId);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Dashboard Route Delegations (public DB access for route handlers)
  // Replaces reviewManager['dbHandler'] string-indexed private access.
  // ─────────────────────────────────────────────────────────────────────

  getAllFeatures(repoName: string): Array<{ featureSlug: string; featureName: string; description: string; intention: string; lastModified: string; totalTasks: number }> {
    return this.dbHandler.getAllFeatures(repoName);
  }

  createFeatureRecord(featureSlug: string, featureName: string, repoName: string): void {
    this.dbHandler.createFeature(featureSlug, featureName, repoName);
  }

  deleteFeatureRecord(featureSlug: string, repoName: string): void {
    this.dbHandler.deleteFeature(featureSlug, repoName);
  }

  getFeatureAcceptanceCriteria(repoName: string, featureSlug: string): any[] {
    return this.dbHandler.getFeatureAcceptanceCriteria(repoName, featureSlug);
  }

  getFeatureTestScenarios(repoName: string, featureSlug: string): any[] {
    return this.dbHandler.getFeatureTestScenarios(repoName, featureSlug);
  }

  getRefinementSteps(repoName: string, featureSlug: string): any[] {
    return this.dbHandler.getRefinementSteps(repoName, featureSlug);
  }

  getClarifications(repoName: string, featureSlug: string): any[] {
    return this.dbHandler.getClarifications(repoName, featureSlug);
  }

  getAttachments(repoName: string, featureSlug: string): any[] {
    return this.dbHandler.getAttachments(repoName, featureSlug);
  }

  getRefinementStatusRecord(repoName: string, featureSlug: string): any {
    return this.dbHandler.getRefinementStatus(repoName, featureSlug);
  }

  async loadByFeatureSlug(featureSlug: string, repoName: string) {
    return this.dbHandler.loadByFeatureSlug(featureSlug, repoName);
  }

  addTaskRecord(featureSlug: string, task: any, repoName: string): string {
    return this.dbHandler.addTask(featureSlug, task, repoName);
  }

  updateRefinementStepRecord(repoName: string, featureSlug: string, stepNumber: number, completed: boolean, summary: string, data?: Record<string, any>): void {
    this.dbHandler.updateRefinementStep(repoName, featureSlug, stepNumber, completed, summary, data);
  }

  addFeatureAcceptanceCriteriaRecord(repoName: string, featureSlug: string, criteria: any[]): number {
    return this.dbHandler.addFeatureAcceptanceCriteria(repoName, featureSlug, criteria);
  }

  addFeatureTestScenariosRecord(repoName: string, featureSlug: string, scenarios: any[]): number {
    return this.dbHandler.addFeatureTestScenarios(repoName, featureSlug, scenarios);
  }

  addClarificationRecord(repoName: string, featureSlug: string, question: string, answer?: string, askedBy?: 'llm' | 'user'): number {
    return this.dbHandler.addClarification(repoName, featureSlug, question, answer, askedBy);
  }

  // analysisSummary is 5th arg (required), then filePath/fileUrl optional — matches DatabaseHandler signature
  addAttachmentAnalysisRecord(repoName: string, featureSlug: string, attachmentName: string, attachmentType: string, analysisSummary: string, filePath?: string, fileUrl?: string, extractedData?: Record<string, any>): number {
    return this.dbHandler.addAttachmentAnalysis(repoName, featureSlug, attachmentName, attachmentType, analysisSummary, filePath, fileUrl, extractedData);
  }
}
