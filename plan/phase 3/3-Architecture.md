# Architecture Design — Software / System Architecture (Phase 3)
> **System components, sequence interactions, data flows, and storage design for cross-source comparison, contradiction detection, relationship curation, and audit versioning**

---

## Component Diagram

```mermaid
flowchart TD
    subgraph Client["Recall Web Client (React 18 + TypeScript)"]
        direction TB
        GraphCanvas["Knowledge Graph Canvas (@xyflow/react)\n• Visual Edge Curation\n• Contradiction Badges"]
        CurationToolbar["Edge Curation Popover\n• [ Accept ] [ Reject ] [ Correct ]"]
        ContradictionDrawer["Contradiction & Stale Claims Drawer\n• Side-by-side Evidence Cards\n• Resolution Picker"]
        VersionHistoryModal["Version History & Audit Log Modal\n• Interactive Timeline\n• One-click Rollback"]
    end

    subgraph API["Express API Server (Port 3001)"]
        direction TB
        R_Curate["POST /api/graph/relationships/:id/curate"]
        R_Compare["GET /api/graph/claims/compare"]
        R_Contradict["GET /api/graph/contradictions\nPOST /api/graph/contradictions/:id/resolve"]
        R_Audit["GET /api/graph/audit-log\nPOST /api/graph/audit-log/:id/rollback"]
        R_Versions["GET /api/documents/:id/versions"]
    end

    subgraph Services["Phase 3 Service Layer"]
        direction TB
        CompareSvc["ClaimComparisonService\n• Entity & concept cross-source clustering\n• Consensus scoring"]
        ContradictEngine["ContradictionDetectionService\n• Heuristic & LLM cross-examination\n• Staleness / superseded evaluator"]
        CurationMgr["RelationshipCurationService\n• Curation state machine\n• Incident edge & claim cascade"]
        AuditEngine["AuditService\n• Immutable event recording\n• State delta generation & rollback engine"]
    end

    subgraph Storage["File-Backed Persistence Layer"]
        direction TB
        GraphFile["data/graph.json (Nodes, Edges, Claims, Evidence)"]
        ContradictFile["data/contradictions.json (Active & Resolved Alerts)"]
        AuditStream["data/audit_log.jsonl (Append-Only Immutable Event Stream)"]
        MetaFile["data/metadata.json (Docs + Revision Metadata)"]
    end

    %% Client to API
    GraphCanvas --> CurationToolbar
    CurationToolbar --> R_Curate
    GraphCanvas --> ContradictionDrawer
    ContradictionDrawer --> R_Contradict
    ContradictionDrawer --> R_Compare
    GraphCanvas --> VersionHistoryModal
    VersionHistoryModal --> R_Audit

    %% API to Services
    R_Curate --> CurationMgr
    R_Compare --> CompareSvc
    R_Contradict --> ContradictEngine
    R_Audit --> AuditEngine

    %% Services interactions
    CurationMgr --> AuditEngine
    CurationMgr --> GraphFile
    ContradictEngine --> CompareSvc
    ContradictEngine --> ContradictFile
    AuditEngine --> AuditStream
    AuditEngine --> GraphFile
    CompareSvc --> GraphFile
```

---

## Detailed Sequence Diagrams

### 1. Cross-Source Contradiction & Staleness Detection Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Ingest as Upload / Ingestion Pipeline
    participant Validator as ProvenanceValidator
    participant Graph as GraphStore
    participant Compare as ClaimComparisonService
    participant Contradict as ContradictionDetectionService
    participant LLM as Gemini API (Evaluator)
    participant Store as ContradictionStore

    Ingest->>Validator: Validate extracted claims & relationships
    Validator->>Graph: Persist anchored claims & edges
    Ingest->>Contradict: evaluateCrossSourceContradictions(newDocId)
    Contradict->>Compare: clusterClaimsByEntity(newDocId)
    Compare-->>Contradict: Return multi-source claim clusters
    
    loop For each cluster with multiple sources
        Contradict->>Contradict: Run heuristic negation / opposing edge check
        alt Candidate contradiction detected
            Contradict->>LLM: evaluateContradiction(claimA, claimB, docContext)
            LLM-->>Contradict: { isContradiction: true, type: 'direct_negation', severity: 'high' }
            Contradict->>Store: saveAlert(contradictionAlert)
            Contradict->>Graph: Flag edges/claims (hasContradiction = true)
        end
    end
```

---

### 2. Relationship Curation (Accept / Reject / Correct) Sequence

```mermaid
sequenceDiagram
    autonumber
    participant User as Student / Curator (UI)
    participant Canvas as GraphCanvas
    participant API as Express API
    participant CurateSvc as RelationshipCurationService
    participant Graph as GraphStore
    participant Audit as AuditService
    participant Stream as audit_log.jsonl

    User->>Canvas: Clicks relationship edge [A -> RELATED_TO -> B]
    Canvas->>Canvas: Opens CurationToolbar
    User->>Canvas: Selects "Correct" -> changes to PREREQUISITE_FOR
    Canvas->>API: POST /api/graph/relationships/:id/curate { action: 'correct', correctedRelationType: 'PREREQUISITE_FOR' }
    API->>CurateSvc: applyCuration(edgeId, payload)
    CurateSvc->>Graph: getEdge(edgeId)
    CurateSvc->>Audit: recordMutation({ before: edge, action: 'edge_curate_correct' })
    Audit->>Stream: Append JSONL record
    CurateSvc->>Graph: updateEdge(edgeId, { relationType: 'PREREQUISITE_FOR', curationStatus: 'corrected' })
    Graph->>Graph: Save atomic graph.json
    API-->>Canvas: { ok: true, updatedEdge }
    Canvas->>Canvas: Edge style updates to solid purple with 'Corrected' indicator
```

---

### 3. Audit Trail Inspection & Rollback Sequence

```mermaid
sequenceDiagram
    autonumber
    participant User as User (UI)
    participant Modal as VersionHistoryModal
    participant API as Express API
    participant Audit as AuditService
    participant Graph as GraphStore
    participant Stream as audit_log.jsonl

    User->>Modal: Clicks "Version History & Audit Log"
    Modal->>API: GET /api/graph/audit-log
    API->>Audit: getHistory({ limit: 50 })
    Audit->>Stream: Read recent events
    Audit-->>API: Return audit records list
    API-->>Modal: Display chronological timeline
    User->>Modal: Clicks [ Revert Action ] on specific event
    Modal->>API: POST /api/graph/audit-log/:id/rollback
    API->>Audit: rollback(auditId)
    Audit->>Graph: Apply beforeState (restore previous edge/claim/entity)
    Audit->>Stream: Append new 'rollback' audit event
    Graph->>Graph: Save atomic graph.json
    API-->>Modal: { ok: true, restoredState }
    Modal->>User: Toast notification "Change reverted successfully"
```

---

## Data Flow & Storage Architecture

1. **Graph Store Persistence (`data/graph.json`)**:
   - Atomic file swap (`fs.writeFileSync` to `.tmp` file, followed by `fs.renameSync` with exponential retry for Windows file locks).
   - In-memory indices:
     - `Map<entityId, Set<edgeId>>` for fast traversal.
     - `Map<curationStatus, Set<edgeId>>` for sub-millisecond filtering by status (`verified`, `rejected`, `proposed`, `corrected`).
2. **Contradiction Persistence (`data/contradictions.json`)**:
   - Stores active and dismissed contradiction alerts with evidence links.
3. **Immutable Audit Stream (`data/audit_log.jsonl`)**:
   - Append-only newline-delimited JSON stream.
   - Every line contains a cryptographic or UUID identifier, ISO timestamp, actor, action name, target type/ID, and explicit `beforeState` and `afterState` JSON objects.
   - Guarantees complete recovery and historical state replay without modifying historical log lines.
