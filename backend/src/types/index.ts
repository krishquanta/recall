export type ProcessingStage =
  | 'pending'
  | 'saving'
  | 'extracting'
  | 'ocr'
  | 'chunking'
  | 'embedding'
  | 'graph'
  | 'done'
  | 'error';

export interface ProcessingStatus {
  stage: ProcessingStage;
  progress: number; // 0 to 100
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
  filePath?: string;
}

export interface Page {
  text: string;
  page?: number; // 1-indexed page number
  slide?: number; // Presentation slide number (1-indexed)
  sheet?: string; // Excel sheet name
  rowStart?: number; // Excel/CSV row number (1-indexed)
  lineStart?: number; // Markdown/TXT line number (1-indexed)
  isOCR?: boolean; // true if transcribed via Gemini Vision OCR
}

export interface ChunkMetadata {
  docId: string;
  filename: string;
  mimeType: string;
  chunkIndex: number;
  isOCR?: boolean;
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  lineStart?: number;
  charStart: number;
  charEnd: number;
}

export interface Chunk {
  chunkId: string; // `${docId}-${chunkIndex}`
  text: string;
  metadata: ChunkMetadata;
}

export interface EmbeddedChunk {
  chunkId: string;
  vector: number[];
}

export interface VectorRecord {
  chunkId: string;
  vector: number[];
  text: string;
  metadata: ChunkMetadata;
}

export interface RankedChunk extends Chunk {
  score: number;
}

export interface Citation {
  index: number; // [1], [2], ...
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

export interface AskRequest {
  question: string;
  docIds?: string[];
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export interface SearchRequest {
  query: string;
  docIds?: string[];
  topK?: number;
  alpha?: number;
}

export interface SearchResponse {
  results: RankedChunk[];
}

export * from './graph';
