/**
 * Types and interfaces for Recall Phase 4:
 * Autonomous Research Agent, Gap Investigation & Bounded Web Discovery.
 */

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
  type: string;            // Matches EntityType: 'Concept' | 'Method' | 'Theorem' | etc.
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
  relationType: string;    // Matches RelationType values
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
