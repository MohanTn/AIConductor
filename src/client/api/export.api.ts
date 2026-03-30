/**
 * Export API client — triggers browser PDF downloads for PRD and Architecture documents.
 */

const API_BASE = '/api';

async function downloadPdf(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin' });

  if (!response.ok) {
    // Parse error response without exposing internal details
    await response.json().catch(() => null);
    throw new Error(`Export failed (${response.status})`);
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error('Unexpected response type — export failed');
  }

  const blob = await response.blob();

  // Create object URL and trigger download
  // URL.createObjectURL must be called synchronously before any await to avoid popup blockers
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke after download has initiated
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export async function exportPRD(featureSlug: string, repoName: string): Promise<void> {
  const url = `${API_BASE}/features/${encodeURIComponent(featureSlug)}/export/prd?repoName=${encodeURIComponent(repoName)}`;
  const filename = `${featureSlug}-prd.pdf`;
  await downloadPdf(url, filename);
}

export async function exportArchitecture(featureSlug: string, repoName: string): Promise<void> {
  const url = `${API_BASE}/features/${encodeURIComponent(featureSlug)}/export/architecture?repoName=${encodeURIComponent(repoName)}`;
  const filename = `${featureSlug}-architecture.pdf`;
  await downloadPdf(url, filename);
}
