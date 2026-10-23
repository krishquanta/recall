import {
  Document,
  ProcessingStatus,
  AskResponse,
  GraphData,
  ReviewQueueItem,
  ContradictionAlert,
  ContradictionResolution,
  ClaimComparisonCluster,
  AuditLogEntry,
  RelationshipEdge,
} from '../types';

const API_BASE = '/api';

export async function uploadDocument(
  file: File
): Promise<{ docId: string; filename: string; status: ProcessingStatus }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Upload failed with status ${res.status}`);
  }

  return res.json();
}

export function subscribeStatusSSE(
  docId: string,
  onUpdate: (status: ProcessingStatus) => void,
  onError?: (err: Event) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/status/${docId}`);

  eventSource.onmessage = (event) => {
    try {
      const data: ProcessingStatus = JSON.parse(event.data);
      onUpdate(data);
      if (data.stage === 'done' || data.stage === 'error') {
        eventSource.close();
      }
    } catch (e) {
      console.error('Error parsing SSE message:', e);
    }
  };

  eventSource.onerror = (err) => {
    if (onError) onError(err);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}

export async function getDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE}/documents`);
  if (!res.ok) {
    throw new Error(`Failed to fetch documents: ${res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.documents || [];
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete document: ${res.statusText}`);
  }
}

export async function reindexDocument(docId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${docId}/reindex`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to reindex document: ${res.statusText}`);
  }
}

export async function askQuestion(
  question: string,
  docIds?: string[]
): Promise<AskResponse> {
  const res = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      question,
      docIds: docIds && docIds.length > 0 ? docIds : undefined,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to get answer: ${res.statusText}`);
  }

  return res.json();
}

export function getFileUrl(docId: string): string {
  return `${API_BASE}/documents/${docId}/file`;
}

export async function getDocumentText(docId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/documents/${docId}/content`);
  if (!res.ok) {
    throw new Error(`Failed to fetch document content: ${res.statusText}`);
  }
  const data = await res.json();
  return data.text || '';
}

// ================= Phase 2 Graph & Review Queue APIs =================

export async function fetchGraph(docIds?: string[]): Promise<GraphData> {
  const params = new URLSearchParams();
  if (docIds && docIds.length > 0) {
    params.append('docIds', docIds.join(','));
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/graph${queryString}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch graph data: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  const res = await fetch(`${API_BASE}/graph/review-queue`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch review queue: ${res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.items || [];
}

export async function resolveReviewItem(
  id: string,
  action: 'merge' | 'separate' | 'redirect',
  targetEntityId?: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/graph/review-queue/${id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, targetEntityId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to resolve review item: ${res.statusText}`);
  }
}

export async function reindexGraph(
  docId?: string
): Promise<{ success: boolean; stats: any }> {
  const res = await fetch(`${API_BASE}/graph/reindex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ docId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to reindex graph: ${res.statusText}`);
  }

  return res.json();
}

// ================= Phase 3 Curation, Contradictions & Audit APIs =================

export async function curateEdge(
  edgeId: string,
  params: {
    action: 'accept' | 'reject' | 'correct';
    relationType?: string;
    invertDirection?: boolean;
    description?: string;
    reason?: string;
  }
): Promise<{ ok: boolean; edge: RelationshipEdge; auditEntry: AuditLogEntry }> {
  const res = await fetch(`${API_BASE}/graph/relationships/${edgeId}/curate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to curate edge: ${res.statusText}`);
  }

  return res.json();
}

export async function fetchContradictions(status?: 'active' | 'resolved'): Promise<{
  alerts: ContradictionAlert[];
  count: number;
  activeCount: number;
}> {
  const query = status ? `?status=${status}` : '';
  const res = await fetch(`${API_BASE}/graph/contradictions${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch contradictions: ${res.statusText}`);
  }
  return res.json();
}

export async function resolveContradiction(
  id: string,
  resolution: ContradictionResolution,
  note?: string
): Promise<{ ok: boolean; alert: ContradictionAlert }> {
  const res = await fetch(`${API_BASE}/graph/contradictions/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution, note }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to resolve contradiction: ${res.statusText}`);
  }

  return res.json();
}

export async function fetchClaimComparison(
  entityId?: string
): Promise<{ cluster: ClaimComparisonCluster | null; clusters?: ClaimComparisonCluster[] }> {
  const query = entityId ? `?entityId=${encodeURIComponent(entityId)}` : '';
  const res = await fetch(`${API_BASE}/graph/claims/compare${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch claim comparison: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAuditLog(limit = 100, targetId?: string): Promise<{ entries: AuditLogEntry[] }> {
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  if (targetId) params.append('targetId', targetId);

  const res = await fetch(`${API_BASE}/graph/audit-log?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch audit log: ${res.statusText}`);
  }
  return res.json();
}

export async function rollbackAudit(
  auditId: string,
  reason?: string
): Promise<{ success: boolean; restoredAuditId: string; targetId: string }> {
  const res = await fetch(`${API_BASE}/graph/audit-log/${auditId}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to rollback audit: ${res.statusText}`);
  }

  return res.json();
}
