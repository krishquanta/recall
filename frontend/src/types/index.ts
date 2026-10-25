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
  sourceType?: 'upload' | 'web';
  sourceUrl?: string;
  retrievedAt?: string;
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

export type CurationStatus = 'proposed' | 'verified' | 'rejected' | 'corrected';

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
  curationStatus?: CurationStatus;
  curatedAt?: number;
  curationReason?: string;
  originalRelationType?: RelationType;
  hasContradiction?: boolean;
  contradictionId?: string;
}

// ================= Phase 3 Contradiction, Curation & Audit Types =================

export type ContradictionType =
  | 'direct_negation'
  | 'divergent_quantities'
  | 'incompatible_conditions'
  | 'contextual_exception'
  | 'stale_superseded'
  | 'none';

export type ContradictionSeverity = 'high' | 'medium' | 'low';

export type ContradictionResolution =
  | 'prefer_a'
  | 'prefer_b'
  | 'both_valid'
  | 'explicit_contradicts_edge';

export interface ContradictionAlert {
  id: string;
  claimIdA: string;
  claimIdB: string;
  docIdA: string;
  docIdB: string;
  entityId: string;
  entityName: string;
  quoteA: string;
  quoteB: string;
  filenameA: string;
  filenameB: string;
  type: ContradictionType;
  severity: ContradictionSeverity;
  explanation: string;
  reconciliationHint?: string;
  detectedAt: number;
  status: 'active' | 'resolved_claim_a' | 'resolved_claim_b' | 'dismissed_both_valid';
  resolutionNote?: string;
  resolvedAt?: number;
}

export interface AlignedClaim {
  claimId: string;
  claimText: string;
  docId: string;
  filename: string;
  evidence: EvidenceRef;
  confidence: number;
  modality?: ClaimModality;
  documentDate?: string;
  documentVersion?: number;
  isStale?: boolean;
  supersededByClaimId?: string;
}

export interface ClaimTopicGroup {
  topic: string;
  claims: AlignedClaim[];
  consensusScore: number;
  hasContradiction: boolean;
  hasStaleClaim: boolean;
}

export interface ClaimComparisonCluster {
  entityId: string;
  entityName: string;
  claimGroups: ClaimTopicGroup[];
}

export type AuditActionType =
  | 'edge_curate_accept'
  | 'edge_curate_reject'
  | 'edge_curate_correct'
  | 'relationship_curated'
  | 'relationship_created'
  | 'relationship_deleted'
  | 'entity_updated'
  | 'entity_merge'
  | 'entity_edit'
  | 'claim_curate'
  | 'contradiction_resolved'
  | 'contradiction_resolve'
  | 'research_import'
  | 'rollback';

export interface AuditLogEntry {
  auditId: string;
  timestamp: number;
  action: AuditActionType;
  targetType: 'relationship' | 'entity' | 'claim' | 'contradiction' | 'research';
  targetId: string;
  beforeState: any;
  afterState: any;
  reason?: string;
  sourceDocId?: string;
  rolledBack?: boolean;
  rollbackRefId?: string;
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

// ================= Phase 4 Autonomous Research Agent Types =================

export type GapType =
  | 'CONTRADICTION'
  | 'STALE_CLAIM'
  | 'WEAK_GROUNDING'
  | 'ISOLATED_ENTITY'
  | 'USER_QUERY';

export interface InvestigationGap {
  id: string;
  type: GapType;
  title: string;
  description: string;
  suggestedQuestion: string;
  priorityScore: number; // 0.0 to 1.0 (higher = more urgent)
  targetEntityIds: string[];
  targetClaimIds?: string[];
  contradictionId?: string; // References ContradictionAlert.id
  detectedAt: string;       // ISO 8601
}

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  retrievedAt: string;      // ISO 8601
  snippet: string;
  fullText?: string;
  authorOrPublisher?: string;
}

export interface SourcedResearchReport {
  id: string;
  taskId: string;
  question: string;
  summary: string;
  detailedAnalysis: string;
  whatChangedAndWhy: string;
  sources: ResearchSource[];
  generatedAt: string;      // ISO 8601
}

export interface ProposedEntity {
  tempId: string;
  name: string;
  type: EntityType | string;
  description: string;
  evidenceQuote: string;   // Verbatim substring from source fullText
  sourceUrl: string;
  sourceId: string;        // References ResearchSource.id
  accepted: boolean;       // Toggle by user in review UI
}

export interface ProposedRelation {
  tempId: string;
  sourceEntityName: string;
  targetEntityName: string;
  relationType: RelationType | string;
  description: string;
  evidenceQuote: string;
  sourceUrl: string;
  sourceId: string;
  accepted: boolean;
}

export interface ProposedContradictionResolution {
  contradictionId: string; // References ContradictionAlert.id
  resolutionType: 'UPDATED_CONSENSUS' | 'SUPERSEDES' | 'CONTEXT_CLARIFICATION';
  explanation: string;
  winningClaimEvidenceQuote?: string;
  accepted: boolean;
}

export interface ResearchProposal {
  id: string;              // UUID, returned as proposalId in REST responses
  report: SourcedResearchReport;
  proposedEntities: ProposedEntity[];
  proposedRelations: ProposedRelation[];
  proposedResolutions: ProposedContradictionResolution[];
  status: 'PENDING_REVIEW' | 'IMPORTED' | 'REJECTED';
  createdAt: string;       // ISO 8601, for expiry management
}

export interface ResearchBudget {
  maxQueries: number;        // default: 3
  maxSources: number;        // default: 5
  maxExecutionTimeMs: number; // default: 120000 (2 min)
  maxRedirectsPerUrl: number; // default: 3
  queriesUsed: number;
  sourcesFetched: number;
  startTimeMs: number;
}

export interface ResearchSettings {
  approvedDomains: string[];   // e.g. ['wikipedia.org', 'arxiv.org', '*.edu', '*.gov']
  maxQueriesPerTask: number;   // default: 3
  maxSourcesPerTask: number;   // default: 5
  maxExecutionTimeMs: number;  // default: 120000
  enableDuckDuckGo: boolean;   // default: true
  enableWikipediaApi: boolean; // default: true
  enableArxivApi: boolean;     // default: true
}
