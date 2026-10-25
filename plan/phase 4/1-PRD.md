# PRD — Product Requirements Document (Phase 4)
> **Autonomous Research Agent, Gap Investigation & Bounded Web Discovery**

---

## 1. Problem Statement & Cognitive Hurdles

With Recall Phase 1 (multimodal ingestion and RAG Q&A), Phase 2 (evidentiary knowledge graph and strict provenance), and Phase 3 (cross-source claim alignment, contradiction detection, and relationship curation) operational, users can inspect, compare, and audit knowledge extracted from their uploaded documents.

However, four primary cognitive and structural hurdles remain:

1. **Information Incompleteness & Blind Spots**: A student's or researcher's uploaded materials frequently omit key definitions, background prerequisites, intermediate derivation steps, or empirical confirmations. The existing system can only inspect what was uploaded, leaving silent knowledge gaps undetected.
2. **Unresolvable Contradictions Without External Grounding**: When two course documents directly conflict (e.g., Professor's slides claim an algorithm runs in $\mathcal{O}(V \log V)$, while textbook notes claim $\mathcal{O}(E + V \log V)$), the user cannot resolve the conflict using the local library alone without consulting authoritative external references.
3. **Friction in Manual Fact-Checking & Web Ingestion**: Manually searching Google, finding papers on arXiv or Wikipedia, copy-pasting text into notes, and re-uploading documents is slow and breaks the user's study flow. Furthermore, standard search engines often return SEO-bloated, paywalled, or low-quality sources.
4. **Lack of Bounded Scope & Provenance for Online Data**: Automated agents searching the open web risk runaway crawling, prompt injections, hallucinated summaries, or polluted knowledge graphs. Users need strict safety bounds (domain allowlists, budget limits, SSRF prevention) and transparent human-in-the-loop review before any external fact is imported.

**Recall Phase 4** solves these problems by providing an **Autonomous & Guided Research Agent**: it automatically discovers gaps and missing evidence in the knowledge graph, suggests questions worth investigating, searches approved online sources (DuckDuckGo, Wikipedia REST API, arXiv API) with strict boundary and security controls, produces a sourced research report with a "what changed and why" summary, and stages proposed graph updates for interactive human-in-the-loop review.

---

## 2. Target Personas & Real-World Scenarios

| Persona | Real-World Scenario | Phase 4 Value |
|---------|---------------------|---------------|
| **University STEM Student** | Studying for Advanced Algorithms exam; notices an unresolved contradiction flagged in Phase 3 regarding Dijkstra vs. Fibonacci heap complexity. | Clicks "Investigate Gaps"; Recall executes a bounded search on arXiv and Wikipedia, generates a sourced research brief clarifying Fibonacci heap bounds, and stages a proposed graph correction with verbatim quotes. |
| **Graduate Researcher** | Ingested 15 biology papers on CRISPR Cas9 off-target mechanisms; several key enzyme complexes have only 1 relationship edge and missing mechanistic evidence. | Investigation Ideas panel surfaces the gap: *"Missing mechanistic evidence for Cas12a off-target kinetics"*. User clicks "Investigate"; Recall bounds the search to PubMed/arXiv, retrieves authoritative findings, and drafts a research dossier. |
| **Medical / Clinical Student** | Comparing pharmacology guidelines where two textbooks give divergent pediatric dosages for an antimicrobial agent. | Recall identifies the conflicting claim, formulates targeted search queries, pulls recent open-access medical advisories from approved domains, and provides a clear delta report showing the updated 2026 consensus. |

---

## 3. Goals & Non-Goals

### Goals
- **Automatic Knowledge Gap & Question Suggestion**: Continuously analyze the knowledge graph to detect weak evidence (single-source claims, low-connectivity entities), unresolved Phase 3 contradictions, and stale claims, ranking them into an active Investigation Queue.
- **On-Demand Bounded Research Tasks**: Enable users to initiate a research inquiry from any graph entity, contradiction badge, chat citation, or freeform question.
- **Multi-Source Approved Web Discovery**:
  - DuckDuckGo search for general discovery without paid API subscriptions, strictly respecting domain allowlists (`wikipedia.org`, `arxiv.org`, `.edu`, `.gov`, and user-defined domains).
  - Direct integration with Wikipedia REST API and arXiv API for clean, structured encyclopedic and academic references.
  - Gemini LLM for query formulation, source synthesis, claim extraction, and contradiction verification.
- **Hard Security & Execution Bounds**:
  - Pre-flight URL validation and hostname allowlist enforcement (including post-redirect).
  - Private network / loopback SSRF blocking (RFC 1918, RFC 4193, loopback, link-local, localhost).
  - Hard budgets: max 3 search queries, max 5 fetched pages, 2-minute wall-clock timeout.
  - Redirects and retries count toward budget.
  - Prompt injection mitigation: untrusted web content is sanitized and isolated during LLM extraction.
- **Sourced Research Report & Delta Summary**: Produce an executive summary report with clickable source links, retrieval timestamps, and a dedicated "What changed and why" section explaining proposed additions.
- **Human-in-the-Loop Staged Graph Review**: Provide a two-tab Research Review Drawer where users can review proposed entities, claims, and relations with individual `[Accept]` / `[Reject]` toggles before committing to `data/graph.json`.
- **Hybrid Ingestion & Audit Traceability**:
  - Persist an ingested research dossier as a synthetic `Document` (with `sourceType: 'web'`) into `MetadataStore` and `VectorStore` so RAG chat can query it.
  - Store the dossier markdown content in `uploads/` alongside user-uploaded files.
  - Commit accepted graph updates with verbatim `EvidenceRef` quotes (using the dossier's `docId` and `chunkId` references).
  - Record full transaction events in `data/audit_log.jsonl` with atomic 1-click rollback.

### Non-Goals (Phase 4)
- Unbounded web crawling or scraping entire websites without user approval.
- Auto-importing web claims directly into the master knowledge graph without explicit human-in-the-loop review.
- Modifying or overwriting original user-uploaded PDF or Office files.
- Requiring paid third-party search subscriptions (e.g. SerpAPI, Tavily); all search runs via zero-cost DuckDuckGo, Wikipedia, arXiv, and existing Gemini API keys.
- Full-text PDF downloading from academic sources (only abstracts and summaries are retrieved).

---

## 4. Success Metrics

| Metric | Target | Measurement Strategy |
|--------|--------|----------------------|
| **Research Task Boundedness** | 100% adherence | Never exceeds 3 queries, 5 fetched sources, or 120s runtime; zero runaway executions. |
| **SSRF & Security Isolation** | 100% blocked | Automated test suite verifying that private IP ranges, localhost, cloud metadata endpoints, and non-whitelisted domains are strictly rejected. |
| **Claim Grounding Precision** | 100% verbatim | Every proposed entity, claim, and relation is anchored to exact verbatim source quotes with valid `EvidenceRef` (containing `docId`, `chunkId`, `exactQuote`). |
| **Gap Suggestion Relevance** | ≥ 85% actionable | Test evaluation on benchmark graphs with deliberate gaps (orphan nodes, unverified claims). |
| **Audit & Rollback Integrity** | 100% reversible | Rolling back an imported research task completely removes all associated entities, edges, claims, dossier document, and vector/keyword index entries with zero orphaned data. |
| **Task Completion Latency** | < 45 seconds | Typical end-to-end research task latency from click to staged review presentation. |

---

## 5. Prioritized Feature Inventory

| # | Feature | Priority | Description |
|---|---------|:--------:|-------------|
| **F1** | **Graph Gap Detection & Suggestion Engine** | P0 | Analyzes the knowledge graph for orphan nodes, low-connectivity concepts (<2 edges), unverified single-source claims, and unresolved Phase 3 contradictions; populates the Investigation Queue. |
| **F2** | **Bounded Web & Academic Search Service** | P0 | Executes targeted queries via DuckDuckGo, Wikipedia REST API, and arXiv API, strictly constrained by domain allowlist, query count, and page fetch budgets. |
| **F3** | **SSRF Prevention & Security Sanitizer** | P0 | Validates destination URLs against allowlists, blocks internal/loopback/metadata IPs, enforces redirect tracking, and isolates untrusted web content against prompt injection. |
| **F4** | **Sourced Research Report Generator** | P0 | Synthesizes retrieved evidence into a structured markdown report answering the research question, complete with external citations, timestamps, and "What changed and why" summary. |
| **F5** | **Human-in-the-Loop Research Review Drawer** | P0 | Two-tab slide-over panel: Tab 1 presents the Sourced Report and Delta Summary; Tab 2 presents the interactive diff list of proposed entities, relations, and claims with individual Accept/Reject checkboxes. |
| **F6** | **Hybrid Ingestion & Knowledge Base Import** | P0 | Commits accepted graph updates into `GraphStore` and stores a synthesized research dossier in `MetadataStore`, `VectorStore`, and `KeywordIndex` (marked `sourceType: 'web'`). |
| **F7** | **Audit Trail Logging & Atomic Rollback** | P0 | Records the entire research import as an atomic audit transaction in `audit_log.jsonl`, enabling one-click reversion of all created entities, edges, and chunks. |
| **F8** | **Approved Sources & Budget Settings UI** | P1 | Settings panel tab to configure approved domains (e.g., add `nature.com`, remove domains), query budgets, and toggle search providers. |
| **F9** | **Context Menu & Canvas Research Triggers** | P1 | Right-click / hover context actions on Graph nodes and chat citations: `[ 🔍 Investigate Gaps ]` to immediately spawn a focused research task. |
| **F10** | **Investigation Queue Header Badge & Dropdown** | P1 | Header navigation trigger `[ 🔍 Research & Gaps (N) ]` displaying active gap count, ranked suggestions, and quick-launch buttons. |
