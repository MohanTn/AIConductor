import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { pdfStyles } from './pdfStyles.js';

export interface PRDClarification {
  question: string;
  answer?: string;
}

export interface PRDAcceptanceCriterion {
  id: string;
  criterion: string;
  priority: 'Must Have' | 'Should Have' | 'Could Have';
  verified?: boolean;
}

export interface PRDTestScenario {
  id: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  type?: string;
}

export interface PRDStakeholderReview {
  role: string;
  decision: 'approved' | 'rejected' | 'pending';
  notes: string;
}

export interface PRDDocumentProps {
  featureName: string;
  description: string;
  intention: string;
  exportDate: string;
  acceptanceCriteria: PRDAcceptanceCriterion[];
  testScenarios: PRDTestScenario[];
  clarifications: PRDClarification[];
  stakeholderReviews: PRDStakeholderReview[];
}

const priorityBadgeStyle = (priority: string) => {
  switch (priority) {
    case 'Must Have': return pdfStyles.badgeMustHave;
    case 'Should Have': return pdfStyles.badgeShouldHave;
    case 'Could Have': return pdfStyles.badgeCouldHave;
    default: return pdfStyles.badgePending;
  }
};

const scenarioPriorityStyle = (priority: string) => {
  switch (priority) {
    case 'P0': return pdfStyles.badgeP0;
    case 'P1': return pdfStyles.badgeP1;
    case 'P2': return pdfStyles.badgeP2;
    case 'P3': return pdfStyles.badgeP3;
    default: return pdfStyles.badgeP2;
  }
};

const decisionBadgeStyle = (decision: string) => {
  switch (decision) {
    case 'approved': return pdfStyles.badgeApproved;
    case 'rejected': return pdfStyles.badgeRejected;
    default: return pdfStyles.badgePending;
  }
};

const truncate = (str: string, max = 10000): string =>
  str.length > max ? str.slice(0, max) + ' … [truncated]' : str;

export const PRDDocument: React.FC<PRDDocumentProps> = ({
  featureName,
  description,
  intention,
  exportDate,
  acceptanceCriteria,
  testScenarios,
  clarifications,
  stakeholderReviews,
}) => {
  const styles = StyleSheet.create({
    acIdCol: { width: '10%' },
    acCriterionCol: { width: '68%' },
    acPriorityCol: { width: '22%' },
    tsIdCol: { width: '10%' },
    tsTitleCol: { width: '55%' },
    tsTypeCol: { width: '15%' },
    tsPriorityCol: { width: '20%' },
  });

  return (
    <Document title={`${featureName} — PRD`} author="AIConductor">
      {/* Cover Page */}
      <Page size="A4" style={pdfStyles.coverPage}>
        <Text style={pdfStyles.coverBadge}>AIConductor</Text>
        <View style={pdfStyles.coverDivider} />
        <Text style={pdfStyles.coverTitle}>{featureName}</Text>
        <Text style={pdfStyles.coverSubtitle}>Product Requirements Document</Text>
        <Text style={pdfStyles.bodyText} break={false}>
          This document describes the requirements, acceptance criteria, and stakeholder
          sign-offs for the {featureName} feature.
        </Text>
        <Text style={pdfStyles.coverMeta}>Generated: {exportDate}</Text>
        <Text style={pdfStyles.coverMeta}>Document type: PRD</Text>
        <Text style={pdfStyles.coverConfidential}>CONFIDENTIAL — For Authorized Recipients Only</Text>
      </Page>

      {/* Main Content */}
      <Page size="A4" style={pdfStyles.page}>

        {/* Feature Overview */}
        <Text style={pdfStyles.sectionTitle}>Feature Overview</Text>
        {description ? (
          <Text style={pdfStyles.bodyText}>{truncate(description)}</Text>
        ) : (
          <Text style={pdfStyles.bodyText}>No description provided.</Text>
        )}

        {/* Intention */}
        {intention && (
          <>
            <Text style={pdfStyles.subSectionTitle}>Intention</Text>
            <Text style={pdfStyles.italicText}>{truncate(intention, 2000)}</Text>
          </>
        )}

        {/* Acceptance Criteria */}
        <Text style={pdfStyles.sectionTitle}>
          Acceptance Criteria ({acceptanceCriteria.length})
        </Text>
        {acceptanceCriteria.length === 0 ? (
          <Text style={pdfStyles.bodyText}>No acceptance criteria defined.</Text>
        ) : (
          <View style={pdfStyles.table}>
            <View style={pdfStyles.tableHeaderRow}>
              <Text style={[pdfStyles.tableHeaderCell, styles.acIdCol]}>ID</Text>
              <Text style={[pdfStyles.tableHeaderCell, styles.acCriterionCol]}>Criterion</Text>
              <Text style={[pdfStyles.tableHeaderCell, styles.acPriorityCol]}>Priority</Text>
            </View>
            {acceptanceCriteria.map((ac, i) => (
              <View key={ac.id} style={i % 2 === 0 ? pdfStyles.tableRow : pdfStyles.tableRowAlt}>
                <Text style={[pdfStyles.tableCell, styles.acIdCol]}>{ac.id}</Text>
                <Text style={[pdfStyles.tableCell, styles.acCriterionCol]}>{truncate(ac.criterion, 500)}</Text>
                <View style={styles.acPriorityCol}>
                  <Text style={priorityBadgeStyle(ac.priority)}>{ac.priority}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Test Scenarios */}
        <Text style={pdfStyles.sectionTitle}>
          Test Scenarios ({testScenarios.length})
        </Text>
        {testScenarios.length === 0 ? (
          <Text style={pdfStyles.bodyText}>No test scenarios defined.</Text>
        ) : (
          <View style={pdfStyles.table}>
            <View style={pdfStyles.tableHeaderRow}>
              <Text style={[pdfStyles.tableHeaderCell, styles.tsIdCol]}>ID</Text>
              <Text style={[pdfStyles.tableHeaderCell, styles.tsTitleCol]}>Title</Text>
              <Text style={[pdfStyles.tableHeaderCell, styles.tsTypeCol]}>Type</Text>
              <Text style={[pdfStyles.tableHeaderCell, styles.tsPriorityCol]}>Priority</Text>
            </View>
            {testScenarios.map((ts, i) => (
              <View key={ts.id} style={i % 2 === 0 ? pdfStyles.tableRow : pdfStyles.tableRowAlt}>
                <Text style={[pdfStyles.tableCell, styles.tsIdCol]}>{ts.id}</Text>
                <Text style={[pdfStyles.tableCell, styles.tsTitleCol]}>{truncate(ts.title, 200)}</Text>
                <Text style={[pdfStyles.tableCellMuted, styles.tsTypeCol]}>{ts.type || '—'}</Text>
                <View style={styles.tsPriorityCol}>
                  <Text style={scenarioPriorityStyle(ts.priority)}>{ts.priority}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Clarifications */}
        <Text style={pdfStyles.sectionTitle}>
          Clarifications ({clarifications.length})
        </Text>
        {clarifications.length === 0 ? (
          <Text style={pdfStyles.bodyText}>No clarifications recorded.</Text>
        ) : (
          clarifications.map((c, i) => (
            <View key={i} style={pdfStyles.qaItem}>
              <Text style={pdfStyles.qaQuestion}>Q: {truncate(c.question, 500)}</Text>
              <Text style={pdfStyles.qaAnswer}>
                A: {c.answer ? truncate(c.answer, 2000) : 'Awaiting answer'}
              </Text>
            </View>
          ))
        )}

        {/* Stakeholder Reviews */}
        <Text style={pdfStyles.sectionTitle}>Stakeholder Reviews</Text>
        <Text style={pdfStyles.bodyText}>
          Reviews listed in chronological order: Product Director → Architect → UI/UX Expert → Security Officer.
        </Text>
        {stakeholderReviews.length === 0 ? (
          <Text style={pdfStyles.bodyText}>No stakeholder reviews recorded.</Text>
        ) : (
          stakeholderReviews.map((review, i) => (
            <View key={i} style={pdfStyles.reviewCard}>
              <View style={pdfStyles.reviewCardHeader}>
                <Text style={pdfStyles.reviewRoleName}>{review.role}</Text>
                <Text style={decisionBadgeStyle(review.decision)}>
                  {review.decision.toUpperCase()}
                </Text>
              </View>
              {review.notes && (
                <Text style={pdfStyles.reviewNotes}>{truncate(review.notes, 2000)}</Text>
              )}
            </View>
          ))
        )}

        {/* Footer */}
        <View style={pdfStyles.footer} fixed>
          <Text style={pdfStyles.footerText}>AIConductor — {featureName} — PRD</Text>
          <Text style={pdfStyles.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>
      </Page>
    </Document>
  );
};
