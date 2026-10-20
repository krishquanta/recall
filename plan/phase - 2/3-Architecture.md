# Architecture Design — Software / System Architecture (Phase 2)
> **How Knowledge Graph, Entity Resolution, Provenance, and Review Systems fit into Recall**

---

## Component Diagram

```mermaid
flowchart TD
    subgraph Client["Recall Browser Client (React 18 + TypeScript)"]
        Chat["Chat & Q&A Panel"]
        Preview["Source Preview Panel (Quote Highlighting)"]
        GraphViz["Knowledge Graph Visualizer (React Flow / Canvas)"]
        ReviewQueueUI["Entity Match Review Queue Modal"]
    end

    subgraph API["Express API Server (Port 3001)"]
        direction TB
        R_Upload["/api/upload (Ingestion Pipeline)"]
        R_Graph["/api/graph (Nodes, Edges, Subgraphs)"]
        R_Queue["/api/graph/review-queue (Pending Merges)"]
        R_Resolve["/api/graph/review-queue/:id/resolve"]
        R_AskGraph["/api/graph/ask (Graph-Augmented RAG)"]
    end

    subgraph Pipeline["Phase 2 Processing Pipeline"]
        direction TB
        Chunks["Extracted Chunks (from Phase 1)"]
        ExtractSvc["GraphExtractionService\n(Gemini Structured Output)"]
        DedupEngine["DeduplicationEngine\n(Lexical + Cosine Embedding)"]
        ReviewMgr["ReviewQueueService\n(Uncertain match buffer)"]
        ProvenanceValidator["ProvenanceValidator\n(DoD Verification: 100% Quote Traceability)"]
    end

    subgraph Storage["File-Backed Local Storage"]
        MetaStore["metadata.json (Docs)"]
        VectorStore["vectors.json (Embeddings)"]
        GraphStore["graph.json (Entities, Claims, Edges, Evidence)"]
        ReviewStore["review_queue.json (Pending Human Review)"]
    end

    Chunks --> ExtractSvc
    ExtractSvc --> ProvenanceValidator
    ProvenanceValidator -->|Valid Evidence Anchors| DedupEngine
    ProvenanceValidator -.->|Missing Evidence Rejected| ErrorLog["Quarantine Log"]
    
    DedupEngine -->|High Conf ≥ 0.92| GraphStore
    DedupEngine -->|Uncertain 0.78-0.92| ReviewMgr
    ReviewMgr --> ReviewStore
    
    ReviewQueueUI -->|Approve / Reject / Redirect| R_Resolve
    R_Resolve --> ReviewMgr
    ReviewMgr --> GraphStore

    GraphStore --> R_Graph
    R_Graph --> GraphViz
    GraphViz -->|Click Node / Edge| Preview
    Chat --> R_AskGraph
    R_AskGraph --> GraphStore
```

---

## Detailed Ingestion & Extraction Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Chunker as ChunkingService (Phase 1)
    participant Extractor as GraphExtractionService
    participant LLM as Gemini API (JSON Schema)
    participant Provenance as ProvenanceValidator
    participant Dedup as DeduplicationEngine
    participant Graph as GraphStore
    participant Queue as ReviewQueueService

    Chunker->>Extractor: processChunk(chunk)
    Extractor->>LLM: generateObject(chunk.text, ExtractionSchema)
    LLM-->>Extractor: { entities, claims, relationships }
    
    Extractor->>Provenance: validateEvidence(rawChunk, extractedData)
    Note over Provenance: Enforces DoD: Exact quote match<br/>in chunk.text + page/row/line stamp
    Provenance-->>Extractor: validatedPayload (100% anchored)

    Extractor->>Dedup: resolveEntities(validatedPayload.entities)
    loop For each entity
        Dedup->>Dedup: Lexical & Embedding Match Check
        alt Exact/High match (score >= 0.92)
            Dedup->>Graph: Merge alias & link existing entityId
        else Uncertain match (0.78 <= score < 0.92)
            Dedup->>Queue: Enqueue match candidate { entityA, entityB, score, context }
            Dedup->>Graph: Create provisional entity marked pending_review
        else New entity (score < 0.78)
            Dedup->>Graph: Insert new EntityNode
        end
    end

    Extractor->>Graph: Insert Claims & Typed Edges with EvidenceRef
```

---

## Data Schema & Storage Architecture

### 1. `EntityNode`
```typescript
export type EntityType = 
  | 'Concept' 
  | 'Method' 
  | 'Formula' 
  | 'Theorem' 
  | 'Property' 
  | 'Dataset' 
  | 'Person';

export interface EntityNode {
  id: string;                      // Canonical UUID
  name: string;                    // Normalized canonical name
  type: EntityType;
  description?: string;
  aliases: string[];               // e.g. ["SVD", "Singular Value Decomposition"]
  embedding?: number[];            // 768-dim float for deduplication lookup
  status: 'active' | 'pending_review' | 'merged';
  mergedIntoId?: string;           // Pointer if merged
  evidence: EvidenceRef[];         // References to passages defining/mentioning entity
  createdAt: number;
  updatedAt: number;
}
```

### 2. `ClaimNode`
```typescript
export type ClaimModality = 'Fact' | 'Definition' | 'Hypothesis' | 'Rule';

export interface ClaimNode {
  id: string;
  subjectEntityId: string;         // Primary subject entity
  claimText: string;               // Normalized claim statement
  modality: ClaimModality;
  confidence: number;              // 0.0 to 1.0
  evidence: EvidenceRef;           // DoD: Mandatory single source passage
  createdAt: number;
}
```

### 3. `RelationshipEdge`
```typescript
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

export interface RelationshipEdge {
  id: string;                      // Edge UUID
  sourceId: string;                // Source EntityNode ID
  targetId: string;                // Target EntityNode ID
  relationType: RelationType;
  description: string;             // Descriptive sentence of the relation
  confidence: number;
  evidence: EvidenceRef;           // DoD: Verifiable link to passage
  claimId?: string;                // Optional link to supporting ClaimNode
  createdAt: number;
}
```

### 4. `EvidenceRef` (The Definition of Done Anchor)
```typescript
export interface EvidenceRef {
  docId: string;
  chunkId: string;
  filename: string;
  page?: number;                   // For PDFs & Word docs
  slide?: number;                  // For PPTX slides
  sheet?: string;                  // For Excel sheets
  rowStart?: number;               // For Excel rows
  lineStart?: number;              // For Markdown & Text
  exactQuote: string;              // Verbatim substring extracted from chunk.text
  charOffset?: { start: number; end: number };
}
```

### 5. `ReviewQueueItem`
```typescript
export interface ReviewQueueItem {
  id: string;
  candidateEntity: {
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
  similarityScore: number;         // Cosine similarity
  status: 'pending' | 'accepted' | 'rejected';
  resolvedAt?: number;
}
```

---

## API Endpoints (Phase 2 Additions)

| Route | Method | Payload / Query | Description |
|---|---|---|---|
| `/api/graph` | GET | `?docIds=&search=&limit=` | Retrieve full or filtered knowledge graph (nodes, edges, evidence summary) |
| `/api/graph/entities/:id` | GET | None | Get specific entity, all connected relationships, claims, and complete citations |
| `/api/graph/subgraph` | POST | `{ entityIds: string[], depth: number }` | 1-hop or 2-hop neighborhood expansion around selected concepts |
| `/api/graph/review-queue` | GET | `?status=pending` | List all unreviewed duplicate entity candidates |
| `/api/graph/review-queue/:id/resolve` | POST | `{ action: 'merge' \| 'separate' \| 'redirect', targetEntityId?: string }` | Resolve an uncertain candidate match; automatically repoints edges and consolidates evidence |
| `/api/graph/reindex` | POST | `{ docId?: string }` | Trigger entity/claim/relation extraction on existing or specified documents |
