import {
  Document,
  ProcessingStatus,
  AskResponse,
  GraphData,
  ReviewQueueItem,
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
