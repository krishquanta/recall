# Context & Domain Model: Recall (AI Study Bank)

Recall is a local-first, document-aware AI study companion and evidentiary Knowledge Graph designed for deep learning, research, and factual study. It ingests multi-format documents, grounds answers with sentence-level verifiable citations, maintains an evidentiary knowledge graph, detects cross-source contradictions, and autonomously investigates knowledge blind spots via bounded web discovery.

---

## 🏛️ System Phases

| Phase | Milestone Name | Core Capabilities |
| :--- | :--- | :--- |
| **Phase 1** | **Multi-Format Ingestion & Grounded RAG** | Ingestion of 14+ file formats (PDF, DOCX, PPTX, XLSX, Markdown, images via Gemini Vision OCR); hybrid search (BM25 + vector cosine); conversational Q&A with clickable citation chips (`[1]`) jumping to page/slide/line coordinates in the Source Preview panel. |
| **Phase 2** | **Evidentiary Knowledge Graph & Provenance DoD** | Automated entity (`Concept`, `Method`, `Formula`, `Theorem`, etc.) and atomic claim extraction; typed directional edges; 100% strict provenance anchoring via `EvidenceRef` character-for-character verification; tri-tier entity deduplication with Human-in-the-Loop Review Queue; multi-key rotation and persistent two-tier caching. |
| **Phase 3** | **Claim Alignment, Contradictions & Audit Rollback** | Cross-source claim clustering with consensus scoring ($C \in [0.0, 1.0]$); automated factual, numerical, and relation contradiction detection; interactive Contradiction Drawer; one-click graph curation suite (`Accept`, `Reject`, `Correct`); append-only audit trail (`audit_log.jsonl`) with topologically-safe atomic rollback. |
| **Phase 4** | **Autonomous Research Agent & Bounded Web Discovery** | Continuous graph gap detection (isolated entities, weak evidence, stale claims, unresolved contradictions); bounded multi-source web discovery (DuckDuckGo, Wikipedia REST API, arXiv API); hard SSRF and prompt-injection defense; sourced research dossiers with "what changed and why" deltas; two-tab Human-in-the-Loop Research Review Drawer; synthetic document RAG ingestion. |

---

## 📚 Core Domain Vocabulary

### 1. Ingestion & Provenance
- **`Document`**: A primary library resource (`sourceType: 'upload' | 'web'`), indexed with status tracking (`UPLOADING` → `EXTRACTING` → `CHUNKING` → `EMBEDDING` → `GRAPH_EXTRACTION` → `READY`).
- **`Chunk`**: A contiguous, semantic passage of extracted text tagged with exact physical anchors (`pageNumber`, `slideNumber`, `lineStart`, `lineEnd`).
- **`EvidenceRef`**: The foundational provenance anchor required for every node, edge, and claim in the graph:
  ```typescript
  interface EvidenceRef {
    docId: string;
    chunkId: string;
    filename: string;
    page?: number;
    slide?: number;
    lineStart?: number;
    lineEnd?: number;
    quote: string; // Must match chunk text character-for-character
    charStart?: number;
    charEnd?: number;
  }
  ```
- **`ProvenanceValidator`**: Verification engine that tests every `quote` against its source chunk before admitting an entity, relationship, or claim into storage. Ungrounded assertions are discarded.

### 2. Knowledge Graph & Curation
- **`EntityNode`**: A canonical concept, theorem, method, or property within the graph.
- **`RelationshipEdge`**: A directional, typed semantic connection between two entities (`DEFINES`, `IS_A`, `PART_OF`, `PREREQUISITE_FOR`, `CAUSES`, `USES`, `CONTRADICTS`, `PROVES`, `EQUIVALENT_TO`, `RELATED_TO`).
- **`ClaimNode`**: An atomic assertion extracted from text with modalities (`Fact`, `Definition`, `Hypothesis`, `Rule`) and consensus scores.
- **`CurationState`**: Status of a relationship edge: `PENDING`, `VERIFIED`, `REJECTED`, or `USER_DEFINED`.
- **`AuditLogEntry`**: Immutable record stored in `data/audit_log.jsonl` containing `auditId`, timestamp, `action`, `targetType`, `targetId`, `beforeState`, `afterState`, and user attribution. Supports forward and reverse topological state rollbacks.

### 3. Deduplication & Review
- **Tier 1 (Lexical)**: Normalized string equality and alias matching.
- **Tier 2 (Acronyms)**: Bidirectional expansion matching (e.g., *Singular Value Decomposition* ↔ *SVD*).
- **Tier 3 (Semantic Vector)**: Cosine similarity of entity definitions via `text-embedding-004`.
  - Score $\ge 0.92$: Auto-merged into canonical entity.
  - $0.78 \le \text{Score} < 0.92$: Provisional candidate sent to `ReviewStore` (`review_queue.json`) for user confirmation.
  - Score $< 0.78$: Preserved as distinct entities.

### 4. Autonomous Research Agent (Phase 4)
- **`InvestigationGap`**: A detected knowledge void or conflict in the knowledge graph:
  - `CONTRADICTION`: Unresolved conflicting assertions between distinct documents.
  - `ISOLATED_ENTITY`: Entity node with zero incoming or outgoing relationships.
  - `WEAK_GROUNDING`: Entity or claim supported by only a single source without external verification.
  - `STALE_CLAIM`: Claim flagged as superseded or historically dated.
  - `USER_QUERY`: On-demand research question submitted directly by the user.
- **`ResearchBudget`**: Hard execution boundaries preventing runaway search execution:
  - `maxQueries`: Maximum formulated search queries (default: 3).
  - `maxSources`: Maximum fetched and parsed web pages (default: 5).
  - `maxExecutionTimeMs`: Total wall-clock execution ceiling (default: 120,000 ms / 2 minutes).
- **`UrlSecurityValidator`**: Defense-in-depth engine enforcing SSRF prevention:
  - Private IP blocking: RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.1, localhost), IPv6 ULA/loopback (::1, fc00::/7, fe80::/10), and cloud metadata (169.254.169.254).
  - Domain allowlisting: Validation against approved domains and wildcards (`wikipedia.org`, `arxiv.org`, `*.edu`, `*.gov`).
  - Redirect protection: Validates every hop in HTTP redirect chains.
- **`SourcedResearchReport`**: Sourced executive brief with citations, retrieval timestamps, detailed analysis, and a structured "What changed and why" delta.
- **`ResearchProposal`**: Staged graph updates (`proposedEntities`, `proposedRelations`, `proposedResolutions`) held in `ResearchProposalStore` awaiting human-in-the-loop review.
- **`ResearchReviewDrawer`**: Two-tab user interface enabling users to inspect the research brief and toggle `[Accept]` / `[Reject]` on each proposed entity and relation before committing to `data/graph.json`.
- **Synthetic Document Ingestion**: Ingestion of accepted research briefs into `MetadataStore`, `VectorStore`, and `KeywordIndex` as documents with `sourceType: 'web'`, granting full conversational RAG and citation jump capabilities.

---

## 🔒 Security & Data Integrity Invariants

1. **Strict Provenance Invariant**: No entity, claim, or relationship may enter `data/graph.json` without a verified `EvidenceRef` matching the source passage character-for-character.
2. **Topological Invariant**: An edge cannot exist without valid source and target entities; rolling back an entity deletion or merge safely validates or restores connected relations.
3. **SSRF Invariant**: No outbound HTTP request may target private subnets, cloud metadata endpoints, or unapproved domains.
4. **Prompt Injection Invariant**: All external web data is treated as untrusted and isolated in structured delimiters away from system instructions.
5. **Storage Invariant**: Storage files (`metadata.json`, `vectors.json`, `graph.json`, `review_queue.json`, `audit_log.jsonl`, `research_settings.json`) use atomic file write semantics with temp-file rename fallbacks to prevent corruption under concurrent operations.
