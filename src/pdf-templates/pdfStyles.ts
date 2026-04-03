import { StyleSheet } from '@react-pdf/renderer';

export const pdfStyles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#ffffff',
    color: '#1a1a1a',
  },

  // Cover page
  coverPage: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 60,
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  coverBadge: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#94a3b8',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  coverTitle: {
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    color: '#f8fafc',
    marginBottom: 8,
    lineHeight: 1.2,
  },
  coverSubtitle: {
    fontSize: 13,
    color: '#cbd5e1',
    marginBottom: 40,
  },
  coverMeta: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 4,
  },
  coverConfidential: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#f87171',
    marginTop: 40,
    padding: '6 10',
    borderWidth: 1,
    borderColor: '#f87171',
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  coverDivider: {
    height: 2,
    backgroundColor: '#3b82f6',
    marginBottom: 32,
    width: 48,
  },

  // Section headings
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 10,
    marginTop: 24,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
  },
  subSectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#334155',
    marginBottom: 6,
    marginTop: 14,
  },

  // Body text
  bodyText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#374151',
    marginBottom: 8,
  },
  italicText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#4b5563',
    fontFamily: 'Helvetica-Oblique',
    marginBottom: 8,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },

  // Table
  table: {
    width: '100%',
    marginBottom: 12,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    padding: '6 8',
  },
  tableRow: {
    flexDirection: 'row',
    padding: '6 8',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: '6 8',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#f8fafc',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableCell: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.5,
  },
  tableCellMuted: {
    fontSize: 9,
    color: '#6b7280',
  },

  // Priority badges
  badgeMustHave: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#dc2626',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeShouldHave: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#d97706',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeCouldHave: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#16a34a',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeApproved: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#16a34a',
    padding: '2 6',
    borderRadius: 3,
  },
  badgeRejected: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#dc2626',
    padding: '2 6',
    borderRadius: 3,
  },
  badgePending: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    backgroundColor: '#e5e7eb',
    padding: '2 6',
    borderRadius: 3,
  },
  badgeP0: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#7c3aed',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeP1: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#2563eb',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeP2: {
    fontSize: 8,
    color: '#374151',
    backgroundColor: '#e5e7eb',
    padding: '2 5',
    borderRadius: 3,
  },
  badgeP3: {
    fontSize: 8,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    padding: '2 5',
    borderRadius: 3,
  },

  // Q&A layout
  qaItem: {
    marginBottom: 12,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#e2e8f0',
  },
  qaQuestion: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 3,
  },
  qaAnswer: {
    fontSize: 9,
    color: '#4b5563',
    lineHeight: 1.5,
  },

  // Code block
  codeBlock: {
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  codeText: {
    fontSize: 8,
    fontFamily: 'Courier',
    color: '#1e293b',
    lineHeight: 1.5,
  },
  codeLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    marginBottom: 4,
  },

  // Diagram
  diagramContainer: {
    marginBottom: 12,
    alignItems: 'center',
  },
  diagramCaption: {
    fontSize: 9,
    color: '#6b7280',
    fontFamily: 'Helvetica-Oblique',
    marginTop: 6,
    textAlign: 'center',
  },
  pendingBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 4,
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  pendingText: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: 'Helvetica-Oblique',
  },

  // Bullet list
  bulletItem: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 8,
  },
  bullet: {
    fontSize: 10,
    color: '#3b82f6',
    marginRight: 6,
    marginTop: 1,
  },
  bulletText: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.5,
    flex: 1,
  },

  // Review card
  reviewCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    padding: 10,
  },
  reviewCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  reviewRoleName: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  reviewNotes: {
    fontSize: 9,
    color: '#4b5563',
    lineHeight: 1.5,
  },

  // Security notice
  securityNotice: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fbbf24',
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  securityNoticeText: {
    fontSize: 8,
    color: '#92400e',
    lineHeight: 1.5,
  },

  // Page footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 8,
    color: '#94a3b8',
  },
});
