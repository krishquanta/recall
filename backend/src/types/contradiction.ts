/**
 * Types and interfaces for Recall Phase 3 Contradiction & Staleness Detection.
 */

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

export interface ResolveContradictionParams {
  resolution: ContradictionResolution;
  resolutionNote?: string;
}

export interface ContradictionStoreData {
  alerts: ContradictionAlert[];
  version: number;
  lastUpdated: number;
}
