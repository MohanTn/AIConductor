import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { pdfStyles } from './pdfStyles';

interface CompetitiveAnalysisDocumentProps {
  featureSlug: string;
  competitiveMatrix?: {
    metadata: any;
    competitors: { [key: string]: any };
    summary: any;
  };
  gapAnalysis: {
    gaps: Array<{ title: string; description: string; evidence: string; opportunity: string }>;
    summary: string;
  };
  positioning: {
    statement: string;
    targetSegments: string[];
    advantages: Array<{ title: string; description: string }>;
    roadmap: Array<{ phase: string; items: string[] }>;
  };
}

const styles = StyleSheet.create({
  ...pdfStyles,
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
  },
  coverPage: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
  },
  coverTitle: {
    fontSize: 44,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  coverSubtitle: {
    fontSize: 24,
    marginBottom: 40,
    textAlign: 'center',
    color: '#666',
  },
  coverDate: {
    fontSize: 12,
    textAlign: 'center',
    color: '#999',
    marginTop: 60,
  },
  toc: {
    marginVertical: 20,
  },
  tocItem: {
    marginVertical: 8,
    fontSize: 12,
  },
  tocItemTitle: {
    fontWeight: 'bold',
    color: '#2563eb',
  },
  tocItemPage: {
    marginLeft: 'auto',
    color: '#999',
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    marginTop: 20,
    color: '#1a1a1a',
    borderBottom: '2pt solid #2563eb',
    paddingBottom: 10,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 15,
    color: '#333',
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.6,
    marginBottom: 10,
    color: '#333',
  },
  tableHeaderCell: {
    backgroundColor: '#f3f4f6',
    fontWeight: 'bold',
    padding: 8,
    fontSize: 10,
    borderRight: '1pt solid #d1d5db',
  },
  tableCell: {
    padding: 6,
    fontSize: 9,
    borderRight: '1pt solid #e5e7eb',
  },
  gapCard: {
    marginBottom: 15,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderLeft: '4pt solid #2563eb',
  },
  gapTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#1a1a1a',
  },
  gapText: {
    fontSize: 10,
    marginBottom: 5,
    lineHeight: 1.5,
    color: '#555',
  },
  advantageBox: {
    marginBottom: 15,
    padding: 12,
    backgroundColor: '#ecfdf5',
    borderLeft: '4pt solid #10b981',
  },
  advantageTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#065f46',
  },
  roadmapPhase: {
    marginBottom: 15,
    paddingBottom: 10,
    borderBottom: '1pt solid #e5e7eb',
  },
  roadmapPhaseTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#2563eb',
  },
  roadmapItem: {
    fontSize: 10,
    marginLeft: 15,
    marginBottom: 5,
    color: '#555',
  },
  pageNumber: {
    position: 'absolute',
    bottom: 20,
    right: 30,
    fontSize: 10,
    color: '#999',
  },
});

export const CompetitiveAnalysisDocument: React.FC<CompetitiveAnalysisDocumentProps> = ({
  featureSlug,
  gapAnalysis,
  positioning,
}) => (
  <Document title={`Competitive Analysis - ${featureSlug}`}>
    {/* Cover Page */}
    <Page size="A4" style={[styles.page, styles.coverPage]}>
      <Text style={styles.coverTitle}>Competitive Analysis Report</Text>
      <Text style={styles.coverSubtitle}>AI-Assisted Development Workflow Systems</Text>
      <Text style={styles.paragraph}>Feature: {featureSlug}</Text>
      <Text style={styles.coverDate}>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
    </Page>

    {/* Table of Contents */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>Table of Contents</Text>
      <View style={styles.toc}>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>1. Executive Summary</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>2. Competitive Matrix</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>3. Market Gaps & Opportunities</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>4. Positioning Statement</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>5. Competitive Advantages</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>6. Product Roadmap</Text></Text>
        </View>
        <View style={styles.tocItem}>
          <Text><Text style={styles.tocItemTitle}>7. Appendix: Research Methodology</Text></Text>
        </View>
      </View>
    </Page>

    {/* Executive Summary */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>1. Executive Summary</Text>
      <Text style={styles.paragraph}>
        This report analyzes 12+ competitors across 5 categories of AI-assisted development platforms: AI coding assistants, workflow orchestration, MCP servers, task management with AI, and LLM operations frameworks.
      </Text>
      <Text style={styles.subsectionTitle}>Key Findings</Text>
      <Text style={styles.paragraph}>
        • <Text style={{ fontWeight: 'bold' }}>No competitor combines multi-stakeholder workflows with real-time collaboration</Text> — GitHub Copilot dominates coding but lacks team governance; Temporal excels at reliability but ignores human decisions; Linear handles tasks but has no AI refinement.
      </Text>
      <Text style={styles.paragraph}>
        • <Text style={{ fontWeight: 'bold' }}>Real-time dashboard is table stakes</Text> — None of our competitors offer WebSocket-powered live updates for team workflows.
      </Text>
      <Text style={styles.paragraph}>
        • <Text style={{ fontWeight: 'bold' }}>MCP protocol creates new market opportunity</Text> — As Anthropic's MCP becomes industry standard, existing tools cannot retroactively add MCP-native orchestration.
      </Text>
      <Text style={styles.paragraph}>
        • <Text style={{ fontWeight: 'bold' }}>Estimated TAM: $1B+</Text> — Combining task management ($3-5B), workflow orchestration ($15B+), and AI-assisted dev tools ($20B+).
      </Text>
    </Page>

    {/* Competitive Matrix Overview */}
    <Page size="A4" orientation="landscape" style={styles.page}>
      <Text style={styles.sectionTitle}>2. Competitive Matrix</Text>
      <Text style={styles.paragraph}>
        8-dimension analysis across 12 competitors: Features, Architecture, Adoption, Compliance, Integrations, Developer Experience (DX), Community Health, and Extensibility. Scores range from 1 (very weak) to 5 (excellent).
      </Text>
      <Text style={styles.subsectionTitle}>Top Performers by Dimension</Text>
      <View style={{ marginBottom: 20 }}>
        <Text style={styles.paragraph}>
          <Text style={{ fontWeight: 'bold' }}>Features:</Text> Temporal (5/5), AIConductor (5/5), GitHub Copilot (4/5)
        </Text>
        <Text style={styles.paragraph}>
          <Text style={{ fontWeight: 'bold' }}>Adoption:</Text> GitHub Copilot (5/5), LangChain (5/5), GitHub Projects (5/5)
        </Text>
        <Text style={styles.paragraph}>
          <Text style={{ fontWeight: 'bold' }}>Developer Experience:</Text> Cursor (5/5), Prefect (5/5), AIConductor (5/5)
        </Text>
        <Text style={styles.paragraph}>
          <Text style={{ fontWeight: 'bold' }}>Extensibility:</Text> LangChain (5/5), Continue.dev (5/5), AIConductor (5/5)
        </Text>
      </View>
    </Page>

    {/* Market Gaps */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>3. Market Gaps & Opportunities</Text>
      {gapAnalysis.gaps.map((gap, idx) => (
        <View key={idx} style={styles.gapCard}>
          <Text style={styles.gapTitle}>Gap {idx + 1}: {gap.title}</Text>
          <Text style={styles.gapText}><Text style={{ fontWeight: 'bold' }}>Description:</Text> {gap.description}</Text>
          <Text style={styles.gapText}><Text style={{ fontWeight: 'bold' }}>Evidence:</Text> {gap.evidence}</Text>
          <Text style={styles.gapText}><Text style={{ fontWeight: 'bold' }}>Opportunity:</Text> {gap.opportunity}</Text>
        </View>
      ))}
    </Page>

    {/* Positioning Statement */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>4. Positioning Statement</Text>
      <Text style={{ ...styles.paragraph, fontSize: 13, fontWeight: 'bold', marginBottom: 15, color: '#2563eb' }}>
        "{positioning.statement}"
      </Text>
      <Text style={styles.subsectionTitle}>Target Market Segments</Text>
      {positioning.targetSegments.map((segment, idx) => (
        <Text key={idx} style={styles.paragraph}>
          • {segment}
        </Text>
      ))}
    </Page>

    {/* Competitive Advantages */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>5. Competitive Advantages</Text>
      {positioning.advantages.map((advantage, idx) => (
        <View key={idx} style={styles.advantageBox}>
          <Text style={styles.advantageTitle}>{idx + 1}. {advantage.title}</Text>
          <Text style={styles.gapText}>{advantage.description}</Text>
        </View>
      ))}
    </Page>

    {/* Product Roadmap */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>6. Product Roadmap Recommendations</Text>
      {positioning.roadmap.map((phase, idx) => (
        <View key={idx} style={styles.roadmapPhase}>
          <Text style={styles.roadmapPhaseTitle}>{phase.phase}</Text>
          {phase.items.map((item, itemIdx) => (
            <Text key={itemIdx} style={styles.roadmapItem}>
              • {item}
            </Text>
          ))}
        </View>
      ))}
    </Page>

    {/* Appendix */}
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>7. Appendix: Research Methodology</Text>
      <Text style={styles.subsectionTitle}>Research Scope</Text>
      <Text style={styles.paragraph}>
        This analysis covers 12+ competitors across 5 distinct categories of AI-assisted development platforms, evaluated on 8 key dimensions.
      </Text>
      <Text style={styles.subsectionTitle}>Data Sources</Text>
      <Text style={styles.paragraph}>
        • GitHub repository statistics (stars, contributors, activity)
      </Text>
      <Text style={styles.paragraph}>
        • Official product documentation and feature announcements
      </Text>
      <Text style={styles.paragraph}>
        • Developer community feedback (dev.to, HackerNews, Product Hunt)
      </Text>
      <Text style={styles.paragraph}>
        • Third-party comparative analyses (TowardData Science, Medium)
      </Text>
      <Text style={styles.paragraph}>
        • Market research reports (15B+ workflow orchestration market, 3-5B task management market)
      </Text>
      <Text style={styles.subsectionTitle}>Scoring Methodology</Text>
      <Text style={styles.paragraph}>
        Each dimension scored 1-5 based on weighted criteria: adoption maturity (20%), feature completeness (25%), community health (20%), compliance/security (15%), developer experience (20%).
      </Text>
      <Text style={styles.subsectionTitle}>Report Date</Text>
      <Text style={styles.paragraph}>
        {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </Text>
    </Page>
  </Document>
);

export default CompetitiveAnalysisDocument;
