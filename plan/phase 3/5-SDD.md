# SDD — Software Design Document (Phase 3)
> **Structural, architectural, and algorithmic specifications for backend services, data stores, API endpoints, and frontend components**

---

## Directory & File Additions

```
recall/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── curation.ts                  ← [NEW] Endpoints for accepting, rejecting, correcting edges
│   │   │   ├── contradictions.ts            ← [NEW] Endpoints for listing & resolving contradictions
│   │   │   └── audit.ts                     ← [NEW] Endpoints for querying audit log & triggering rollback
│   │   ├── services/
│   │   │   ├── ClaimComparisonService.ts    ← [NEW] Cross-source entity/claim alignment & consensus scoring
│   │   │   ├── ContradictionDetectionService.ts ← [NEW] Rule-based + LLM contradiction & staleness evaluator
│   │   │   ├── RelationshipCurationService.ts ← [NEW] Edge state transitions & mutation coordinator
│   │   │   └── AuditService.ts              ← [NEW] Append-only audit logger & state rollback engine
│   │   ├── store/
│   │   │   ├── AuditStore.ts                ← [NEW] High-performance append-only JSONL stream manager
│   │   │   └── ContradictionStore.ts        ← [NEW] Persistence for contradiction alerts in contradictions.json
│   │   ├── types/
│   │   │   ├── contradiction.ts             ← [NEW] ContradictionAlert, ClaimComparison interfaces
│   │   │   ├── audit.ts                     ← [NEW] AuditLogEntry, MutationAction interfaces
│   │   │   └── graph.ts                     ← [EXTEND] CurationStatus, originalRelationType, contradiction flags
│   │   └── index.ts                         ← [MODIFY] Mount /api/graph/curate, /api/graph/contradictions, /api/graph/audit
│   └── data/
│       ├── contradictions.json              ← Persisted cross-source contradiction & staleness records
│       └── audit_log.jsonl                  ← Append-only immutable change ledger
│
└── frontend/
    ├── src/
    │   ├── api/
    │   │   └── client.ts                    ← [EXTEND] curateEdge, fetchContradictions, resolveContradiction, fetchAuditLog, rollbackAudit
    │   ├── components/
    │   │   ├── Graph/
    │   │   │   ├── RelationCurationPopover.tsx ← [NEW] In-canvas popover for Accept/Reject/Correct
    │   │   │   ├── CorrectRelationModal.tsx    ← [NEW] Modal for editing relationType and reversing direction
    │   │   │   ├── ContradictionDrawer.tsx     ← [NEW] Side-by-side comparison drawer with resolution buttons
    │   │   │   └── VersionHistoryModal.tsx     ← [NEW] Chronological audit timeline with one-click rollback
    │   │   └── Header/
    │   │       └── ChatHeaderWithViewSelector.tsx ← [EXTEND] Add Contradiction counter & History button
    │   ├── store/
    │   │   ├── graphStore.ts                ← [EXTEND] Edge curation actions, contradiction state, audit modal open/close
    │   │   └── appStore.ts                  ← [EXTEND] Selected contradiction alert reference
    │   └── types/
    │       └── index.ts                     ← [EXTEND] Frontend contradiction & audit log interfaces
```

---

## Detailed Service Specifications

### 1. `AuditStore.ts` & `AuditService.ts`
Manages an immutable, append-only JSONL log file at `backend/data/audit_log.jsonl`.
```typescript
export interface AuditLogEntry {
  auditId: string;
  timestamp: number;
  action:
    | 'edge_curate_accept'
    | 'edge_curate_reject'
    | 'edge_curate_correct'
    | 'entity_merge'
    | 'entity_edit'
    | 'claim_curate'
    | 'contradiction_resolve'
    | 'rollback';
  targetType: 'relationship' | 'entity' | 'claim' | 'contradiction';
  targetId: string;
  beforeState: any;
  afterState: any;
  reason?: string;
  sourceDocId?: string;
  rolledBack?: boolean;
  rollbackRefId?: string;
}

export class AuditStore {
  private logFilePath: string;
  private entries: AuditLogEntry[] = [];

  constructor(filePath?: string) {
    this.logFilePath = filePath || path.join(process.cwd(), 'data', 'audit_log.jsonl');
    this.loadInitial();
  }

  public append(entry: Omit<AuditLogEntry, 'auditId' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      auditId: uuidv4(),
      timestamp: Date.now(),
    };
    this.entries.unshift(fullEntry);
    fs.appendFileSync(this.logFilePath, JSON.stringify(fullEntry) + '\n', 'utf8');
    return fullEntry;
  }

  public getHistory(limit = 100, targetId?: string): AuditLogEntry[] {
    if (targetId) {
      return this.entries.filter((e) => e.targetId === targetId).slice(0, limit);
    }
    return this.entries.slice(0, limit);
  }
}
```

---

### 2. `RelationshipCurationService.ts`
Coordinates edge state changes, updating `GraphStore` and logging every change to `AuditStore`.
```typescript
export class RelationshipCurationService {
  constructor(
    private graph: GraphStore = graphStore,
    private audit: AuditService = auditService
  ) {}

  public async acceptEdge(edgeId: string, reason?: string): Promise<RelationshipEdge> {
    const edge = this.graph.getEdge(edgeId);
    if (!edge) throw new Error(`Edge ${edgeId} not found`);

    const beforeState = { ...edge };
    edge.curationStatus = 'verified';
    edge.curatedAt = Date.now();
    if (reason) edge.curationReason = reason;

    this.graph.updateEdge(edgeId, edge);
    await this.graph.save();

    this.audit.record({
      action: 'edge_curate_accept',
      targetType: 'relationship',
      targetId: edgeId,
      beforeState,
      afterState: edge,
      reason,
      sourceDocId: edge.evidence.docId,
    });

    return edge;
  }

  public async rejectEdge(edgeId: string, reason?: string): Promise<RelationshipEdge> {
    const edge = this.graph.getEdge(edgeId);
    if (!edge) throw new Error(`Edge ${edgeId} not found`);

    const beforeState = { ...edge };
    edge.curationStatus = 'rejected';
    edge.curatedAt = Date.now();
    if (reason) edge.curationReason = reason;

    this.graph.updateEdge(edgeId, edge);
    await this.graph.save();

    this.audit.record({
      action: 'edge_curate_reject',
      targetType: 'relationship',
      targetId: edgeId,
      beforeState,
      afterState: edge,
      reason,
      sourceDocId: edge.evidence.docId,
    });

    return edge;
  }

  public async correctEdge(
    edgeId: string,
    params: {
      relationType?: RelationType;
      invertDirection?: boolean;
      description?: string;
      reason?: string;
    }
  ): Promise<RelationshipEdge> {
    const edge = this.graph.getEdge(edgeId);
    if (!edge) throw new Error(`Edge ${edgeId} not found`);

    const beforeState = { ...edge };
    if (!edge.originalRelationType) {
      edge.originalRelationType = edge.relationType;
    }

    if (params.relationType) edge.relationType = params.relationType;
    if (params.description) edge.description = params.description;
    if (params.invertDirection) {
      const temp = edge.sourceId;
      edge.sourceId = edge.targetId;
      edge.targetId = temp;
    }

    edge.curationStatus = 'corrected';
    edge.curatedAt = Date.now();
    if (params.reason) edge.curationReason = params.reason;

    this.graph.updateEdge(edgeId, edge);
    await this.graph.save();

    this.audit.record({
      action: 'edge_curate_correct',
      targetType: 'relationship',
      targetId: edgeId,
      beforeState,
      afterState: edge,
      reason: params.reason,
      sourceDocId: edge.evidence.docId,
    });

    return edge;
  }
}
```

---

### 3. `ContradictionDetectionService.ts`
Detects and tracks contradictions and stale claims between multi-source documents.
```typescript
export class ContradictionDetectionService {
  constructor(
    private graph: GraphStore = graphStore,
    private contradictionStore: ContradictionStore = contradictionStore,
    private embedder: EmbeddingService = embeddingService
  ) {}

  /**
   * Scans claims across documents for a specific entity or after a new document upload.
   */
  public async evaluateEntityClaims(entityId: string): Promise<ContradictionAlert[]> {
    const claims = this.graph.getClaimsForEntity(entityId);
    if (claims.length < 2) return [];

    const newAlerts: ContradictionAlert[] = [];

    // Group claims by document
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const cA = claims[i];
        const cB = claims[j];

        // Only compare claims originating from different documents
        if (cA.evidence.docId === cB.evidence.docId) continue;

        const isContradiction = await this.checkPair(cA, cB);
        if (isContradiction.detected) {
          const alert = this.contradictionStore.create({
            claimIdA: cA.id,
            claimIdB: cB.id,
            docIdA: cA.evidence.docId,
            docIdB: cB.evidence.docId,
            entityId,
            entityName: this.graph.getEntity(entityId)?.name || 'Unknown',
            type: isContradiction.type,
            severity: isContradiction.severity,
            explanation: isContradiction.explanation,
          });
          newAlerts.push(alert);
        }
      }
    }

    return newAlerts;
  }
}
```

---

## REST API Contract

| Route | Method | Payload / Query | Response | Description |
|---|---|---|---|---|
| `/api/graph/relationships/:id/curate` | `POST` | `{ action: 'accept' \| 'reject' \| 'correct', ...params }` | `{ ok: true, edge: RelationshipEdge }` | Accepts, rejects, or modifies a relationship edge |
| `/api/graph/contradictions` | `GET` | `?status=pending` | `{ alerts: ContradictionAlert[], count: number }` | Retrieves active or resolved contradiction alerts |
| `/api/graph/contradictions/:id/resolve` | `POST` | `{ resolution: 'prefer_a' \| 'prefer_b' \| 'both_valid', note?: string }` | `{ ok: true, alert: ContradictionAlert }` | Resolves a contradiction |
| `/api/graph/claims/compare` | `GET` | `?entityId=...` | `{ cluster: ClaimComparisonCluster }` | Returns cross-source claims grouped by topic |
| `/api/graph/audit-log` | `GET` | `?limit=50&targetId=...` | `{ entries: AuditLogEntry[] }` | Queries the chronological change history |
| `/api/graph/audit-log/:id/rollback` | `POST` | `{}` | `{ ok: true, restoredAuditId: string }` | Reverts the mutation specified by `id` |
