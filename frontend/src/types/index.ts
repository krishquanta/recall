export type ProcessingStage =
  | 'pending'
  | 'saving'
  | 'extracting'
  | 'ocr'
  | 'chunking'
  | 'embedding'
  | 'done'
  | 'error';

export interface ProcessingStatus {
  stage: ProcessingStage;
  progress: number; // 0 - 100
  error?: string;
}

export interface Document {
  docId: string;
  filename: string;
  mimeType: string;
  isOCR: boolean;
  size: number;
  uploadedAt: string;
  status: ProcessingStatus;
}

export interface ChunkMetadata {
  docId: string;
  filename: string;
  mimeType: string;
  chunkIndex: number;
  isOCR?: boolean;
  page?: number;
  sheet?: string;
  rowStart?: number;
  lineStart?: number;
  charStart?: number;
  charEnd?: number;
}

export interface Chunk {
  chunkId: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface Citation {
  index: number;
  chunkId: string;
  quote: string;
  metadata: ChunkMetadata;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  createdAt: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export interface Toast {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message?: string;
  duration?: number;
}
