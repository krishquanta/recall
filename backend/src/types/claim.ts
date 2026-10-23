import { EvidenceRef, ClaimModality } from './graph';

/**
 * An atomic claim hydrated with document metadata, coordinates, and comparison annotations.
 */
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

/**
 * A topical cluster of claims sharing the same conceptual sub-theme for an entity.
 */
export interface ClaimTopicGroup {
  topic: string;
  claims: AlignedClaim[];
  consensusScore: number; // 0.0 (total disagreement) to 1.0 (unanimous concordance)
  hasContradiction: boolean;
  hasStaleClaim: boolean;
}

/**
 * Top-level comparison payload aggregating all topical claim groups for a canonical entity.
 */
export interface ClaimComparisonCluster {
  entityId: string;
  entityName: string;
  claimGroups: ClaimTopicGroup[];
}

/**
 * Configuration options for claim alignment and consensus comparison.
 */
export interface CompareClaimsOptions {
  similarityThreshold?: number; // Raw cosine threshold for clustering, default 0.70
  contradictionPenalty?: number; // Agreement multiplier when contradictory, default 0.0
  includeSingleDoc?: boolean; // Whether to include claims from entities documented in only one source, default true
}

// Convenience alias for backward compatibility
export type ClaimComparisonOptions = CompareClaimsOptions;
