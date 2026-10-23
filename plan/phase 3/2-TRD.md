# TRD — Technical Requirements Document (Phase 3)
> **Technical requirements, data structures, algorithms, schemas, and API contracts**

---

## Functional Requirements

### FR-1 Cross-Source Claim Comparison & Alignment
- **Clustering by Entity & Concept**: The system SHALL aggregate all claims associated with a given canonical entity $E_i$ or related concept cluster across distinct document IDs ($docId_A \neq docId_B$).
- **Semantic Claim Similarity**: For claims sharing subject entities, the system computes pairwise cosine similarity $S_c = \cos(\vec{v}_{claimA}, \vec{v}_{claimB})$ using `EmbeddingService`.
- **Comparison Payload**: The system produces a structured `ClaimComparisonCluster`:
  ```typescript
  interface ClaimComparisonCluster {
    entityId: string;
    entityName: string;
    claimGroups: Array<{
      topic: string;
      claims: Array<{
        claimId: string;
        claimText: string;
        modality: ClaimModality;
        confidence: number;
        docId: string;
        filename: string;
        evidence: EvidenceRef;
        documentDate?: string;
        documentVersion?: number;
      }>;
      consensusScore: number; // 0.0 (total disagreement) to 1.0 (unanimous agreement)
      hasContradiction: boolean;
      hasStaleClaim: boolean;
    }>;
  }
  ```

### FR-2 Contradiction Detection Engine
- **Two-Tier Detection Pipeline**:
  1. **Heuristic Filter**: Fast pre-screening for direct negation patterns, antonyms, contrasting modality pairs (`Rule` vs `Hypothesis`), and opposing relationship edges (e.g. `source -> USES -> target` in Doc 1 vs `source -> CONTRADICTS -> target` in Doc 2).
  2. **LLM Verification with Structured Schema**: Candidate pairs with high semantic overlap ($S_c \ge 0.70$) but low lexical agreement are evaluated via Gemini structured JSON output:
     ```typescript
     interface ContradictionEvaluation {
       isContradiction: boolean;
       contradictionType: 'direct_negation' | 'divergent_quantities' | 'incompatible_conditions' | 'contextual_exception' | 'none';
       severity: 'high' | 'medium' | 'low';
       explanation: string;
       reconciliationHint?: string;
     }
     ```
- **Contradiction Persistence**: Verified contradictions generate a `ContradictionAlert` persisted in `data/contradictions.json` and optionally synthesize a bidirectional `CONTRADICTS` relationship edge in `GraphStore`.

### FR-3 Staleness & Deprecation Detection Engine
- **Temporal & Version Analysis**:
  - The system analyzes document metadata (`uploadedAt`, extracted publication year/edition from header/title page, document version `v1, v2`).
  - When two conflicting claims exist where Doc $A$ is dated earlier than Doc $B$ by $\ge 1$ academic term or major edition, Doc $A$'s claim is tagged with `isStale: true` and `supersededByClaimId: string`.
- **Explicit Deprecation Detection**:
  - Regular expressions and prompt schemas detect phrases such as *"superseded by"*, *"previously assumed"*, *"deprecated in version"*, *"former definition"*.

### FR-4 Relationship Curation Suite & Edge State Machine
- **Curation Lifecycle States**:
  Every `RelationshipEdge` in `GraphStore` SHALL possess a curation status:
  ```typescript
  type CurationStatus = 'proposed' | 'verified' | 'rejected' | 'corrected';
  ```
  - `proposed`: Initial state extracted by AI.
  - `verified`: Explicitly confirmed by the user (**Accept** action).
  - `rejected`: Marked invalid by the user (**Reject** action); hidden from active search traversals but preserved for audit.
  - `corrected`: Edited by the user (**Correct** action); retains original extraction in `history` while displaying corrected type or direction.
- **Curation Action Contract**:
  - **Accept**: `POST /api/graph/relationships/:id/curate` with `{ action: 'accept' }`.
  - **Reject**: `POST /api/graph/relationships/:id/curate` with `{ action: 'reject', reason?: string }`.
  - **Correct**: `POST /api/graph/relationships/:id/curate` with:
    ```typescript
    {
      action: 'correct',
      correctedRelationType?: RelationType,
      correctedSourceId?: string,
      correctedTargetId?: string,
      correctedDescription?: string,
      reason?: string
    }
    ```

### FR-5 Immutable Audit Trail & Rollback Engine
- **Append-Only Event Store**: Every mutation (entity merge, relationship curation, contradiction dismissal, document re-indexing) is logged to `data/audit_log.jsonl`.
  ```typescript
  interface AuditLogEntry {
    auditId: string;
    timestamp: number;
    action: 'edge_curate_accept' | 'edge_curate_reject' | 'edge_curate_correct' | 'entity_merge' | 'entity_edit' | 'claim_curate' | 'rollback';
    targetType: 'relationship' | 'entity' | 'claim' | 'contradiction';
    targetId: string;
    beforeState: any;
    afterState: any;
    reason?: string;
    sourceDocId?: string;
    rolledBack?: boolean;
    rollbackRefId?: string;
  }
  ```
- **ACID Rollback Capability**:
  - `POST /api/graph/audit-log/:id/rollback` reverses the specific audit entry by restoring `beforeState` into `GraphStore` and logging an inverse `rollback` audit event.

### FR-6 Document Revision & Versioning
- **Re-Upload Ingestion**: When uploading a document with the same filename or explicit `parentDocId`:
  - Increment version number: `version: doc.version + 1`.
  - Track changes in extracted chunks and claims across versions.
  - Detect newly resolved or newly introduced contradictions against the new revision.

---

## Data Schemas & Contracts

### Contradiction Model (`types/contradiction.ts`)
```typescript
export interface ContradictionAlert {
  id: string;
  claimIdA: string;
  claimIdB: string;
  docIdA: string;
  docIdB: string;
  entityId: string;
  entityName: string;
  type: 'direct_negation' | 'divergent_quantities' | 'incompatible_conditions' | 'stale_superseded';
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  status: 'pending' | 'resolved_claim_a' | 'resolved_claim_b' | 'dismissed_both_valid';
  createdAt: number;
  resolvedAt?: number;
  resolutionNote?: string;
}
```

### Relationship Edge Extension (`types/graph.ts`)
```typescript
export interface RelationshipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  description: string;
  confidence: number;
  evidence: EvidenceRef;
  createdAt: number;
  // Phase 3 additions:
  curationStatus: CurationStatus; // 'proposed' | 'verified' | 'rejected' | 'corrected'
  curatedAt?: number;
  curationReason?: string;
  originalRelationType?: RelationType; // preserved if corrected
  hasContradiction?: boolean;
  contradictionId?: string;
}
```

---

## Non-Functional Requirements

| Metric | Target | Verification Method |
|--------|--------|---------------------|
| **Curation API Response Time** | $\le 80$ms (p95) | In-memory atomic update + background file flush |
| **Audit Log Write Overhead** | $\le 10$ms | Append-only stream writing to `audit_log.jsonl` |
| **Rollback Transaction Safety** | Zero data corruption | In-memory state rollback with atomic JSON save and mutex |
| **Offline Testability** | 100% Mock Fallback | Rule-based contradiction and mock comparison when `GEMINI_API_KEY` is omitted |
| **Browser Render Scalability** | 60 FPS up to 2,500 edges | Edge styling virtualization and status-based visual filtering in `@xyflow/react` |
