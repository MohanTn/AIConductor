/**
 * RefinementService — tracks feature refinement progress and related artefacts.
 *
 * Covers: updateRefinementStep, addFeatureAcceptanceCriteria,
 *         addFeatureTestScenarios, addClarification, addAttachmentAnalysis,
 *         getRefinementStatus, generateRefinementReport.
 */
import {
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
} from '../types.js';
import { ServiceBase } from './ServiceBase.js';

export class RefinementService extends ServiceBase {

  async updateRefinementStep(input: UpdateRefinementStepInput): Promise<UpdateRefinementStepResult> {
    try {
      this.db.updateRefinementStep(
        input.repoName, input.featureSlug, input.stepNumber,
        input.completed, input.summary, input.data
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        stepNumber: input.stepNumber,
        completed: input.completed,
        message: `Refinement step ${input.stepNumber} updated for feature '${input.featureSlug}' (${input.completed ? 'completed' : 'in progress'})`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        stepNumber: input.stepNumber,
        completed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addFeatureAcceptanceCriteria(
    input: AddFeatureAcceptanceCriteriaInput
  ): Promise<AddFeatureAcceptanceCriteriaResult> {
    try {
      const count = this.db.addFeatureAcceptanceCriteria(
        input.repoName, input.featureSlug, input.criteria
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        criteriaAdded: count,
        message: `Added ${count} acceptance criteria to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        criteriaAdded: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addFeatureTestScenarios(
    input: AddFeatureTestScenariosInput
  ): Promise<AddFeatureTestScenariosResult> {
    try {
      const count = this.db.addFeatureTestScenarios(
        input.repoName, input.featureSlug, input.scenarios
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        scenariosAdded: count,
        message: `Added ${count} test scenarios to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        scenariosAdded: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addClarification(input: AddClarificationInput): Promise<AddClarificationResult> {
    try {
      const clarificationId = this.db.addClarification(
        input.repoName, input.featureSlug,
        input.question, input.answer, input.askedBy
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        clarificationId,
        message: `Clarification added to feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        clarificationId: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async addAttachmentAnalysis(input: AddAttachmentAnalysisInput): Promise<AddAttachmentAnalysisResult> {
    try {
      const attachmentId = this.db.addAttachmentAnalysis(
        input.repoName, input.featureSlug,
        input.attachmentName, input.attachmentType,
        input.analysisSummary, input.filePath, input.fileUrl, input.extractedData
      );
      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        attachmentId,
        message: `Attachment '${input.attachmentName}' analyzed and saved for feature '${input.featureSlug}'`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        attachmentId: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getRefinementStatus(input: GetRefinementStatusInput): Promise<GetRefinementStatusResult> {
    try {
      const status = this.db.getRefinementStatus(input.repoName, input.featureSlug);
      return {
        success: true,
        ...status,
        message: `Refinement status retrieved for feature '${input.featureSlug}' (${status.progressPercentage}% complete)`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        featureName: '',
        currentStep: '',
        progressPercentage: 0,
        completedSteps: 0,
        totalSteps: 0,
        steps: [],
        acceptanceCriteriaCount: 0,
        testScenariosCount: 0,
        clarificationsCount: 0,
        attachmentsCount: 0,
        tasksCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateRefinementReport(
    input: GenerateRefinementReportInput
  ): Promise<GenerateRefinementReportResult> {
    try {
      const status = this.db.getRefinementStatus(input.repoName, input.featureSlug);

      const allSections = ['steps', 'criteria', 'scenarios', 'clarifications', 'attachments'];
      const sectionsToInclude = input.includeSections || allSections;

      let content = '';

      if (input.format === 'markdown') {
        content = `# Feature Refinement Report: ${status.featureName}\n\n`;
        content += `**Feature Slug**: ${input.featureSlug}  \n`;
        content += `**Repository**: ${input.repoName}  \n`;
        content += `**Progress**: ${status.progressPercentage}% (${status.completedSteps}/${status.totalSteps} steps)  \n\n`;
        content += `---\n\n`;

        if (sectionsToInclude.includes('steps')) {
          content += `## Refinement Steps\n\n`;
          for (const step of status.steps) {
            const icon = step.completed ? '✅' : '⏸️';
            content += `### ${icon} Step ${step.stepNumber}: ${step.stepName}\n`;
            if (step.summary) content += `**Summary**: ${step.summary}\n`;
            if (step.completedAt) content += `**Completed**: ${new Date(step.completedAt).toLocaleString()}\n`;
            content += `\n`;
          }
          content += `---\n\n`;
        }

        if (sectionsToInclude.includes('criteria') && status.acceptanceCriteriaCount > 0) {
          content += `## Feature Acceptance Criteria (${status.acceptanceCriteriaCount})\n\n`;
          const criteria = this.db.getFeatureAcceptanceCriteria(input.repoName, input.featureSlug);
          for (const ac of criteria) {
            content += `- **[${ac.criterionId}]** (${ac.priority}) ${ac.criterion}\n`;
          }
          content += `\n---\n\n`;
        }

        if (sectionsToInclude.includes('scenarios') && status.testScenariosCount > 0) {
          content += `## Feature Test Scenarios (${status.testScenariosCount})\n\n`;
          const scenarios = this.db.getFeatureTestScenarios(input.repoName, input.featureSlug);
          for (const ts of scenarios) {
            content += `### ${ts.scenarioId}: ${ts.title} (${ts.priority})\n`;
            content += `${ts.description}\n`;
            if (ts.preconditions) content += `**Preconditions**: ${ts.preconditions}\n`;
            if (ts.expectedResult) content += `**Expected Result**: ${ts.expectedResult}\n`;
            content += `\n`;
          }
          content += `---\n\n`;
        }

        if (sectionsToInclude.includes('clarifications') && status.clarificationsCount > 0) {
          content += `## Clarifications (${status.clarificationsCount})\n\n`;
          const clarifications = this.db.getClarifications(input.repoName, input.featureSlug);
          for (const clarification of clarifications) {
            content += `**Q**: ${clarification.question}\n`;
            content += clarification.answer
              ? `**A**: ${clarification.answer}\n`
              : `**A**: _Pending response_\n`;
            content += `\n`;
          }
          content += `---\n\n`;
        }

        if (sectionsToInclude.includes('attachments') && status.attachmentsCount > 0) {
          content += `## Analyzed Attachments (${status.attachmentsCount})\n\n`;
          const attachments = this.db.getAttachments(input.repoName, input.featureSlug);
          for (const attachment of attachments) {
            content += `### ${attachment.attachmentName} (${attachment.attachmentType})\n`;
            content += `${attachment.analysisSummary}\n`;
            if (attachment.filePath) content += `**File**: ${attachment.filePath}\n`;
            if (attachment.fileUrl) content += `**URL**: ${attachment.fileUrl}\n`;
            content += `\n`;
          }
        }
      } else if (input.format === 'json') {
        content = JSON.stringify(status, null, 2);
      } else {
        // HTML format (basic implementation)
        content = `<html><head><title>Refinement Report: ${status.featureName}</title></head><body>`;
        content += `<h1>Feature Refinement Report: ${status.featureName}</h1>`;
        content += `<p>Progress: ${status.progressPercentage}%</p>`;
        content += `</body></html>`;
      }

      return {
        success: true,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        format: input.format,
        content,
        sectionsIncluded: sectionsToInclude,
        message: `Refinement report generated for feature '${input.featureSlug}' in ${input.format} format`,
      };
    } catch (error) {
      return {
        success: false,
        repoName: input.repoName,
        featureSlug: input.featureSlug,
        format: input.format,
        content: '',
        sectionsIncluded: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
