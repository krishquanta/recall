# Recall 🧠

Recall is a local-first, document-aware AI study companion and evidentiary Knowledge Graph. Upload your notes, question banks, PDFs, slides, and handwritten pages — then ask anything in plain English to get answers with clickable citations, or explore an interactive concept graph with sentence-level verifiable evidence.

---

## 🌟 Key Features

1. **Comprehensive Multi-Format Ingestion**:
   - 📄 **Word Processing (`.docx`, `.doc`, `.odt`, `.rtf`)**: Full paragraph, heading, and line structure extraction using Mammoth & XML parser.
   - 📽️ **Presentations (`.pptx`, `.ppt`, `.odp`)**: Slide-by-slide extraction preserving exact slide numbers (`Slide 1`, `Slide 2`) for precise citation jumps.
   - 📑 **PDFs (`.pdf`)**: Digital text extraction per page, with automatic fallback to Gemini Vision OCR for scanned/image-only PDFs.
   - 📊 **Spreadsheets (`.xlsx`, `.xls`, `.csv`, `.tsv`, `.ods`)**: Preserves sheet names, headers, and row indices.
   - 📝 **Markdown (`.md`) & Text (`.txt`)**: Preserves heading context and exact line number ranges.
   - 🌐 **Web & Data Formats (`.html`, `.htm`, `.json`, `.jsonl`, `.xml`)**: Clean text and structure parsing with tag stripping.
   - ✍️ **Handwritten Notes & Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.heic`)**: Gemini Vision multimodal OCR extracts cursive and printed handwriting, labeled with an `🖼 OCR` badge.
2. **Evidentiary Knowledge & Claim Graph**:
   - **Entity & Claim Extraction**: Automatic extraction of domain entities (`Concept`, `Method`, `Formula`, `Theorem`, `Property`, `Dataset`, `Person`) and atomic claims with modalities (`Fact`, `Definition`, `Hypothesis`, `Rule`) via Gemini structured output (with offline mock fallback).
   - **Typed Semantic Relationships**: Derives directional, typed relations (`DEFINES`, `IS_A`, `PART_OF`, `PREREQUISITE_FOR`, `CAUSES`, `USES`, `CONTRADICTS`, `PROVES`, `EQUIVALENT_TO`, `RELATED_TO`).
   - **Interactive Graph Canvas**: Interactive force-directed network explorer built on `@xyflow/react` with node/edge inspection, pan/zoom, and live filtering.
3. **Strict Provenance & Evidence Anchoring (Definition of Done)**:
   - **100% Traceability**: Every single accepted entity, claim, and relationship is inextricably linked to an `EvidenceRef` containing `docId`, `chunkId`, `filename`, `page`/`slide`/`lineStart`, character offsets, and verbatim quote.
   - **Verbatim Anchor Validation**: The `ProvenanceValidator` tests every quote character-for-character against the source passage text. Ungrounded or hallucinated assertions are strictly discarded.
4. **Tri-Tier Entity Deduplication & Review Queue**:
   - **Tier 1 (Lexical & Alias Matching)**: Case-insensitive, whitespace-collapsed, and punctuation-normalized matching against canonical names and aliases.
   - **Tier 2 (Acronym Resolution)**: Automatic bidirectional resolution for acronyms and parenthetical expansions (e.g., *Singular Value Decomposition* ↔ *SVD*).
   - **Tier 3 (Semantic Vector Similarity)**: Embedding cosine similarity via `text-embedding-004`.
     - $\ge 0.92$: Automatic merge into the canonical entity.
     - $0.78 \le \text{score} < 0.92$: Flagged as uncertain and routed to the **Review Queue** with a provisional node.
     - $< 0.78$: Treated as a distinct entity.
   - **Human-in-the-Loop Review Queue**: Dedicated modal to review ambiguous candidates with options to **Merge**, **Keep Separate**, or **Redirect**.
5. **Hybrid Search Engine**:
   - Vector similarity using Gemini `text-embedding-004` (768-dim) cosine ranking (with local mock fallback).
   - BM25 full-text keyword search using `MiniSearch`.
   - Balanced score fusion with configurable $\alpha$ weighting.
6. **Conversational Q&A with Clickable Citations & Relation Chips**:
   - Powered by **`gemini-3.8-flash`** enforcing strict grounding.
   - Standard citation chips (`[1]`, `[2]`) jump directly to the exact page/slide/line in the Source Preview panel.
   - Graph relation chips (`[🔗 Source -> RELATION -> Target]`) highlight related concepts in the graph and open evidentiary quote cards.
8. **Gemini Key Pool Optimizer & Persistent Two-Tier Caching**:
   - Multi-key rotation pool with graceful round-robin and automatic 429 rate-limit failover.
   - Persistent two-tier cache (in-memory LRU + disk persistence) for embeddings and Q&A prompt responses, reducing billable API requests by >90%.
   - In-app telemetry and key management settings modal.
9. **Cross-Source Claim Comparison & Consensus Scoring**:
   - Clusters atomic claims across multiple documents mentioning identical canonical entities.
   - Semantic topic grouping with multi-source consensus scoring $C \in [0.0, 1.0]$.
10. **Contradiction & Staleness Detection Engine**:
   - Automated detection of factual divergence, numerical contradictions, and opposing relation types across distinct source documents.
   - Temporal markers and edition tracking to flag superseded or outdated claims.
   - Right-hand **Contradiction Drawer** displaying side-by-side comparative quotes with resolution actions.
11. **Interactive Relationship Curation Suite**:
   - One-click curation directly from the Graph Canvas: **Accept** (verified), **Reject** (soft delete with search isolation), or **Correct** (swap direction, modify relation type, or attach custom notes).
12. **Immutable Append-Only Audit Trail & Atomic Rollback**:
   - Every mutation is logged to `data/audit_log.jsonl` with before/after state snapshots.
   - One-click topological-safe rollback to revert any curation, merge, or contradiction resolution.
13. **Three-Panel Browser Workspace**:
   - **Left Panel (240px)**: Library sidebar with drag-and-drop upload, document list, and context menu.
   - **Center Panel (Flex)**: Toggleable between conversational chat and the interactive Knowledge Graph canvas.
   - **Right Panel (380px)**: Source Preview panel with PDF viewer, image viewer, text quote highlighter, and evidence cards.
14. **Real-Time Processing Status**:
   - Server-Sent Events (SSE) stream real-time progress (`Saving` → `Extracting` → `Chunking` → `Embedding` → `Graph Extraction` → `Done`).
   - Clear visual status chips (✅ ready, ⏳ progress bar, ❌ error with tooltip).
15. **Math & Multilingual Output**:
   - KaTeX renders inline and block LaTeX math, vectors, matrices, and special symbols.
   - Automatic multilingual responses in the user's language.

---

## 🏗️ Architecture

```
recall/
├── backend/
│   ├── src/
│   │   ├── routes/          # upload (SSE), documents, search, ask, graph, curation, claims, contradictions, audit, settings
│   │   ├── services/        # Extraction, Chunking, Embedding, Search, LLM,
│   │   │                    # GraphExtraction, ProvenanceValidator, Deduplication, ReviewQueue,
│   │   │                    # KeyManager, CacheService, ClaimComparisonService,
│   │   │                    # ContradictionDetectionService, RelationshipCurationService, AuditService
│   │   ├── store/           # MetadataStore, VectorStore, KeywordIndex, GraphStore, ReviewStore, ContradictionStore, AuditStore
│   │   ├── types/           # Domain, Graph, Claim, Contradiction, and Audit TypeScript interfaces
│   │   └── index.ts         # Express server entry point (port 3001)
│   ├── uploads/             # Raw file storage
│   ├── data/                # Vector store, metadata, graph, contradictions, and audit log persistence
│   └── test/                # Unit & integration test suites (374 passing tests)
│
├── frontend/
│   ├── src/
│   │   ├── api/             # Typed fetch, SSE client & Phase 3 endpoints
│   │   ├── components/      # UI components
│   │   │   ├── Sidebar/     # Upload dropzone, document list & context menus
│   │   │   ├── Chat/        # Chat bubbles, citation chips, relation chips, math content
│   │   │   ├── Graph/       # Canvas, nodes, edges, popovers, modals, contradiction drawer, version history
│   │   │   ├── Header/      # View mode selector, contradiction badge, history modal trigger
│   │   │   ├── Settings/    # Gemini key pool optimizer and cache telemetry settings modal
│   │   │   ├── Preview/     # PDF viewer, image viewer, text highlighter, evidence cards
│   │   │   └── StatusToast  # Real-time processing toast alerts
│   │   ├── hooks/           # useUpload, useDocuments, useChat, useSSE
│   │   ├── store/           # Zustand stores (appStore, graphStore)
│   │   └── App.tsx          # Responsive three-panel layout
│   └── vite.config.ts       # Vite proxy to backend API
│
└── plan/                    # Full design specifications
    ├── phase - 1/           # Ingestion, RAG, Citations, UI/UX
    ├── phase - 2/           # Knowledge Graph, Provenance DoD, Deduplication, Review Queue, Key Optimization
    └── phase 3/             # Claim Comparison, Contradiction Engine, Curation Suite, Audit Rollback
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v20+ LTS (tested on Node v22/v24)
- **pnpm**: v9+ (v10/v11 supported)

### 2. Configure Environment Variables
Copy `backend/.env.example` to `backend/.env` and add your Google Gemini API key:

```env
# backend/.env
GEMINI_API_KEY=your_gemini_api_key_here
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.8-flash
EMBEDDING_MODEL=text-embedding-004
PORT=3001
UPLOAD_DIR=./uploads
DATA_DIR=./data
```
*(Get a free API key at [Google AI Studio](https://aistudio.google.com/))*

> **Note**: If `GEMINI_API_KEY` is not provided, the application runs with deterministic mock extractors, mock embeddings, and safe fallback responses so all ingestion, knowledge graph, and UI flows can be tested offline immediately.

### 3. Run Both Servers Concurrently
From the project root:

```bash
pnpm dev
```

- **Frontend**: `http://localhost:5180`
- **Backend API**: `http://localhost:3001`

### 4. Build for Production
```bash
pnpm build
```

### 5. Run Automated Tests
```bash
pnpm --prefix backend test
```

---

## 🧪 Testing Definition of Done

1. **Multi-Format Ingestion**: Upload a PDF, Markdown notes file, or spreadsheet → verify processing progresses through SSE stages (`Extracting` → `Chunking` → `Embedding` → `Graph Extraction` → `Done`).
2. **Handwritten OCR**: Upload an image of handwritten notes → verify OCR transcription with `🖼 OCR` badge.
3. **Conversational Citations**: Ask a question about an imported document → verify answer includes `[1]` citation tags; clicking jumps to the exact cited page/line with highlighted quote in the Preview Panel.
4. **Knowledge Graph Extraction**: Switch to the **Knowledge Graph** view → verify entities (concepts, methods, theorems) and typed directional edges are rendered on the canvas.
5. **Strict Provenance (DoD)**: Click any node or relationship edge in the graph → verify the Evidence Card displays the verbatim source passage, document ID, and page/line coordinates.
6. **Deduplication & Review Queue**: Ingest documents with common acronyms (e.g., *"Singular Value Decomposition"* and *"SVD"*) → verify auto-merge. For borderline entities ($0.78 \le \text{score} < 0.92$), open the Review Queue modal to approve, separate, or redirect candidate entities.
