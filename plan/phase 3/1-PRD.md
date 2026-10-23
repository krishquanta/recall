# PRD — Product Requirements Document (Phase 3)
> **Cross-Source Claim Comparison, Contradiction & Staleness Detection, Relationship Curation, and Audit Versioning**

---

## Problem Statement

With Recall Phase 1 (multi-format document ingestion and RAG Q&A) and Phase 2 (evidentiary knowledge graph, deduplication, and strict provenance) established, students and researchers now have a structured network of concepts and claims. However, as users upload materials from multiple semesters, varied professors, differing textbook editions, and evolving research papers, three critical challenges emerge:

1. **Conflicting & Contradictory Information Across Sources**: Different textbooks, lectures, and guides frequently present conflicting definitions, incompatible formulas, or contradictory findings (e.g., Professor A states a greedy algorithm is optimal for problem $P$, while textbook B proves it is suboptimal). Students cannot readily identify where and why their study materials clash.
2. **Stale, Deprecated, or Superseded Content**: Outdated notes, previous syllabus editions, and older textbook revisions remain present in the graph alongside newer materials without temporal awareness, leading to confusion during exam prep.
3. **Lack of Human-in-the-Loop Curation (Accept / Reject / Correct)**: While the AI extractor identifies relationships with high precision, users need full authority to accept, reject, or correct relationship types (e.g. re-typing an ambiguous `RELATED_TO` edge to `PREREQUISITE_FOR` or `CONTRADICTS`), with instant visual feedback in the graph.
4. **No Historical Audit Trail or Version Tracking**: Changes, corrections, and document re-uploads currently overwrite or mutate state without preserving historical provenance or rollback capabilities. Users need to see who changed what, when, against which source version, and be able to revert modifications.

**Recall Phase 3** solves these challenges by providing cross-source claim alignment, automated contradiction and staleness flagging, an interactive relationship curation suite, and an immutable change audit log with document versioning.

---

## Target Users & User Scenarios

| Persona | Real-World Scenario | Phase 3 Value |
|---------|---------------------|---------------|
| **University STEM Student** | Comparing Course Lecture Notes (Fall 2026) against a recommended Textbook (2020 edition) for an upcoming Midterm. | Instantly spots where the professor's slides contradict the textbook notation or algorithmic bounds; flags stale formulas from older editions. |
| **Medical / Life Sciences Student** | Ingesting pharmacology guidelines from 2022 and updated 2026 clinical advisories. | System flags stale dosage protocols or contraindicated drug interactions, displaying side-by-side comparative evidence snippets. |
| **Teaching Assistant / Course Curator** | Curating the master knowledge bank for a university course. | Reviews auto-extracted relationships, corrects edge types, rejects erroneous associations, and tracks a transparent audit history of all graph revisions. |

---

## Goals & Non-Goals

### Goals
- **Compare Claims Across Sources**: Cluster and align atomic claims by subject entity and concept scope across multiple ingested documents, displaying comparative evidence side-by-side.
- **Flag Potential Contradictions**: Detect logical, factual, numeric, and categorical conflicts between claims from different sources, creating explicit `CONTRADICTS` relationships and visual warning badges.
- **Flag Stale & Superseded Information**: Detect temporal divergence, deprecated facts, and older source editions through metadata analysis and comparative LLM inspection, tagging stale claims with warning chips.
- **Interactive Relationship Curation (Accept, Reject, Correct)**: Empower users to accept (`verified`), reject (`rejected`), or correct (`relationType`, direction, or note) any relationship edge in the graph and chat preview.
- **Preserve Change History & Source Versions**: Maintain an immutable, append-only audit trail (`audit_log.jsonl`) recording all user and system mutations, with one-click rollback and document revision tracking.

### Non-Goals (Phase 3)
- Real-time collaborative multi-user socket editing (Phase 3 focuses on single-user local-first curation).
- Automated internet web-scraping to fact-check external websites (verification is strictly scoped to the user's uploaded library).
- Automated rewrite of original PDF or Office binary documents on disk.

---

## Success Metrics

| Metric | Target | Measurement Strategy |
|--------|--------|----------------------|
| **Contradiction Detection Precision** | ≥ 85% | Benchmark dataset of conflicting course notes and revised textbooks |
| **Contradiction False-Positive Rate** | ≤ 12% | Distinct contexts (e.g., Euclidean vs. non-Euclidean space) correctly recognized as non-conflicting |
| **Curation Latency** | < 100ms | Time from clicking "Accept" / "Reject" / "Correct" to graph visual update |
| **Audit Log Integrity** | 100% | Every mutation produces an immutable `audit_log.jsonl` record with bidirectional diff |
| **Rollback Reliability** | 100% | Rolling back any mutation exactly restores the prior graph and evidence state |

---

## Feature List

| # | Feature | Priority | Description |
|---|---------|:--------:|-------------|
| **F1** | **Cross-Source Claim Comparison** | P0 | Clusters claims mentioning the same canonical entities across distinct documents and displays a side-by-side comparative evidence card. |
| **F2** | **Contradiction Detection Engine** | P0 | Analyzes aligned claims for direct factual, algorithmic, or definitional opposition; generates high-priority contradiction alert chips in Graph and Preview. |
| **F3** | **Stale Information Flagging** | P0 | Analyzes document creation/upload dates, edition metadata, and explicit superseded markers to flag outdated claims. |
| **F4** | **Relationship Curation Suite** | P0 | One-click actions on any relationship edge: **Accept** (mark verified), **Reject** (soft-delete), and **Correct** (change relation type, direction, or description). |
| **F5** | **Immutable Change Audit Trail** | P0 | Append-only event store recording every entity/claim/relationship mutation with before/after state, timestamp, reason, and actor. |
| **F6** | **Document Versioning & Rollback** | P1 | Tracks document revisions (v1, v2) upon re-upload and allows reverting graph curation actions to any historical audit point. |
| **F7** | **Graph Visual Curation Toolbar** | P1 | On-canvas floating toolbar and dedicated drawer showing pending contradictions and audit history. |
