import React from 'react';
import { Task, Feature, AcceptanceCriterion, TestScenario, Clarification, RefinementStep, Attachment } from '../types';
import styles from './DetailPanel.module.css';

const STEP_NAMES: Record<number, string> = {
  1: 'Scope Determination & Initial Snapshot',
  2: 'Attachment Analysis',
  3: 'Clarifications',
  4: 'Acceptance Criteria Generation',
  5: 'Test Scenarios Generation',
  6: 'Task Breakdown and Generation',
  7: 'Stakeholder Review Cycle',
  8: 'Finalization & Checkpoint',
};

const ATTACHMENT_TYPE_LABELS: Record<string, string> = {
  excel: 'Excel',
  image: 'Image',
  document: 'Document',
  design: 'Design',
};

interface DetailPanelProps {
  tasks: Task[];
  feature: Feature | null;
}

const DetailPanel: React.FC<DetailPanelProps> = ({ tasks, feature }) => {
  const clarifications: Clarification[] = feature?.clarifications || [];
  const refinementSteps: RefinementStep[] = feature?.refinementSteps || [];
  const attachments: Attachment[] = feature?.attachments || [];

  // Feature-level acceptance criteria
  const featureAcceptanceCriteria: AcceptanceCriterion[] = feature?.acceptanceCriteria || [];

  // Aggregate all acceptance criteria from tasks
  const taskAcceptanceCriteria: AcceptanceCriterion[] = tasks.flatMap(
    task => task.acceptanceCriteria || []
  );

  // Feature-level test scenarios
  const featureTestScenarios: TestScenario[] = feature?.testScenarios || [];

  // Aggregate all test scenarios from tasks
  const taskTestScenarios: TestScenario[] = tasks.flatMap(
    task => task.testScenarios || []
  );

  // Combine and group AC by priority
  const allAcceptanceCriteria = [...featureAcceptanceCriteria, ...taskAcceptanceCriteria];
  const acByPriority = {
    'Must Have': allAcceptanceCriteria.filter(ac => ac.priority === 'Must Have'),
    'Should Have': allAcceptanceCriteria.filter(ac => ac.priority === 'Should Have'),
    'Could Have': allAcceptanceCriteria.filter(ac => ac.priority === 'Could Have'),
  };

  // Combine and group test scenarios by priority
  const allTestScenarios = [...featureTestScenarios, ...taskTestScenarios];
  const tsByPriority = {
    'P0': allTestScenarios.filter(ts => ts.priority === 'P0'),
    'P1': allTestScenarios.filter(ts => ts.priority === 'P1'),
    'P2': allTestScenarios.filter(ts => ts.priority === 'P2'),
    'P3': allTestScenarios.filter(ts => ts.priority === 'P3'),
  };

  const completedSteps = refinementSteps.filter(s => s.completed).length;

  return (
    <div className={styles.detailPanel} role="region" aria-label="Feature details">
      <div className={styles.detailContent}>
        <h2>Feature Details</h2>

        {/* Feature Description */}
        <section className={styles.section} role="region" aria-label="Feature description">
          <h3 className={styles.sectionTitle}>Description</h3>
          {feature?.description ? (
            <div className={styles.description}>{feature.description}</div>
          ) : (
            <p className={styles.emptyText}>No description provided — add one via the refine-feature workflow</p>
          )}
        </section>

        {/* Feature Intention */}
        {feature?.intention && (
          <section className={styles.section} role="region" aria-label="Feature intention">
            <h3 className={styles.sectionTitle}>Intention</h3>
            <div className={styles.description} style={{ borderLeft: '3px solid var(--vscode-focusBorder, #007acc)', paddingLeft: '0.75rem', fontStyle: 'italic' }}>
              {feature.intention}
            </div>
          </section>
        )}

        {/* Clarifications */}
        <section className={styles.section} role="region" aria-label="Clarifications">
          <h3 className={styles.sectionTitle}>
            Clarifications
            <span className={styles.count}>({clarifications.length})</span>
          </h3>
          {clarifications.length === 0 ? (
            <p className={styles.emptyText}>No clarifications recorded for this feature</p>
          ) : (
            <dl className={styles.clarificationList}>
              {clarifications.map((c) => (
                <div key={c.id} className={styles.clarificationItem}>
                  <dt className={styles.clarificationQuestion}>{c.question}</dt>
                  <dd className={styles.clarificationAnswer}>
                    {c.answer || <span className={styles.unanswered}>Awaiting answer</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/* Refinement Steps */}
        <section className={styles.section} role="region" aria-label="Refinement steps">
          <h3 className={styles.sectionTitle}>
            Refinement Steps
            {refinementSteps.length > 0 && (
              <span className={styles.count}>({completedSteps}/{refinementSteps.length} complete)</span>
            )}
          </h3>
          {refinementSteps.length === 0 ? (
            <p className={styles.emptyText}>No refinement steps tracked yet — run the refine-feature workflow to begin</p>
          ) : (
            <ol className={styles.stepsList}>
              {refinementSteps.map((step) => (
                <li
                  key={step.stepNumber}
                  className={`${styles.stepItem} ${step.completed ? styles.stepCompleted : styles.stepPending}`}
                  role="listitem"
                  aria-label={`Step ${step.stepNumber}: ${STEP_NAMES[step.stepNumber] || step.stepName} - ${step.completed ? 'completed' : 'pending'}`}
                >
                  <span className={styles.stepIcon} aria-hidden="true">
                    {step.completed ? '✓' : '○'}
                  </span>
                  <div className={styles.stepBody}>
                    <span className={styles.stepName}>
                      {step.stepNumber}. {STEP_NAMES[step.stepNumber] || step.stepName}
                    </span>
                    {step.summary && (
                      <p className={styles.stepSummary}>{step.summary}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Attachments */}
        <section className={styles.section} role="region" aria-label="Attachment analyses">
          <h3 className={styles.sectionTitle}>
            Attachments
            <span className={styles.count}>({attachments.length})</span>
          </h3>
          {attachments.length === 0 ? (
            <p className={styles.emptyText}>No attachments analyzed for this feature</p>
          ) : (
            <div className={styles.attachmentsList}>
              {attachments.map((att) => (
                <div key={att.id} className={styles.attachmentItem}>
                  <div className={styles.attachmentHeader}>
                    <span className={styles.attachmentName}>{att.attachmentName}</span>
                    <span className={`${styles.badge} ${styles[`badge_${att.attachmentType}`]}`}>
                      {ATTACHMENT_TYPE_LABELS[att.attachmentType] || att.attachmentType}
                    </span>
                  </div>
                  {att.analysisSummary && (
                    <p className={styles.attachmentSummary}>{att.analysisSummary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Acceptance Criteria */}
        <section className={styles.section} role="region" aria-label="Acceptance criteria">
          <h3 className={styles.sectionTitle}>
            Acceptance Criteria
            <span className={styles.count}>({allAcceptanceCriteria.length})</span>
          </h3>

          {allAcceptanceCriteria.length === 0 ? (
            <p className={styles.emptyText}>No acceptance criteria defined</p>
          ) : (
            <div className={styles.acContainer}>
              {Object.entries(acByPriority).map(([priority, criteria]) => {
                if (criteria.length === 0) return null;
                return (
                  <div key={priority} className={styles.priorityGroup}>
                    <h4 className={styles.priorityTitle}>{priority}</h4>
                    <ul className={styles.criteriaList}>
                      {criteria.map((ac) => (
                        <li key={ac.id} className={styles.criteriaItem}>
                          <input
                            type="checkbox"
                            checked={ac.verified}
                            readOnly
                            className={styles.checkbox}
                          />
                          <span className={ac.verified ? styles.verified : ''}>
                            {ac.criterion}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Test Scenarios */}
        <section className={styles.section} role="region" aria-label="Test scenarios">
          <h3 className={styles.sectionTitle}>
            Test Scenarios
            <span className={styles.count}>({allTestScenarios.length})</span>
          </h3>

          {allTestScenarios.length === 0 ? (
            <p className={styles.emptyText}>No test scenarios defined</p>
          ) : (
            <div className={styles.tsContainer}>
              {Object.entries(tsByPriority).map(([priority, scenarios]) => {
                if (scenarios.length === 0) return null;
                return (
                  <div key={priority} className={styles.priorityGroup}>
                    <h4 className={styles.priorityTitle}>Priority {priority}</h4>
                    <div className={styles.scenariosList}>
                      {scenarios.map((ts) => (
                        <div key={ts.id} className={styles.scenarioItem}>
                          <div className={styles.scenarioHeader}>
                            <span className={styles.scenarioTitle}>{ts.title}</span>
                            {ts.manualOnly && (
                              <span className={styles.badge}>Manual Only</span>
                            )}
                          </div>
                          <p className={styles.scenarioDescription}>
                            {ts.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Task Summary */}
        <section className={styles.section} role="region" aria-label="Task summary">
          <h3 className={styles.sectionTitle}>Task Summary</h3>
          <p>Total Tasks: {tasks.length}</p>
        </section>
      </div>
    </div>
  );
};

export default DetailPanel;
