import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { pdfStyles } from './pdfStyles.js';

// Discriminated union for diagram field rendering
type SvgDiagram = { type: 'svg'; svg: string; caption: string };
type MermaidSourceDiagram = { type: 'mermaid'; source: string; caption: string };
type PendingDiagram = { type: 'pending'; caption: string };
export type DiagramField = SvgDiagram | MermaidSourceDiagram | PendingDiagram;

export interface ArchArtefact {
  title: string;
  content: string;
  type: 'diagram' | 'api_contract' | 'data_model';
}

export interface ArchitectureDocumentProps {
  featureName: string;
  description: string;
  intention: string;
  exportDate: string;
  technologyRecommendations: string[];
  designPatterns: string[];
  flowDiagram: DiagramField;
  sequentialCallsDiagram: DiagramField;
  apiContracts: string;
  authDetails: string;
  securityRequirements: string[];
  complianceNotes: string;
  architectNotes: string;
  supplementaryArtefacts?: ArchArtefact[];
}

const truncate = (str: string, max = 10000): string =>
  str.length > max ? str.slice(0, max) + ' … [truncated]' : str;

const DiagramSection: React.FC<{ diagram: DiagramField }> = ({ diagram }) => {
  if (diagram.type === 'svg') {
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(diagram.svg).toString('base64')}`;
    return (
      <View style={pdfStyles.diagramContainer}>
        <Image src={dataUri} style={{ maxWidth: '100%', maxHeight: 300 }} />
        <Text style={pdfStyles.diagramCaption}>{diagram.caption}</Text>
      </View>
    );
  }

  if (diagram.type === 'mermaid') {
    return (
      <View>
        <Text style={pdfStyles.codeLabel}>{diagram.caption} (Mermaid source)</Text>
        <View style={pdfStyles.codeBlock}>
          <Text style={pdfStyles.codeText}>{truncate(diagram.source, 3000)}</Text>
        </View>
      </View>
    );
  }

  // Pending
  return (
    <View style={pdfStyles.pendingBox}>
      <Text style={pdfStyles.pendingText}>Pending Architect Review — {diagram.caption}</Text>
    </View>
  );
};

export const ArchitectureDocument: React.FC<ArchitectureDocumentProps> = ({
  featureName,
  description,
  intention,
  exportDate,
  technologyRecommendations,
  designPatterns,
  flowDiagram,
  sequentialCallsDiagram,
  apiContracts,
  authDetails,
  securityRequirements,
  complianceNotes,
  architectNotes,
  supplementaryArtefacts = [],
}) => {
  const styles = StyleSheet.create({
    summaryBox: {
      backgroundColor: '#f0f9ff',
      borderWidth: 1,
      borderColor: '#bae6fd',
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
    },
  });

  return (
    <Document title={`${featureName} — Architecture`} author="AIConductor">
      {/* Cover Page */}
      <Page size="A4" style={pdfStyles.coverPage}>
        <Text style={pdfStyles.coverBadge}>AIConductor</Text>
        <View style={pdfStyles.coverDivider} />
        <Text style={pdfStyles.coverTitle}>{featureName}</Text>
        <Text style={pdfStyles.coverSubtitle}>Architecture Document</Text>
        <Text style={pdfStyles.bodyText} break={false}>
          This document describes the system architecture, technology choices, flow diagrams,
          API contracts, and security model for the {featureName} feature.
        </Text>
        <Text style={pdfStyles.coverMeta}>Generated: {exportDate}</Text>
        <Text style={pdfStyles.coverMeta}>Document type: Architecture</Text>
        <Text style={pdfStyles.coverConfidential}>CONFIDENTIAL — For Authorized Recipients Only</Text>
      </Page>

      {/* Main Content */}
      <Page size="A4" style={pdfStyles.page}>

        {/* Document Summary */}
        <Text style={pdfStyles.sectionTitle}>Document Summary</Text>
        <View style={styles.summaryBox}>
          <Text style={pdfStyles.bodyText}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Feature: </Text>
            {featureName}
          </Text>
          {intention && (
            <Text style={pdfStyles.bodyText}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Goal: </Text>
              {truncate(intention, 500)}
            </Text>
          )}
          {technologyRecommendations.length > 0 && (
            <Text style={pdfStyles.bodyText}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Key technologies: </Text>
              {technologyRecommendations.slice(0, 3).join(', ')}
              {technologyRecommendations.length > 3 ? ` +${technologyRecommendations.length - 3} more` : ''}
            </Text>
          )}
          {securityRequirements.length > 0 && (
            <Text style={pdfStyles.bodyText}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Security controls: </Text>
              {securityRequirements.length} requirements defined
            </Text>
          )}
        </View>

        {/* System Overview */}
        <Text style={pdfStyles.sectionTitle}>System Overview</Text>
        {description ? (
          <Text style={pdfStyles.bodyText}>{truncate(description)}</Text>
        ) : (
          <Text style={pdfStyles.bodyText}>No description provided.</Text>
        )}
        {intention && (
          <Text style={pdfStyles.italicText}>{truncate(intention, 2000)}</Text>
        )}

        {/* Architect Notes */}
        {architectNotes && (
          <>
            <Text style={pdfStyles.subSectionTitle}>Architect Notes</Text>
            <Text style={pdfStyles.bodyText}>{truncate(architectNotes)}</Text>
          </>
        )}

        {/* Technology Stack */}
        <Text style={pdfStyles.sectionTitle}>Technology Stack</Text>
        {technologyRecommendations.length === 0 ? (
          <View style={pdfStyles.pendingBox}>
            <Text style={pdfStyles.pendingText}>Pending Architect Review</Text>
          </View>
        ) : (
          technologyRecommendations.map((rec, i) => (
            <View key={i} style={pdfStyles.bulletItem}>
              <Text style={pdfStyles.bullet}>•</Text>
              <Text style={pdfStyles.bulletText}>{truncate(rec, 500)}</Text>
            </View>
          ))
        )}

        {/* Design Patterns */}
        <Text style={pdfStyles.sectionTitle}>Design Patterns</Text>
        {designPatterns.length === 0 ? (
          <View style={pdfStyles.pendingBox}>
            <Text style={pdfStyles.pendingText}>Pending Architect Review</Text>
          </View>
        ) : (
          designPatterns.map((pattern, i) => (
            <View key={i} style={pdfStyles.bulletItem}>
              <Text style={pdfStyles.bullet}>•</Text>
              <Text style={pdfStyles.bulletText}>{truncate(pattern, 500)}</Text>
            </View>
          ))
        )}

        {/* Flow Diagram */}
        <Text style={pdfStyles.sectionTitle}>Flow Diagram</Text>
        <DiagramSection diagram={flowDiagram} />

        {/* Sequential Calls Diagram */}
        <Text style={pdfStyles.sectionTitle}>Sequential Calls Diagram</Text>
        <DiagramSection diagram={sequentialCallsDiagram} />

        {/* API Contracts */}
        <Text style={pdfStyles.sectionTitle}>API Contracts</Text>
        <Text style={pdfStyles.bodyText}>
          This section lists all API endpoints introduced or modified by this feature.
        </Text>
        {apiContracts ? (
          <View style={pdfStyles.codeBlock}>
            <Text style={pdfStyles.codeText}>{truncate(apiContracts)}</Text>
          </View>
        ) : (
          <View style={pdfStyles.pendingBox}>
            <Text style={pdfStyles.pendingText}>Pending Architect Review</Text>
          </View>
        )}

        {/* Auth & Authorization */}
        <Text style={pdfStyles.sectionTitle}>Auth & Authorization</Text>
        <View style={pdfStyles.securityNotice}>
          <Text style={pdfStyles.securityNoticeText}>
            ⚠ This section describes authentication mechanisms only. It must not contain
            actual credentials. Recipients are responsible for handling this document securely.
          </Text>
        </View>
        {authDetails ? (
          <Text style={pdfStyles.bodyText}>{truncate(authDetails)}</Text>
        ) : (
          <View style={pdfStyles.pendingBox}>
            <Text style={pdfStyles.pendingText}>Pending Architect Review</Text>
          </View>
        )}

        {/* Security Requirements */}
        <Text style={pdfStyles.sectionTitle}>Security Requirements</Text>
        {securityRequirements.length === 0 ? (
          <View style={pdfStyles.pendingBox}>
            <Text style={pdfStyles.pendingText}>Pending Security Officer Review</Text>
          </View>
        ) : (
          securityRequirements.map((req, i) => (
            <View key={i} style={pdfStyles.bulletItem}>
              <Text style={pdfStyles.bullet}>•</Text>
              <Text style={pdfStyles.bulletText}>{truncate(req, 1000)}</Text>
            </View>
          ))
        )}

        {/* Compliance Notes */}
        {complianceNotes && (
          <>
            <Text style={pdfStyles.sectionTitle}>Compliance Notes</Text>
            <Text style={pdfStyles.bodyText}>{truncate(complianceNotes)}</Text>
          </>
        )}

        {/* Supplementary Artefacts */}
        {supplementaryArtefacts.length > 0 && (
          <>
            <Text style={pdfStyles.sectionTitle}>
              Supplementary Artefacts ({supplementaryArtefacts.length})
            </Text>
            {supplementaryArtefacts.map((artefact, i) => (
              <View key={i} style={pdfStyles.qaItem}>
                <Text style={pdfStyles.qaQuestion}>{artefact.title}</Text>
                <View style={pdfStyles.codeBlock}>
                  <Text style={pdfStyles.codeText}>{truncate(artefact.content, 10000)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Footer */}
        <View style={pdfStyles.footer} fixed>
          <Text style={pdfStyles.footerText}>AIConductor — {featureName} — Architecture</Text>
          <Text style={pdfStyles.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>
      </Page>
    </Document>
  );
};
