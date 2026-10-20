# TRD — Technical Requirements Document (Phase 2)
> **Technical requirements, constraints, schemas, integrations, and performance**

---

## Functional Requirements

- **FR-1 Extraction Engine**: The system SHALL analyze text chunks processed in Phase 1 and extract:
  - **Entities**: `{ name, type: Concept | Method | Formula | Theorem | Property | Dataset | Person, aliases: string[] }`
  - **Claims**: `{ claimText, modality: Fact | Definition | Hypothesis | Rule, confidence: number }`
  - **Relationships**: `{ sourceEntityId, targetEntityId, relationType, description, confidence }`
- **FR-2 Provenance Anchor (Definition of Done)**:
  - Every extracted entity instance, claim, and relationship MUST store an `evidence` record containing:
    ```typescript
    interface EvidenceRef {
      chunkId: string;
      docId: string;
      filename: string;
      page?: number;
      slide?: number;
      sheet?: string;
      rowStart?: number;
      lineStart?: number;
      exactQuote: string;
      charOffset?: { start: number; end: number };
    }
    ```
  - Validation Strategy: Hybrid exact matching with normalized sliding window alignment. The system attempts verbatim substring match first; if minor punctuation/whitespace varies, it locates the exact substring window in the source chunk to record the true verbatim text and character offsets. Any relationship that cannot be grounded in the source text is rejected before entering the active graph.
- **FR-3 Typed Relationship Ontology**:
  - The extraction schema SHALL enforce controlled relation types:
    - `DEFINES` (definitional relationship)
    - `IS_A` (taxonomic specialization / categorization)
    - `PART_OF` (composition / structural decomposition)
    - `PREREQUISITE_FOR` (pedagogical order / dependency)
    - `CAUSES` (causality or production of effects)
    - `USES` (methodological application)
    - `CONTRADICTS` (conflicting assertions or disproof)
    - `PROVES` (evidential support / theorem proof)
    - `EQUIVALENT_TO` (conceptual identity / isomorphism)
    - `RELATED_TO` (general association)
- **FR-4 Entity Resolution & Deduplication Pipeline**:
  - **Stage 1 (Exact & Lexical)**: Lowercase, punctuation removal, lemmatization, and parenthetical acronym expansions (e.g., "Singular Value Decomposition (SVD)").
  - **Stage 2 (Semantic Embedding)**: Cosine similarity between entity name embeddings (`text-embedding-004`).
    - Score ≥ 0.92: Automatic merge under canonical entity with aliases recorded.
    - 0.78 ≤ Score < 0.92: Flagged as `UNCERTAIN` and dispatched to the Review Queue. Candidate is displayed in the graph as a provisional node with a dashed border / 'Unreviewed' badge so relationships can be immediately explored.
    - Score < 0.78: Kept distinct as separate entities.
- **FR-5 Review Queue Management**:
  - Store pending merges in `data/review_queue.json`.
  - Provide REST endpoints `GET /api/graph/review-queue`, `POST /api/graph/review-queue/:id/resolve` (accept, reject, or assign custom target).
  - Merging an entity MUST update all incident edges and merge their respective evidence lists without data loss.
- **FR-6 Graph Persistence & Indexing**:
  - Persist graph nodes, edges, claims, and evidence references locally in `data/graph.json` with ACID-safe atomic file writing (identical to `MetadataStore` & `VectorStore`).
  - In-memory adjacency list index for sub-millisecond graph queries and traversal.
  - Automatic background backfill on server startup: Detects documents in `metadata.json` that lack graph extraction and extracts them silently in the background.
- **FR-7 Visual Graph & Review UI**:
  - Web UI SHALL provide:
    1. **Graph Exploration Tab / Overlay**: React Flow (`@xyflow/react`) with custom optimized node and edge renderers.
    2. **Evidence Drawer**: Clicking an edge or claim node highlights the exact quote in the Phase 1 `PreviewPanel`.
    3. **Resolution Modal**: Dedicated UI banner/badge showing unreviewed matches with one-click "Merge" or "Keep Separate" buttons.
    4. **Hybrid Chat Synergy**: Chat responses incorporate 1-hop graph relations, rendering clickable relation chips `[🔗 A → USES → B]` that open evidence in the Preview Panel.

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Provenance Integrity | 100% of persisted relationships link to a valid `EvidenceRef` with non-empty `exactQuote` |
| Extraction Throughput | ≤ 2.5s per chunk (Gemini 2.0 / 3.8 Flash structured JSON mode) |
| Deduplication Latency | ≤ 50ms per entity candidate comparison against existing graph (using vector indexing) |
| Persistence Reliability | Zero corruption on power failure or app crash (atomic temp-file swap with Windows retry) |
| Review Action Response | UI reflects merge / split updates within 100ms |
| Scalability | Up to 10,000 nodes, 30,000 edges per study bank |

---

## Technology Stack Extensions

| Layer | Technology | Reason |
|-------|-----------|--------|
| Structured LLM Extraction | Gemini API (`gemini-2.0-flash` / `gemini-3.8-flash`) with JSON Schema `responseSchema` | Guaranteed type-safe JSON extraction matching TypeScript interfaces |
| Graph Data Structures & Storage | Custom file-backed JSON Graph Store (`GraphStore.ts`) | Zero native binary dependencies, runs out of the box on Windows/macOS/Linux, fully inspectable |
| Embedding Deduplication | Cosine similarity via existing `EmbeddingService` | Reuses existing `text-embedding-004` pipeline with mock fallback |
| In-Memory Graph Index | Adjacency index + lookup tables | High speed 1-hop/2-hop neighborhood expansion for UI and RAG |
| Frontend Graph Rendering | `@xyflow/react` (React Flow) or `cytoscape` | Lightweight, interactive node/edge inspection with customizable HTML cards |
| State Management | Zustand (`graphStore.ts`) | Seamless integration with existing `appStore` and `useAppStore` |
