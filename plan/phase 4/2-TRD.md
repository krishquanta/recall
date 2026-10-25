# TRD — Technical Requirements Document (Phase 4)
> **Autonomous Research Agent, Gap Investigation & Bounded Web Discovery**

---

## 1. Functional Requirements (FRs)

### FR-1: Knowledge Gap & Question Formulation Engine
- **FR-1.1**: The system must evaluate the active Knowledge Graph in `data/graph.json` and `data/contradictions.json` against four distinct gap heuristics:
  1. *Unresolved Contradictions*: Entities tied to active `ContradictionAlert` items (status `'active'`) in `ContradictionStore`.
  2. *Stale Claims*: `ClaimNode` records with `isStale: true` or temporal tags older than the latest document revision.
  3. *Weakly Grounded Entities*: `EntityNode` entries with degree centrality $< 2$ (fewer than 2 active, non-rejected relationship edges).
  4. *Single-Source Claims*: Important entity claims grounded in only one chunk from one document without cross-document corroboration.
- **FR-1.2**: Each detected gap must be assigned a priority score ($S \in [0.0, 1.0]$) and transformed into a specific, answerable research prompt (e.g., *"What is the time complexity of Fibonacci heap decrease-key in Dijkstra's algorithm?"*).
- **FR-1.3**: The engine must support on-demand question submission from users for arbitrary concepts or entities.

### FR-2: Multi-Source Bounded Web & Academic Search
- **FR-2.1**: **Discovery Layer (DuckDuckGo)**: The search engine queries DuckDuckGo HTML/Lite interface to retrieve candidate URLs, appending site constraints based on active allowlists when appropriate (e.g. `site:wikipedia.org OR site:arxiv.org`).
- **FR-2.2**: **Academic Source Layer (Wikipedia REST API & arXiv API)**:
  - Wikipedia: Queries `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` and sections API for clean, formatted encyclopedic entries.
  - arXiv: Queries `http://export.arxiv.org/api/query?search_query=all:{query}&start=0&max_results=3` to extract paper titles, abstracts, authors, and publication dates.
- **FR-2.3**: **Budget Enforcer**: A research task is bounded by:
  - `maxQueries`: Default 3 queries per task.
  - `maxSources`: Default 5 fetched documents.
  - `maxExecutionTimeMs`: 120,000 ms (2 minutes).
  - `maxRedirectsPerUrl`: 3 redirects.
  Every query, redirect, and page fetch must decrement the task budget counter. If any limit is reached, execution must cleanly finalize with available sources (graceful degradation, not hard crash).

### FR-3: Security, SSRF Prevention & Sanitization
- **FR-3.1**: **Hostname Allowlist Enforcement**:
  - Default allowlist: `en.wikipedia.org`, `wikipedia.org`, `export.arxiv.org`, `arxiv.org`, `*.edu`, `*.gov`, `pubmed.ncbi.nlm.nih.gov`, `nih.gov`.
  - Configurable at runtime via `GET/PUT /api/settings/research` (persisted in `data/research_settings.json`).
  - No external fetch may proceed unless the target hostname exactly matches or is a subdomain of an allowlisted domain.
- **FR-3.2**: **SSRF Protection & Private IP Blocking**:
  - Before initiating any HTTP request (and on every 3xx redirect), the destination IP address must be resolved via DNS.
  - The resolved IP must be rejected immediately if it falls into:
    - Loopback: `127.0.0.0/8`, `::1`
    - Private IPv4 (RFC 1918): `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
    - Link-local: `169.254.0.0/16`, `fe80::/10`
    - Carrier-grade NAT: `100.64.0.0/10`
    - Cloud metadata: `169.254.169.254` (AWS/GCP instance metadata)
    - Localhost names: `localhost`, `*.localhost`, `local`, `*.local`
- **FR-3.3**: **Untrusted Content Sanitization & Prompt Injection Defense**:
  - HTML content is stripped of scripts, styles, iframes, and hidden tags using strict text extraction.
  - The extracted text is treated strictly as data within an isolated prompt delimiter (e.g., `<UNTRUSTED_EXTERNAL_DATA>...</UNTRUSTED_EXTERNAL_DATA>`).
  - System instructions must explicitly instruct the LLM to ignore meta-instructions, role overrides, or directives embedded inside the retrieved text.

### FR-4: Sourced Report & "What Changed and Why" Generator
- **FR-4.1**: The LLM synthesizes retrieved findings into a structured `SourcedResearchReport`:
  - `question`: The core investigation prompt.
  - `summary`: Concise executive summary of the findings.
  - `detailedAnalysis`: In-depth breakdown with numbered citations.
  - `sources`: List of external sources with title, URL, retrieval timestamp, and domain.
  - `whatChangedAndWhy`: Dedicated delta explanation highlighting what was missing or contradictory in the local knowledge base and why each proposed update resolves it.
- **FR-4.2**: Extract structured candidate graph updates (`proposedEntities`, `proposedRelations`, `resolvedContradictions`). Every proposed item must include verbatim quote evidence from the retrieved external text.

### FR-5: Staged Review & Interactive Human-in-the-Loop Curation
- **FR-5.1**: Proposed updates are held in a dedicated in-memory `ResearchProposalStore` (Map<proposalId, ResearchProposal>), NOT in the existing `ReviewStore` (which handles entity dedup review queue items).
- **FR-5.2**: The user can:
  - Toggle acceptance on individual entities, relations, and contradiction resolutions.
  - Edit proposed relation types or descriptions before accepting.
  - Click `[Import Accepted Updates]` to commit selected items.
  - Click `[Discard / Reject All]` to abort without modifying the graph.
- **FR-5.3**: Proposals expire and are cleaned up after 30 minutes of inactivity.

### FR-6: Hybrid Ingestion & Audit Rollback
- **FR-6.1**: **Dossier Document Ingestion**:
  - Upon user import, a synthetic markdown document is generated and saved at `uploads/research_<id>.md`.
  - Registered in `MetadataStore` as a `Document` with a new optional field `sourceType: 'web'`, plus `sourceUrl` and `retrievedAt` metadata.
  - Processed through `ChunkingService`, embedded via `EmbeddingService`, and indexed in `VectorStore` and `KeywordIndex` — using the same pipeline as uploaded documents.
- **FR-6.2**: **Graph Mutation via Entity Name Resolution**:
  - Accepted entities are resolved against existing `GraphStore` entities by normalized name/alias matching using `GraphStore.findEntityByName()` to prevent duplicates.
  - New entities that don't match existing entries are inserted. Existing entities gain new claims and evidence.
  - Each accepted relation is inserted via `GraphStore.addEdge()` using the resolved source/target entity IDs (not names).
  - Each item carries a standard `EvidenceRef` referencing the research dossier's `docId`, `chunkId`, and `exactQuote`.
- **FR-6.3**: **Atomic Audit Transaction**:
  - A new `AuditActionType` value `'research_import'` is added to the existing union in `backend/src/types/audit.ts`.
  - A new `AuditTargetType` value `'research'` is added.
  - A single compound audit event is written to `data/audit_log.jsonl` with `beforeState` capturing the pre-import graph slice and `afterState` capturing all additions.
  - Invoking rollback on this audit event cleanly deletes the added graph elements and un-indexes the research document from `MetadataStore`, `VectorStore`, and `KeywordIndex`.

---

## 2. Non-Functional Requirements (NFRs)

| Category | Requirement | Target Metric |
|----------|-------------|---------------|
| **Execution Safety** | Hard limits on web search and retrieval | Max 3 queries, max 5 sources, 120s timeout, max 3 redirects per URL |
| **Security & SSRF** | Validation of domain allowlist and private network addresses | 0% private network requests permitted; cloud metadata endpoints blocked |
| **Grounding Precision** | 100% of imported entities and relations must have `EvidenceRef` with `docId`, `chunkId`, and `exactQuote` | 0% hallucinations or ungrounded claims |
| **Memory & Storage** | Maximum storage footprint per research task dossier | $\le 200 \text{ KB}$ per research dossier markdown file |
| **Resilience & Key Pool** | Integration with Gemini `KeyManager` for all LLM calls | Automatic round-robin and 429 exponential backoff via existing `KeyManager` |
| **Audit Traceability** | Reversibility of every imported research task | 100% reversible via atomic `AuditService` rollback |
| **Graceful Degradation** | Partial results returned if budget exhausted | Report synthesizes from whatever sources were retrieved within limits |

---

## 3. Domain Schemas & TypeScript Interfaces

### Research Task & Gap Models (`backend/src/types/research.ts` [NEW])

```typescript
export type GapType = 'CONTRADICTION' | 'STALE_CLAIM' | 'WEAK_GROUNDING' | 'ISOLATED_ENTITY' | 'USER_QUERY';

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
  type: string;            // Must match EntityType values: 'Concept' | 'Method' | 'Theorem' | etc.
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
  relationType: string;    // Must match RelationType values
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
```

### Research Settings (`backend/src/types/research.ts`, appended)

```typescript
export interface ResearchSettings {
  approvedDomains: string[];   // e.g. ['wikipedia.org', 'arxiv.org', '*.edu', '*.gov']
  maxQueriesPerTask: number;   // default: 3
  maxSourcesPerTask: number;   // default: 5
  maxExecutionTimeMs: number;  // default: 120000
  enableDuckDuckGo: boolean;   // default: true
  enableWikipediaApi: boolean; // default: true
  enableArxivApi: boolean;     // default: true
}
```

### Existing Type Extensions Required

#### `backend/src/types/audit.ts` [MODIFY]
```typescript
// Add to AuditActionType union:
| 'research_import'

// Add to AuditTargetType union:
| 'research'
```

#### `backend/src/types/index.ts` [MODIFY]
```typescript
// Extend Document interface:
export interface Document {
  // ... existing fields ...
  sourceType?: 'upload' | 'web';  // NEW — defaults to 'upload' for existing docs
  sourceUrl?: string;              // NEW — canonical URL for web research dossiers
  retrievedAt?: string;            // NEW — ISO 8601 retrieval timestamp
}
```

#### `frontend/src/types/index.ts` [MODIFY]
```typescript
// Mirror the Document extension:
export interface Document {
  // ... existing fields ...
  sourceType?: 'upload' | 'web';
  sourceUrl?: string;
  retrievedAt?: string;
}

// Add Phase 4 types (or import shared types):
// InvestigationGap, ResearchProposal, ProposedEntity, ProposedRelation, etc.
```

---

## 4. Verification Criteria & Constraints

1. **Automated Testing** (all tests in `backend/test/` directory following existing conventions):
   - Unit tests (`backend/test/unit/UrlSecurityValidator.test.ts`): Validate hostname allowlist matching (`wikipedia.org`, `subdomain.arxiv.org`, `mit.edu`), verify exact blocking of loopback (`127.0.0.1`), RFC 1918 private subnets (`10.0.0.1`, `192.168.1.1`), carrier-grade NAT (`100.64.0.1`), and cloud metadata endpoints (`169.254.169.254`).
   - Unit tests (`backend/test/unit/SearchManager.test.ts`): Validate budget enforcement — query count, source count, and execution time limits cleanly abort additional fetches with partial results.
   - Unit tests (`backend/test/unit/GapDetectionService.test.ts`): Validate detection of orphan entities, stale claims, single-source claims, and active contradictions.
   - Integration tests (`backend/test/integration/ResearchOrchestrator.test.ts`): Mock web responses, verify synthesis of `SourcedResearchReport`, verify extraction of `proposedEntities` and `proposedRelations` with exact verbatim quotes present in the source text.
   - Integration tests (`backend/test/integration/ResearchImport.test.ts`): Verify that accepting proposed updates:
     - Resolves proposed entity names against existing `GraphStore` entities (dedup).
     - Adds new nodes/edges to `GraphStore` with valid `EvidenceRef`.
     - Creates a web document in `MetadataStore` with `sourceType: 'web'` and indexes chunks in `VectorStore`.
     - Logs an atomic `research_import` event to `AuditStore`.
     - Can be completely reverted with rollback (entities, edges, document, vector entries all removed).
2. **Compile-Time Constraints**:
   - Zero TypeScript compiler errors with `pnpm --prefix backend build` and `pnpm --prefix frontend build`.
   - All tests pass via `pnpm --prefix backend test --run`.
