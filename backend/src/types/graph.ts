export type EntityType =
  | 'Concept'
  | 'Method'
  | 'Formula'
  | 'Theorem'
  | 'Property'
  | 'Dataset'
  | 'Person';

export type ClaimModality =
  | 'Fact'
  | 'Definition'
  | 'Hypothesis'
  | 'Rule';

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
  docId: string;
  chunkId: string;
  filename: string;
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
  aliases: string[];
  description?: string;
  embedding?: number[];
  status: 'active' | 'pending_review' | 'merged';
  mergedIntoId?: string;
  evidence: EvidenceRef[];
  createdAt: number;
  updatedAt: number;
}

export interface ClaimNode {
  id: string;
  subjectEntityId: string;
  claimText: string;
  modality: ClaimModality;
  confidence: number;
  evidence: EvidenceRef;
  createdAt: number;
}

export interface RelationshipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  description: string;
  confidence: number;
  evidence: EvidenceRef;
  claimId?: string;
  createdAt: number;
}

export interface ReviewQueueItem {
  id: string;
  candidateEntity: {
    id?: string;
    name: string;
    type: EntityType;
    evidence: EvidenceRef;
  };
  matchedEntity: {
    id: string;
    name: string;
    type: EntityType;
    aliases: string[];
  };
  similarityScore: number;
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAt?: number;
}

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  aliases?: string[];
  description?: string;
  mentionQuote?: string;
  exactQuote?: string;
}

export interface ExtractedClaim {
  subjectEntityName: string;
  claimText: string;
  modality: ClaimModality;
  confidence?: number;
  exactQuote: string;
}

export interface ExtractedRelationship {
  sourceEntityName: string;
  targetEntityName: string;
  relationType: RelationType;
  description?: string;
  confidence?: number;
  exactQuote: string;
}

export interface ExtractedGraphPayload {
  entities: ExtractedEntity[];
  claims: ExtractedClaim[];
  relationships: ExtractedRelationship[];
}

export interface ValidatedEntity extends ExtractedEntity {
  evidence: EvidenceRef;
}

export interface ValidatedClaim extends ExtractedClaim {
  confidence: number;
  evidence: EvidenceRef;
}

export interface ValidatedRelationship extends ExtractedRelationship {
  description: string;
  confidence: number;
  evidence: EvidenceRef;
}

export interface ValidatedGraphPayload {
  entities: ValidatedEntity[];
  claims: ValidatedClaim[];
  relationships: ValidatedRelationship[];
}
