# SDD — Software Design Document (Phase 4)
> **Autonomous Research Agent, Gap Investigation & Bounded Web Discovery**

---

## 1. Directory & File Inventory

### Backend — New Files
| Status | Path | Purpose |
|--------|------|---------|
| `[NEW]` | `backend/src/types/research.ts` | TypeScript interfaces for gaps, budgets, reports, proposals, web sources, and research settings. |
| `[NEW]` | `backend/src/services/UrlSecurityValidator.ts` | Hostname allowlist verification, DNS lookup, SSRF/private IP blocking, and HTML sanitization. |
| `[NEW]` | `backend/src/services/SearchManager.ts` | Unified web discovery orchestrating DuckDuckGo, Wikipedia REST API, and arXiv API clients. |
| `[NEW]` | `backend/src/services/GapDetectionService.ts` | Heuristic graph topology gap analyzer (contradictions, stale claims, isolated nodes). |
| `[NEW]` | `backend/src/services/ResearchOrchestratorService.ts` | Multi-turn bounded research loop, budget enforcement, LLM report synthesis, proposal extraction. |
| `[NEW]` | `backend/src/services/ResearchImportService.ts` | Commits accepted proposals into GraphStore, generates synthetic dossier document, indexes into VectorStore. |
| `[NEW]` | `backend/src/store/ResearchProposalStore.ts` | In-memory Map<proposalId, ResearchProposal> with 30-minute TTL expiry. NOT shared with `ReviewStore`. |
| `[NEW]` | `backend/src/routes/research.ts` | REST API router for `/gaps`, `/investigate`, `/proposals/:id`, `/import`, and `/reject`. |
| `[NEW]` | `backend/test/unit/UrlSecurityValidator.test.ts` | SSRF blocking, allowlist matching, IP range validation. |
| `[NEW]` | `backend/test/unit/SearchManager.test.ts` | Budget enforcement, DuckDuckGo/Wikipedia/arXiv client mocks. |
| `[NEW]` | `backend/test/unit/GapDetectionService.test.ts` | Graph gap heuristics (orphan nodes, stale claims, contradictions). |
| `[NEW]` | `backend/test/integration/ResearchOrchestrator.test.ts` | End-to-end orchestration with mocked HTTP. |
| `[NEW]` | `backend/test/integration/ResearchImport.test.ts` | Import + rollback atomicity, entity dedup, vector indexing. |

### Backend — Modified Files
| Status | Path | Change Description |
|--------|------|--------------------|
| `[MODIFY]` | `backend/src/types/audit.ts` | Add `'research_import'` to `AuditActionType` union; add `'research'` to `AuditTargetType` union. |
| `[MODIFY]` | `backend/src/types/index.ts` | Extend `Document` interface with optional `sourceType`, `sourceUrl`, `retrievedAt`; re-export `research.ts`. |
| `[MODIFY]` | `backend/src/services/AuditService.ts` | Extend rollback handler to support `research_import` events (un-index dossier, remove graph elements). |
| `[MODIFY]` | `backend/src/routes/settings.ts` | Add `GET/PUT /api/settings/research` endpoints for domain allowlist and budget configuration. |
| `[MODIFY]` | `backend/src/index.ts` | Import and mount `researchRouter` at `/api/research`. |

### Frontend — New Files
| Status | Path | Purpose |
|--------|------|---------|
| `[NEW]` | `frontend/src/components/Research/InvestigationQueueModal.tsx` | Modal displaying ranked gap cards and custom investigation prompt input. |
| `[NEW]` | `frontend/src/components/Research/ResearchReviewDrawer.tsx` | Two-tab slide-over panel for Sourced Report and Interactive Staging Diff. |
| `[NEW]` | `frontend/src/components/Research/ResearchSettingsTab.tsx` | Settings tab for configuring approved domains and search budgets. |
| `[NEW]` | `frontend/src/components/Research/ResearchProgressPanel.tsx` | In-progress state with budget counters, discovered source log, and cancel button. |

### Frontend — Modified Files
| Status | Path | Change Description |
|--------|------|--------------------|
| `[MODIFY]` | `frontend/src/types/index.ts` | Add `Document.sourceType/sourceUrl/retrievedAt`; add `InvestigationGap`, `ResearchProposal`, `ProposedEntity`, `ProposedRelation`, `ProposedContradictionResolution` types. |
| `[MODIFY]` | `frontend/src/store/appStore.ts` | Add research state variables and actions. |
| `[MODIFY]` | `frontend/src/components/Header/ChatHeaderWithViewSelector.tsx` | Add `[ 🔍 Gaps (N) ]` trigger badge. |
| `[MODIFY]` | `frontend/src/components/Graph/GraphCanvas.tsx` | Add node context action `[ 🔍 Investigate Gaps ]`. |
| `[MODIFY]` | `frontend/src/components/Graph/ContradictionDrawer.tsx` | Add `[ 🔍 Research Consensus ]` button. |
| `[MODIFY]` | `frontend/src/components/Settings/SettingsModal.tsx` | Include Research Settings tab. |
| `[MODIFY]` | `frontend/src/components/Sidebar/DocumentList.tsx` | Show 🌐 globe icon for `sourceType: 'web'` documents. |
| `[MODIFY]` | `frontend/src/App.tsx` | Mount `InvestigationQueueModal` and `ResearchReviewDrawer`. |

### Persistence Files (Auto-Created at Runtime)
| Path | Format | Purpose |
|------|--------|---------|
| `data/research_settings.json` | JSON | Persisted research settings (approved domains, budgets, toggles). |
| `uploads/research_<id>.md` | Markdown | Synthetic research dossier document (indexed like uploaded files). |

---

## 2. Detailed Service Class Designs & Method Signatures

### A. `UrlSecurityValidator` (`backend/src/services/UrlSecurityValidator.ts`)

```typescript
export class UrlSecurityValidator {
  private allowedDomains: string[];

  constructor(allowedDomains?: string[]);

  /** Reload the allowlist from settings file or supplied array. */
  public updateAllowedDomains(domains: string[]): void;

  /**
   * Full pre-flight validation: scheme check, hostname allowlist, DNS resolution, SSRF IP blocking.
   * Returns { valid, reason, resolvedIp }.
   */
  public async validateUrl(rawUrl: string): Promise<{ valid: boolean; reason?: string; resolvedIp?: string }>;

  /**
   * Checks if a hostname matches an approved domain or wildcard (*.edu, *.gov).
   * Supports exact match and suffix match (e.g., 'en.wikipedia.org' matches allowlist entry 'wikipedia.org').
   */
  public isDomainAllowed(hostname: string): boolean;

  /**
   * Checks if an IP belongs to RFC 1918, RFC 4193, loopback, link-local, carrier-grade NAT,
   * or cloud metadata ranges.
   */
  public isPrivateOrReservedIp(ip: string): boolean;

  /**
   * Strips scripts, styles, iframes, noscript, hidden tags; extracts plain readable text.
   * Returns cleaned text string.
   */
  public sanitizeHtml(html: string): string;
}

// Default singleton, loaded from data/research_settings.json or built-in defaults:
export const urlSecurityValidator: UrlSecurityValidator;
```

### B. `SearchManager` (`backend/src/services/SearchManager.ts`)

```typescript
export class SearchManager {
  private securityValidator: UrlSecurityValidator;

  constructor(securityValidator?: UrlSecurityValidator);

  /**
   * Discovers candidate URLs via DuckDuckGo HTML/Lite search.
   * Respects budget counters. Validates each result URL before returning.
   */
  public async searchDuckDuckGo(
    query: string,
    budget: ResearchBudget,
    maxResults?: number
  ): Promise<Array<{ title: string; url: string; snippet: string }>>;

  /**
   * Fetches clean structured summary from Wikipedia REST API.
   * Calls https://en.wikipedia.org/api/rest_v1/page/summary/{title}.
   */
  public async fetchWikipediaSummary(
    pageTitleOrQuery: string,
    budget: ResearchBudget
  ): Promise<ResearchSource | null>;

  /**
   * Queries arXiv API for papers, abstracts, and publication dates.
   * Calls http://export.arxiv.org/api/query.
   */
  public async searchArxiv(
    query: string,
    budget: ResearchBudget,
    maxResults?: number
  ): Promise<ResearchSource[]>;

  /**
   * Safe fetcher: validates URL, checks SSRF, handles redirects (max 3),
   * decrements budget counters, sanitizes HTML, returns cleaned source.
   */
  public async safeFetchWebPage(
    targetUrl: string,
    budget: ResearchBudget
  ): Promise<ResearchSource | null>;
}

export const searchManager: SearchManager;
```

### C. `GapDetectionService` (`backend/src/services/GapDetectionService.ts`)

```typescript
import { graphStore } from '../store/GraphStore';
import { contradictionStore } from '../store/ContradictionStore';
import { metadataStore } from '../store/MetadataStore';

export class GapDetectionService {
  constructor(
    private graphStoreInstance?: GraphStore,
    private contradictionStoreInstance?: ContradictionStore,
    private metadataStoreInstance?: MetadataStore
  );

  /** Audits active graph and returns ranked gaps sorted by priorityScore descending. */
  public detectGaps(): InvestigationGap[];

  /** Formulates a targeted research prompt from a specific gap. */
  public formulateQuestionForGap(gap: InvestigationGap): string;

  /** Detects entities with degree < threshold (default 2, counting only non-rejected edges). */
  private findIsolatedEntities(minDegree?: number): InvestigationGap[];

  /** Finds ClaimNodes with isStale: true or from documents with older editions. */
  private findStaleClaims(): InvestigationGap[];

  /** Finds entities whose claims come from only a single document. */
  private findSingleSourceClaims(): InvestigationGap[];

  /** Wraps active ContradictionAlerts as investigation gaps. */
  private findUnresolvedContradictions(): InvestigationGap[];
}

export const gapDetectionService: GapDetectionService;
```

### D. `ResearchOrchestratorService` (`backend/src/services/ResearchOrchestratorService.ts`)

```typescript
export class ResearchOrchestratorService {
  constructor(
    private searchMgr?: SearchManager,
    private llmSvc?: LLMService,
    private proposalStore?: ResearchProposalStore
  );

  /**
   * Conducts a bounded research task:
   * 1. Generates search queries via LLM (max budget.maxQueries).
   * 2. Discovers and fetches sources via SearchManager (within budget).
   * 3. Synthesizes SourcedResearchReport via LLM (untrusted content isolated).
   * 4. Extracts ProposedEntity[] and ProposedRelation[] with verbatim evidence verification.
   * 5. Stores ResearchProposal in ProposalStore with status PENDING_REVIEW.
   * Returns the proposal.
   */
  public async executeTask(
    prompt: string,
    options?: {
      gapId?: string;
      maxQueries?: number;
      maxSources?: number;
      maxExecutionTimeMs?: number;
    }
  ): Promise<ResearchProposal>;

  /**
   * Verifies that every evidenceQuote in proposed items is a verbatim substring
   * of the corresponding source fullText. Items that fail are dropped.
   */
  private verifyVerbatimEvidence(
    proposals: { evidenceQuote: string; sourceId: string }[],
    sources: ResearchSource[]
  ): typeof proposals;
}

export const researchOrchestratorService: ResearchOrchestratorService;
```

### E. `ResearchProposalStore` (`backend/src/store/ResearchProposalStore.ts`)

```typescript
/**
 * In-memory store for research proposals pending user review.
 * Separate from ReviewStore (which handles entity dedup queue).
 * Proposals auto-expire after 30 minutes.
 */
export class ResearchProposalStore {
  private proposals: Map<string, ResearchProposal>;
  private expiryMs: number; // default 30 * 60 * 1000

  public set(proposal: ResearchProposal): void;
  public get(proposalId: string): ResearchProposal | undefined;
  public delete(proposalId: string): void;
  public getAll(): ResearchProposal[];
  private cleanup(): void; // Remove expired proposals
}

export const researchProposalStore: ResearchProposalStore;
```

### F. `ResearchImportService` (`backend/src/services/ResearchImportService.ts`)

```typescript
export class ResearchImportService {
  constructor(
    private graphStoreInstance?: GraphStore,
    private metadataStoreInstance?: MetadataStore,
    private vectorStoreInstance?: VectorStore,
    private keywordIndexInstance?: KeywordIndex,
    private contradictionStoreInstance?: ContradictionStore,
    private auditServiceInstance?: AuditService,
    private chunkingServiceInstance?: ChunkingService,
    private embeddingServiceInstance?: EmbeddingService,
    private proposalStoreInstance?: ResearchProposalStore
  );

  /**
   * Atomically commits accepted proposal updates:
   * 1. Generate synthetic dossier .md file in uploads/.
   * 2. Register Document in MetadataStore (sourceType: 'web').
   * 3. Chunk, embed, and index the dossier (VectorStore + KeywordIndex).
   * 4. Resolve proposed entity names against existing graph entities.
   * 5. Insert new entities and edges into GraphStore with standard EvidenceRef.
   * 6. Mark resolved contradictions in ContradictionStore.
   * 7. Append research_import audit event to AuditStore.
   * 8. Mark proposal as IMPORTED in ProposalStore.
   */
  public async importProposal(
    proposalId: string,
    acceptedEntityTempIds: string[],
    acceptedRelationTempIds: string[],
    acceptedResolutionIds: string[]
  ): Promise<{
    success: boolean;
    researchDocId: string;
    auditEventId: string;
    importedEntitiesCount: number;
    importedRelationsCount: number;
    resolvedContradictionsCount: number;
  }>;
}

export const researchImportService: ResearchImportService;
```

---

## 3. REST API Contracts

### `GET /api/research/gaps`
Returns the active list of detected knowledge gaps ranked by priority score.
- **Response `200 OK`**:
```json
{
  "gaps": [
    {
      "id": "gap_c12",
      "type": "CONTRADICTION",
      "title": "Algorithm Time Complexity Conflict",
      "description": "Conflict between Lecture Slides and Textbook B regarding Fibonacci heap bounds",
      "suggestedQuestion": "What is the exact time complexity of Dijkstra with Fibonacci heaps?",
      "priorityScore": 0.95,
      "targetEntityIds": ["ent_dijkstra", "ent_fib_heap"],
      "contradictionId": "contra_12",
      "detectedAt": "2026-10-25T10:00:00.000Z"
    }
  ],
  "totalCount": 4
}
```

### `POST /api/research/investigate`
Initiates a bounded research task. Returns the full proposal.
- **Request Body**:
```json
{
  "question": "What is the exact time complexity of Dijkstra with Fibonacci heaps?",
  "gapId": "gap_c12"
}
```
- **Response `200 OK`**:
```json
{
  "proposalId": "prop_8923a1",
  "proposal": { "..." }
}
```
- **Response `408 Request Timeout`** (if budget exhausted with no useful sources):
```json
{
  "error": "Research task completed with insufficient sources",
  "budgetUsed": { "queriesUsed": 3, "sourcesFetched": 0, "elapsedMs": 12000 }
}
```

### `GET /api/research/proposals/:id`
Retrieves a specific pending proposal by ID.
- **Response `200 OK`**: Full `ResearchProposal` object.
- **Response `404 Not Found`**: Proposal expired or not found.

### `POST /api/research/import`
Commits selected items from a proposal into the knowledge base.
- **Request Body**:
```json
{
  "proposalId": "prop_8923a1",
  "acceptedEntityTempIds": ["temp_ent_1"],
  "acceptedRelationTempIds": ["temp_rel_1"],
  "acceptedContradictionIds": ["contra_12"]
}
```
- **Response `200 OK`**:
```json
{
  "success": true,
  "researchDocId": "doc_research_8923a1",
  "auditEventId": "audit_evt_9912",
  "importedEntitiesCount": 1,
  "importedRelationsCount": 1,
  "resolvedContradictionsCount": 1
}
```

### `POST /api/research/reject`
Discards a proposal without importing any items.
- **Request Body**: `{ "proposalId": "prop_8923a1" }`
- **Response `200 OK`**: `{ "success": true }`

### `GET /api/settings/research`
Returns current research settings.
- **Response `200 OK`**: `ResearchSettings` object.

### `PUT /api/settings/research`
Updates research settings (approved domains, budgets, toggles).
- **Request Body**: Partial `ResearchSettings`.
- **Response `200 OK`**: Updated `ResearchSettings`.

---

## 4. State Management & Storage Format

### A. Client Store Additions (`frontend/src/store/appStore.ts`)
```typescript
interface AppState {
  // ... existing state ...

  // Phase 4 — Research
  researchGaps: InvestigationGap[];
  activeProposal: ResearchProposal | null;
  isResearching: boolean;
  researchProgress: { queriesUsed: number; sourcesFetched: number; elapsedMs: number } | null;
  isQueueModalOpen: boolean;
  isReviewDrawerOpen: boolean;

  // Phase 4 — Actions
  fetchResearchGaps: () => Promise<void>;
  startResearchTask: (question: string, gapId?: string) => Promise<void>;
  importAcceptedUpdates: (
    proposalId: string,
    acceptedEntityIds: string[],
    acceptedRelationIds: string[],
    acceptedResolutionIds: string[]
  ) => Promise<void>;
  rejectProposal: (proposalId: string) => Promise<void>;
  setQueueModalOpen: (open: boolean) => void;
  setReviewDrawerOpen: (open: boolean) => void;
  clearActiveProposal: () => void;
}
```

### B. Storage Persistence Invariant
- Dossier files are saved to `uploads/research_<id>.md` (same directory as user uploads).
- Dossier metadata is saved in `data/metadata.json` via `MetadataStore` with `sourceType: 'web'`.
- Chunks are saved in `data/vectors.json` via `VectorStore`.
- Graph items are saved in `data/graph.json` with standard `EvidenceRef`.
- Audit logs are appended to `data/audit_log.jsonl`.
- Research settings are saved to `data/research_settings.json`.
- If an audit rollback is triggered for `research_import`, the rollback handler:
  1. Deletes added entities and edges from `GraphStore` and persists.
  2. Un-indexes chunks from `VectorStore` (by docId prefix) and `KeywordIndex`.
  3. Removes document metadata from `MetadataStore`.
  4. Deletes the dossier file from `uploads/`.
  5. Restores resolved contradictions to `active` status in `ContradictionStore`.
  6. Appends a `rollback` event to `audit_log.jsonl`.
