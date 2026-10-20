# PRD — Product Requirements Document (Phase 2)
> **Knowledge Graph, Entity Extraction, Claim Verification, and Provenance Linking**

---

## Problem Statement

While Recall v1 successfully retrieves document chunks and grounds LLM responses with citations, students and researchers still face several critical cognitive hurdles:
1. **Isolated Information**: Concepts, theorems, definitions, and formulas remain isolated across dozens of documents without interconnected structure.
2. **Implicit & Unverified Claims**: Textbooks and notes make factual or derived claims that students must take at face value without seeing the underlying premises or chain of reasoning.
3. **Entity Ambiguity & Duplication**: Different professors or chapters use varied aliases for the same concept (e.g., "SVD", "Singular Value Decomposition", "S.V.D."), fragmenting knowledge.
4. **Lack of Granular Provenance**: Standard RAG points to a general chunk or page, but does not isolate the exact sentence or clause providing evidentiary support for a specific assertion.

**Recall Phase 2** transforms Recall from a purely chunk-based search assistant into an evidentiary Knowledge & Claim Graph. It extracts entities and atomic claims from text passages, generates typed relationships, links every element to exact textual evidence, automatically merges duplicates, and queues uncertain entity matches for human review.

---

## Target Users

| Persona | Use-case |
|---------|----------|
| University Student | Map out multi-chapter relationships (e.g., how eigenvalues relate to PCA and spectral clustering) and verify definitions against source passages |
| Medical / STEM Researcher | Extract atomic claims and experimental results with sentence-level provenance across papers |
| Self-Learner / Exam Preparer | Identify duplicate concepts under different terminologies and resolve conflicting claims across study guides |

---

## Goals & Non-Goals

### Goals
- **Extract Entities**: Identify domain entities (Concepts, Methods, Formulas, Datasets, Authors, Theorems) from ingested passages with sentence-level boundaries.
- **Extract Claims**: Isolate individual factual or propositional claims made in the text, classifying their modality (Definition, Finding, Hypothesis, Rule).
- **Generate Typed Relationships**: Discover semantic relationships (e.g., `DEFINES`, `USES`, `PROVES`, `CONTRADICTS`, `EXTENDS`, `PART_OF`) connecting entities and claims.
- **Strict Evidence Linking (Definition of Done)**: Every single accepted relationship and claim must be inextricably linked to a specific source passage with exact document ID, page/line/slide coordinates, and raw quote text.
- **Entity Resolution & Deduplication**: Fast automatic merging of exact/high-confidence aliases (e.g., case, punctuation, acronyms), plus an interactive human-in-the-loop review queue for ambiguous candidates.
- **Graph Visualizer & Explorer**: Interactive network visualization displaying entities, relationships, claims, and instant preview of source citations upon clicking any node or edge.

### Non-Goals (Phase 2)
- Autonomous web verification of claims against external Wikipedia/internet databases (all provenance is strictly scoped to uploaded study materials).
- Fully automated ontology engineering with dynamic OWL/RDF reasoning engines.
- Write/edit back into the original uploaded PDF or Office binary documents.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Provenance Coverage (DoD) | 100% of accepted relationships traceable to source passages with docId, location, & quote |
| Entity Extraction Precision | ≥ 88% on benchmark academic passages |
| Deduplication Accuracy (Auto-merge) | ≥ 95% precision for automatic merges; zero false-positive auto-merges |
| Review Queue Latency | Review decision (merge/reject) applies in < 150ms locally |
| Graph Render Performance | Smooth 60 FPS interaction for graphs up to 2,000 nodes/edges in browser |

---

## Feature List

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| F1 | Passage Entity & Claim Extraction | P0 | Structured extraction of entities (with types) and atomic claims from text chunks using Gemini structured outputs |
| F2 | Typed Relationship Generation | P0 | Derivation of directional, typed relations (`PREREQUISITE_FOR`, `EQUIVALENT_TO`, `CONTRADICTS`, etc.) |
| F3 | Sentence-Level Evidence Anchor | P0 | Direct binding of every entity, claim, and relationship to its source chunk and exact verbatim passage |
| F4 | Automatic Entity Deduplication | P0 | Canonicalization via string normalization, acronym resolution, and cosine embedding similarity (threshold ≥ 0.92) |
| F5 | Uncertain Match Review Queue | P0 | Dedicated review interface where users approve, reject, or re-link borderline duplicate entity candidates |
| F6 | Interactive Graph Explorer | P1 | Force-directed graph view in the UI showing concept networks with clickable evidence side-drawers |
| F7 | Graph-Augmented Q&A | P1 | RAG retrieval supplemented by 1-hop and 2-hop graph traversals for deeper concept synthesis |
