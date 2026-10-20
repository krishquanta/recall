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
  mimeType?: string;
  chunkIndex?: number;
  isOCR?: boolean;
  page?: number;
  slide?: number;
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

// ================= Phase 2 Knowledge Graph & Provenance Types =================

export type EntityType =
  | 'Concept'
  | 'Method'
  | 'Formula'
  | 'Theorem'
  | 'Property'
  | 'Dataset'
  | 'Person';

export type ClaimModality = 'Fact' | 'Definition' | 'Hypothesis' | 'Rule';

export type RelationType =
  | 'DEFINES'
  | 'IS_A'
  | 'PART_OF'
  | 'PREREQUISITE_FOR'
  | 'CAUSES'
  | 'USES'
  | 'CONTRADICTS'
  | 'PROVES'
  | 'EQUIVALENT_TO'
  | 'RELATED_TO';

export interface EvidenceRef {
  chunkId?: string;
  docId?: string;
  filename?: string;
  page?: number;
  slide?: number;
  sheet?: string;
  rowStart?: number;
  lineStart?: number;
  exactQuote: string;
  charOffset?: { start: number; end: number };
}

export interface EntityNode {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  aliases: string[];
  embedding?: number[];
  status: 'active' | 'pending_review' | 'merged';
  mergedIntoId?: string;
  evidence?: EvidenceRef[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ClaimNode {
  id: string;
  subjectEntityId: string;
  claimText: string;
  modality: ClaimModality;
  confidence: number;
  evidence: EvidenceRef;
  createdAt?: number;
}

export interface RelationshipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  description?: string;
  confidence?: number;
  evidence: EvidenceRef;
  claimId?: string;
  createdAt?: number;
}

export interface ReviewQueueItem {
  id: string;
  candidateEntity: {
    id?: string;
    name: string;
    type: EntityType;
    aliases?: string[];
    evidence: EvidenceRef;
  };
  matchedEntity: {
    id: string;
    name: string;
    type: EntityType;
    aliases: string[];
    evidence?: EvidenceRef;
  };
  similarityScore: number;
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAt?: number;
}

export interface GraphData {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  claims?: ClaimNode[];
}

export interface PreviewableEvidence {
  chunkId?: string;
  text?: string;
  quote?: string;
  metadata: {
    docId: string;
    filename: string;
    mimeType?: string;
    chunkIndex?: number;
    isOCR?: boolean;
    page?: number;
    slide?: number;
    sheet?: string;
    rowStart?: number;
    lineStart?: number;
    charStart?: number;
    charEnd?: number;
  };
}
