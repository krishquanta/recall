# SDD — Software Design Document (Phase 2)
> **How the Phase 2 software will be structured, typed, and implemented**

---

## Directory & File Additions

```
recall/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   └── graph.ts                 ← [NEW] GET /api/graph, GET review-queue, POST resolve
│   │   ├── services/
│   │   │   ├── GraphExtractionService.ts← [NEW] Gemini structured entity/claim/relation extractor
│   │   │   ├── DeduplicationService.ts  ← [NEW] Lexical + embedding deduplication & queue router
│   │   │   ├── ProvenanceValidator.ts   ← [NEW] Enforces 100% quote match & origin metadata (DoD)
│   │   │   └── ReviewQueueService.ts    ← [NEW] Review queue CRUD & merge resolution engine
│   │   ├── store/
│   │   │   ├── GraphStore.ts            ← [NEW] Local file-backed atomic JSON store for graph data
│   │   │   └── ReviewStore.ts           ← [NEW] Local file-backed store for uncertain matches
│   │   ├── types/
│   │   │   ├── index.ts                 ← [EXTEND] Add EntityNode, ClaimNode, RelationshipEdge, EvidenceRef
│   │   │   └── graph.ts                 ← [NEW] Comprehensive graph domain interfaces
│   │   └── index.ts                     ← [MODIFY] Mount /api/graph routes and rehydration
│   └── data/
│       ├── graph.json                   ← Persisted entities, edges, claims, and evidence
│       └── review_queue.json            ← Persisted pending candidate matches
│
└── frontend/
    ├── src/
    │   ├── api/
    │   │   └── client.ts                ← [EXTEND] fetchGraph, fetchReviewQueue, resolveQueueItem
    │   ├── components/
    │   │   ├── Graph/
    │   │   │   ├── GraphCanvas.tsx      ← [NEW] Interactive force/canvas layout
    │   │   │   ├── GraphNodeCard.tsx    ← [NEW] Styled entity node with type icon & alias count
    │   │   │   ├── GraphControls.tsx    ← [NEW] Zoom, center, filter by type/relation
    │   │   │   └── ReviewQueueModal.tsx ← [NEW] Side-by-side comparison modal for candidate merges
    │   │   ├── Preview/
    │   │   │   └── EvidenceCard.tsx     ← [NEW] Right panel display for exact edge/claim quote
    │   │   └── Header/
    │   │       └── ViewModeSelector.tsx ← [NEW] Chat vs Graph toggle & Review Queue counter
    │   ├── store/
    │   │   ├── appStore.ts              ← [EXTEND] activeView ('chat' | 'graph'), selectedEdge
    │   │   └── graphStore.ts            ← [NEW] Zustand store for nodes, edges, review queue items
    │   └── App.tsx                      ← [MODIFY] Render GraphCanvas when activeView === 'graph'
```

---

## Detailed Component Specifications

### 1. `GraphExtractionService.ts`
Uses Gemini structured JSON outputs (`gemini-2.0-flash` or `gemini-3.8-flash`) with a strict schema.
```typescript
export interface ExtractedGraphPayload {
  entities: Array<{
    name: string;
    type: EntityType;
    aliases: string[];
    mentionQuote: string;
  }>;
  claims: Array<{
    subjectEntityName: string;
    claimText: string;
    modality: ClaimModality;
    confidence: number;
    exactQuote: string;
  }>;
  relationships: Array<{
    sourceEntityName: string;
    targetEntityName: string;
    relationType: RelationType;
    description: string;
    confidence: number;
    exactQuote: string;
  }>;
}
```
**System Prompt Design**:
- Instructs the model to extract canonical names, identify the exact verbatim supporting sentence from the input passage without paraphrasing, and reject hallucinations.
- Runs concurrently or immediately following Phase 1 `ChunkingService`.

---

### 2. `ProvenanceValidator.ts` (Definition of Done Enforcement)
Validates that every single extracted entity, claim, and relationship passes the **Evidence Invariance Check**:
```typescript
export class ProvenanceValidator {
  public static validateAndAnchor(
    chunk: Chunk, 
    payload: ExtractedGraphPayload
  ): ValidatedGraphPayload {
    const rawText = chunk.text;
    
    // 1. Filter relationships: exactQuote must exist verbatim in chunk text
    const validatedRelations = payload.relationships.filter(rel => {
      if (!rel.exactQuote || rel.exactQuote.trim().length === 0) return false;
      return rawText.includes(rel.exactQuote.trim());
    }).map(rel => ({
      ...rel,
      evidence: {
        docId: chunk.metadata.docId,
        chunkId: chunk.chunkId,
        filename: chunk.metadata.filename,
        page: chunk.metadata.page,
        slide: chunk.metadata.slide,
        sheet: chunk.metadata.sheet,
        rowStart: chunk.metadata.rowStart,
        lineStart: chunk.metadata.lineStart,
        exactQuote: rel.exactQuote.trim(),
        charOffset: {
          start: rawText.indexOf(rel.exactQuote.trim()),
          end: rawText.indexOf(rel.exactQuote.trim()) + rel.exactQuote.trim().length
        }
      }
    }));

    // Same rigorous validation for claims and entities
    // ...
    return { ... };
  }
}
```
If `rawText.includes(exactQuote)` fails (e.g. LLM paraphased slightly), a fuzzy-window locator finds the exact substring or quarantines the edge. **No relationship enters the active graph without a certified `EvidenceRef`.**

---

### 3. `DeduplicationService.ts`
Two-tier resolution engine:
1. **Tier 1 (Lexical & Normalization)**:
   - Normalize string: lower-cased, whitespace collapsed, punctuation stripped.
   - Acronym detection: `RegExp(/\b([A-Z]{2,6})\b/)` checked against initial letters of multi-word entities.
   - If exact match with an existing entity or its registered aliases, return existing entity ID.
2. **Tier 2 (Embedding Cosine Similarity)**:
   - Compute embedding of candidate entity name via `EmbeddingService`.
   - Calculate cosine similarity against all existing entity embeddings.
   - Decision matrix:
     - **$\ge 0.92$**: Automatic merge. Append alias to existing entity, add new evidence ref.
     - **$0.78 \le s < 0.92$**: Uncertain match. Push to `ReviewQueueService`. Mark candidate node as `pending_review`.
     - **$< 0.78$**: Unique entity. Create new active node.

---

### 4. `GraphStore.ts`
Thread-safe, atomic local file persistence (`data/graph.json`).
- Stores `{ nodes: Record<string, EntityNode>, edges: Record<string, RelationshipEdge>, claims: Record<string, ClaimNode> }`.
- Maintains in-memory adjacency index:
  - `incomingEdges: Map<string, string[]>`
  - `outgoingEdges: Map<string, string[]>`
  - `nameToEntityId: Map<string, string>`
- Supports atomic rewrites via temporary files with Windows lock retry handling (identical to `MetadataStore`).

---

### 5. `ReviewQueueService.ts`
Handles human-in-the-loop decisions:
- `getPendingItems()`: Returns items waiting for human confirmation.
- `resolve(itemId, 'merge' | 'separate' | 'redirect', targetEntityId)`:
  - **`merge`**: Reassigns candidate's edges and claims to the target entity, registers candidate name in target's `aliases`, marks item resolved.
  - **`separate`**: Converts candidate from `pending_review` to fully `active` independent entity.
  - **`redirect`**: User selects a different entity from the graph to merge into.
