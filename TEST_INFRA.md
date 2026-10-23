# E2E Test Infrastructure & Test Suite Specification: Phase 3 Curation, Alignment, Contradiction Detection & Audit Rollback

**Document Version**: 2.0.0  
**Project**: Recall (AI Study Bank) — Phase 3  
**Authoritative Reference Sources**:
- `ORIGINAL_REQUEST.md` (§Phase 3 2026-10-22T05:56:24Z, Requirements R1–R6, Acceptance Criteria)
- `PROJECT.md` (§Architecture, §Feature Inventory, §Milestones, §Interface Contracts, §Code Layout)
- Phase 3 Specification Documents:
  - `plan/phase 3/1-PRD.md` (Product Requirements Document)
  - `plan/phase 3/2-TRD.md` (Technical Requirements Document)
  - `plan/phase 3/3-Architecture.md` (System Architecture)
  - `plan/phase 3/4-UIUX.md` (UI/UX Design & Wireframes)
  - `plan/phase 3/5-SDD.md` (Software Design Document & Service Contracts)
  - `plan/phase 3/6-Implementation-Plan.md` (Milestones M1–M7)

---

## 1. Executive Strategy & Testing Architecture

This document defines the comprehensive opaque-box End-to-End (E2E) testing infrastructure for Recall Phase 3:
1. **R1: Cross-Source Claim Comparison & Alignment** (`ClaimComparisonService`)
2. **R2: Contradiction & Staleness Detection Engine** (`ContradictionDetectionService` & `ContradictionStore`)
3. **R3: Interactive Relationship Curation Suite** (`RelationshipCurationService` & `GraphStore`)
4. **R4: Append-Only Audit Trail & Rollback Engine** (`AuditService` & `AuditStore`)
5. **R5: Interactive UI Integration** (Curation Popover, Contradiction Drawer, Version History Modal)
6. **R6: Local Persistence & VCS Invariant** (`data/graph.json`, `data/contradictions.json`, `data/audit_log.jsonl`)

```
                                  E2E Test Suite Runner
                       (backend/test/e2e/phase3_curation_audit.e2e.test.ts)
                                            │
          ┌─────────────────────────────────┼─────────────────────────────────┐
          │                                 │                                 │
          ▼                                 ▼                                 ▼
┌───────────────────┐             ┌───────────────────┐             ┌───────────────────┐
│ Tier 1: Feature   │             │ Tier 2: Boundary  │             │ Tier 3: Cross-    │
│ Coverage (>=30)   │             │ & Corners (>=30)  │             │ Feature (>=15)    │
└────────┬──────────┘             └────────┬──────────┘             └────────┬──────────┘
         │                                 │                                 │
         └─────────────────────────────────┼─────────────────────────────────┘
                                           ▼
                                 ┌───────────────────┐
                                 │  Tier 4: E2E      │
                                 │  Scenarios (>=6)  │
                                 └─────────┬─────────┘
                                           │
                                           ▼
                      Progressive Testability & Mock Test Harness
            (Deterministic Embeddings, Contradiction Mocks, Storage Isolation)
```

### Progressive Testability Architecture
To support phased milestone execution (M1 through M7) where tests must run and remain 100% green without breaking the build before implementation code is committed:
- **Module Existence Introspection**: The test harness detects whether target service files (`AuditService.ts`, `RelationshipCurationService.ts`, `ClaimComparisonService.ts`, `ContradictionDetectionService.ts`) exist on disk.
- **Dynamic Module Resolution**: Test suites use dynamic imports and conditional test skips (`describe.skipIf` / `it.skipIf`) so live service tests activate automatically once the corresponding implementation files land.
- **Specification Invariant Verification**: All core domain state machine rules, heuristic regex patterns, consensus scoring formulas, JSONL serialization properties, and rollback topological restoration invariants are verified through active contract tests that execute in every test run.

---

## 2. Feature Inventory: Mapping Phase 3 Requirements (R1–R6)

| Req ID | Feature Name | Description | Target Milestone | Primary Reference |
|---|---|---|---|---|
| **R1** | Cross-Source Claim Alignment & Consensus | Cluster atomic claims for shared entities across distinct documents ($docId_A \neq docId_B$), compute semantic similarity $S_c \in [0, 1]$, and derive consensus agreement score $C \in [0, 1]$. | M3 | `ORIGINAL_REQUEST §R1`, `TRD §FR-1`, `SDD §3` |
| **R2** | Contradiction & Staleness Detection Engine | Detect direct negation, divergent quantities, incompatible conditions, and temporal staleness using Tier 1 heuristics + Tier 2 LLM schemas. Store alerts in `data/contradictions.json`. | M4 | `ORIGINAL_REQUEST §R2`, `TRD §FR-2, §FR-3`, `SDD §4` |
| **R3** | Interactive Relationship Curation Suite | Curation state machine (`proposed` -> `verified` [Accept], `rejected` [Reject], `corrected` [Correct]). Soft-deleted edges isolated from active search traversals. | M2 | `ORIGINAL_REQUEST §R3`, `TRD §FR-4`, `SDD §2` |
| **R4** | Append-Only Audit Trail & Rollback Engine | Immutable event stream (`data/audit_log.jsonl`) logging all graph mutations with before/after state diffs. Atomic rollback restoring prior graph topology. | M1, M5 | `ORIGINAL_REQUEST §R4`, `TRD §FR-5`, `SDD §1` |
| **R5** | Interactive UI Integration | Contracts for canvas curation popover, relation edit modal, right-hand contradiction drawer, and version history modal with rollback triggers. | M5, M6 | `ORIGINAL_REQUEST §R5`, `TRD §FR-4, §FR-5`, `UIUX §1-3` |
| **R6** | Local Persistence & VCS Invariant | Strictly store data in `data/graph.json`, `data/contradictions.json`, `data/audit_log.jsonl` with atomic write safety and zero git tracking. | All (M1-M7) | `ORIGINAL_REQUEST §R6`, `TRD §Constraints` |

---

## 3. Offline Execution & Mock Strategies

To ensure tests run 100% deterministically in offline CI environments within seconds without billable credits or network latency:

1. **Deterministic Semantic Vector Generation**:
   - Semantic text embeddings are generated using a deterministic seeded pseudo-random distribution combining a conceptual topic vector with a unique text hash:
     $$\vec{v} = \frac{\alpha \vec{v}_{\text{topic}} + \beta \vec{v}_{\text{text}}}{\|\alpha \vec{v}_{\text{topic}} + \beta \vec{v}_{\text{text}}\|}$$
     where $\alpha = 0.92$, $\beta = \sqrt{1 - \alpha^2} \approx 0.392$, and $\vec{v}_{\text{topic}}$ is keyed by `sha256("topic::" + topic)` and $\vec{v}_{\text{text}}$ by `sha256("text::" + text)`.
   - Vectors are 768-dimensional and strictly unit-normalized ($\|\vec{v}\| = 1.0$) so that cosine similarity $\cos(\vec{u}, \vec{v}) = \vec{u} \cdot \vec{v}$.
   - Concordant claims sharing conceptual topics exhibit high cosine similarity ($\ge 0.85$, normalized $(S+1)/2 \ge 0.90$), while contrasting or divergent topics exhibit low cosine similarity ($< 0.50$). Identical text produces perfect unit cosine similarity ($1.0$).

2. **Controlled Mock Contradiction Evaluator**:
   - Emulates the Gemini Tier 2 structured JSON output contract:
     ```json
     {
       "isContradiction": true,
       "contradictionType": "direct_negation",
       "severity": "high",
       "explanation": "Doc A asserts X causes Y, whereas Doc B asserts X does not cause Y.",
       "reconciliationHint": "Verify experimental conditions or edition differences."
     }
     ```
   - Supports configurable overrides for specific claim pairs to test edge cases without network calls.

3. **Isolated Test Storage Harness**:
   - Test suites construct temporary sandboxes for `graph.json`, `contradictions.json`, and `audit_log.jsonl`.
   - Cleans up all temporary files in `beforeEach` and `afterEach` hooks using atomic cleanup routines.

---

## 4. Expected Output Derivation Methodology

For every test case across Tiers 1–4, expected values are derived strictly from authoritative specifications:
1. **Consensus Agreement Formula**:
   - For an entity claim cluster with $M$ pairwise claim similarities $S_{ij} = \cos(\vec{v}_i, \vec{v}_j)$:
     $$C = \frac{1}{\binom{M}{2}} \sum_{i < j} S_{ij}$$
   - When all claims agree, $C \ge 0.85$. When claims directly conflict or diverge, $C < 0.60$ and `hasContradiction = true`.
2. **Curation State Transitions**:
   - Accept: `proposed` $\to$ `verified`. Sets `curatedAt = timestamp`. Evidence retained.
   - Reject: `proposed` $\to$ `rejected`. Edge remains in storage for audit but is filtered out from `getSubgraph()` and active search traversals.
   - Correct: `proposed` $\to$ `corrected`. Sets `originalRelationType = previousType`, updates `relationType` or inverts `sourceId`/`targetId`, sets `curatedAt = timestamp`.
3. **Audit Immutability & Rollback Restoration**:
   - Every mutation appends exactly one line to `data/audit_log.jsonl`. File line count strictly increments by 1 per mutation.
   - Calling `rollback(auditId)` restores the exact `beforeState` into `GraphStore` / `ContradictionStore`.
   - Rollback appends an inverse audit event with `action = 'rollback'` and `rollbackRefId = auditId`.
4. **Staleness Heuristic**:
   - When conflicting claims exist between documents $A$ and $B$, if $B$ has publication date/version $> A$, claim $A$ receives `isStale: true` and `supersededByClaimId: claimB.id`.
   - Explicit deprecation phrases (e.g., `"superseded by"`, `"previously assumed"`, `"deprecated in version"`) trigger `isStale: true`.

---

## 5. Tier 1: Feature Coverage (>=5 Test Cases Per Feature)

### Feature R1: Cross-Source Claim Comparison & Alignment
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R1-01` | Entity Claim Cross-Doc Clustering | Claims mentioning entity $E_1$ across Doc 1 and Doc 2 | Clustered into `ClaimComparisonCluster` with `entityId = E1`; intra-document claims isolated | `ORIGINAL_REQUEST §R1`, `TRD §FR-1` |
| `T1-R1-02` | High Consensus Pairwise Scoring | 2 concordant claims from Doc 1 and Doc 2 ("ATP is primary energy currency") | Consensus score $C \ge 0.85$; `hasContradiction = false` | `TRD §FR-1`, `SDD §3` |
| `T1-R1-03` | Divergent Claim Consensus Drop | 2 diverging claims ("Bellman-Ford handles negative weights" vs "Dijkstra fails on negative weights") | Consensus score $C < 0.65$; claims clustered under same topic group | `TRD §FR-1`, `SDD §3` |
| `T1-R1-04` | Aligned Claim Provenance Coordinates | Aligned claims from distinct documents | Every claim retains `docId`, `filename`, `chunkId`, and `exactQuote` with valid character offsets | `ORIGINAL_REQUEST §Acceptance`, `TRD §FR-1` |
| `T1-R1-05` | REST Endpoint Claims Comparison | `GET /api/graph/claims/compare?entityId=E1` | HTTP 200, returns `{ clusters: ClaimComparisonCluster[] }` | `PROJECT.md §Route Specs`, `SDD §REST` |
| `T1-R1-06` | Multi-Document 3-Way Claim Clustering | 3 claims from Doc 1, Doc 2, Doc 3 for same entity | Grouped into single cluster; pairwise consensus averaged across 3 pairs | `TRD §FR-1` |

### Feature R2: Contradiction & Staleness Detection Engine
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R2-01` | Tier 1 Heuristic Direct Negation | Claims: "X activates enzyme Y" vs "X does not activate enzyme Y" | Flagged by Tier 1 heuristic as `direct_negation`; contradiction alert created | `TRD §FR-2`, `SDD §4` |
| `T1-R2-02` | Opposing Relationship Edge Conflict | Edge Doc 1: `A -> CAUSES -> B`; Edge Doc 2: `A -> PREVENTS -> B` | Flagged as opposing edge contradiction; `contradictionType = 'direct_negation'` | `TRD §FR-2` |
| `T1-R2-03` | Divergent Numerical Quantities | Doc 1: "Speed of light is 300,000 km/s"; Doc 2: "Speed of light is 200,000 km/s" | Flagged as `divergent_quantities` with `severity = 'high'` | `TRD §FR-2` |
| `T1-R2-04` | Contradiction Persistence & Alert Query | Detected contradiction saved to `data/contradictions.json` | `GET /api/graph/contradictions?status=active` returns alert with both quotes and doc coordinates | `ORIGINAL_REQUEST §R2`, `SDD §REST` |
| `T1-R2-05` | Contradiction Resolution Workflow | Resolve alert via `POST /api/graph/contradictions/:id/resolve` with `prefer_a` | Alert status transitions to `resolved_claim_a`; resolutionNote saved; audit logged | `ORIGINAL_REQUEST §R2`, `TRD §FR-2` |
| `T1-R2-06` | Explicit Staleness Phrase Tagging | Claim text: "This protocol is superseded by the 2024 revision" | Claim tagged with `isStale: true`; temporal staleness marker recorded | `ORIGINAL_REQUEST §R2`, `TRD §FR-3` |
| `T1-R2-07` | Publication Date Version Staleness | Doc A (2018): "Planet count is 9"; Doc B (2024): "Planet count is 8" | Doc A claim tagged with `isStale: true` and `supersededByClaimId` pointing to Doc B | `TRD §FR-3` |

### Feature R3: Interactive Relationship Curation Suite
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R3-01` | Accept Proposed Relationship Edge | `POST /api/graph/relationships/:id/curate` with `{ action: 'accept' }` | `curationStatus` becomes `verified`; `curatedAt` timestamp set; audit entry logged | `ORIGINAL_REQUEST §R3`, `TRD §FR-4` |
| `T1-R3-02` | Reject Relationship Edge (Soft-Delete) | `POST /api/graph/relationships/:id/curate` with `{ action: 'reject' }` | `curationStatus` becomes `rejected`; edge retained in storage; audit entry logged | `ORIGINAL_REQUEST §R3`, `TRD §FR-4` |
| `T1-R3-03` | Rejected Edge Excluded from Subgraph | Edge marked `rejected`; query `graphStore.getSubgraph(...)` | Rejected edge omitted from returned subgraph edges | `PROJECT.md §Feature 8`, `TRD §FR-4` |
| `T1-R3-04` | Correct Edge Relation Type | `POST /api/graph/relationships/:id/curate` with `{ action: 'correct', relationType: 'PREREQUISITE_FOR' }` | Edge updated to `PREREQUISITE_FOR`; `originalRelationType` preserves initial type; status `corrected` | `ORIGINAL_REQUEST §R3`, `TRD §FR-4` |
| `T1-R3-05` | Correct Edge Direction Inversion | `POST /api/graph/relationships/:id/curate` with `{ action: 'correct', invertDirection: true }` | `sourceId` and `targetId` swapped; status `corrected`; original type preserved | `ORIGINAL_REQUEST §R3`, `TRD §FR-4` |
| `T1-R3-06` | Edge Provenance Preservation on Curation | Edge curated with Accept or Correct | `evidence` object (verbatim quote, chunkId, docId) remains strictly unchanged | `ORIGINAL_REQUEST §Acceptance`, `TRD §FR-4` |

### Feature R4: Append-Only Audit Trail & Rollback Engine
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R4-01` | Append-Only Stream Serialization | Trigger edge curation action | New entry appended to `data/audit_log.jsonl`; valid JSON format; file size increments | `ORIGINAL_REQUEST §R4`, `TRD §FR-5` |
| `T1-R4-02` | Audit Entry Schema & Diff Integrity | Curation action modifies relationType from `USES` to `CAUSES` | Audit entry contains `beforeState.relationType = 'USES'`, `afterState.relationType = 'CAUSES'` | `TRD §FR-5`, `SDD §1` |
| `T1-R4-03` | Reverse Chronological Audit Query | `GET /api/graph/audit-log?limit=10` | Returns entries sorted newest first; contains monotonic timestamps | `PROJECT.md §Route Specs`, `SDD §REST` |
| `T1-R4-04` | Target-Filtered Audit Query | `GET /api/graph/audit-log?targetId=edge_123` | Returns only mutation events where `targetId === 'edge_123'` | `TRD §FR-5`, `SDD §1` |
| `T1-R4-05` | Atomic Rollback of Edge Rejection | Call `POST /api/graph/audit-log/:id/rollback` for rejected edge | Edge status restored from `rejected` to previous status (`proposed`); inverse audit event logged | `ORIGINAL_REQUEST §R4`, `TRD §FR-5` |
| `T1-R4-06` | Atomic Rollback of Edge Correction | Call rollback for edge that had direction inverted and type changed | Original `sourceId`, `targetId`, and `relationType` restored; graph topology valid | `ORIGINAL_REQUEST §R4`, `TRD §FR-5` |

### Feature R5: Interactive UI Integration
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R5-01` | Curation Popover Action Payloads | Trigger Accept, Reject, Correct from canvas mock client | REST API responds HTTP 200 with `{ edge, auditEntry }` matching frontend store types | `PROJECT.md §Route Specs`, `UIUX §Wireframe 1` |
| `T1-R5-02` | Dynamic Edge Visual Styling States | Edge with status `verified`, `rejected`, `corrected`, `hasContradiction` | Returns exact CSS style classes / stroke attributes specified in design system | `ORIGINAL_REQUEST §R5`, `UIUX §Visual Design` |
| `T1-R5-03` | Contradiction Drawer Data Payload | `GET /api/graph/contradictions` for active alerts | Payload contains `quoteA`, `quoteB`, `filenameA`, `filenameB`, `explanation` for side-by-side rendering | `ORIGINAL_REQUEST §R5`, `UIUX §Wireframe 1` |
| `T1-R5-04` | Version History Modal Timeline Feed | `GET /api/graph/audit-log` with pagination | Payload contains human-readable action summaries, timestamps, and diff snippets | `ORIGINAL_REQUEST §R5`, `UIUX §Wireframe 3` |
| `T1-R5-05` | Contradiction Counter Badge Contract | Count of alerts where `status === 'active'` | Counter matches total active alerts in store; decrements immediately when resolved | `ORIGINAL_REQUEST §R5`, `UIUX §Layout` |
| `T1-R5-06` | One-Click Rollback Action Trigger | Version History modal triggers rollback button | Backend executes rollback; emits updated edge state to refresh canvas without reload | `ORIGINAL_REQUEST §R5`, `UIUX §Wireframe 3` |

### Feature R6: Local Persistence & VCS Invariant
| Test ID | Test Name | Input | Expected Output | Authoritative Reference |
|---|---|---|---|---|
| `T1-R6-01` | Atomic File Persistence | Mutations to `graph.json`, `contradictions.json`, `audit_log.jsonl` | Atomic writes via temporary files; zero file corruption or zero-byte truncation | `ORIGINAL_REQUEST §R6`, `TRD §Non-Functional` |
| `T1-R6-02` | Cold-Start Rehydration Durability | Reload stores from disk after writes | All curated edges, contradiction alerts, and audit logs rehydrate identically | `TRD §Non-Functional` |
| `T1-R6-03` | VCS Invariant (No Git Commits/Pushes) | Full curation, contradiction, and rollback cycle | No git commands (`git commit`, `git push`) executed; disk state strictly local | `ORIGINAL_REQUEST §R6, §Acceptance` |
| `T1-R6-04` | Audit Log JSONL Append Integrity | Append 10 sequential audit events | `audit_log.jsonl` has exactly 10 lines; each line is a valid parseable JSON object | `ORIGINAL_REQUEST §R4`, `SDD §1` |
| `T1-R6-05` | Data Directory Auto-Creation | Configure test store in non-existent directory | Directory created recursively; files initialized safely without exception | `SDD §1` |

---

## 6. Tier 2: Boundary & Corner Cases (>=5 Test Cases Per Feature)

### Feature R1: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R1-01` | Zero Shared Entities Between Documents | Two documents with disjoint vocabularies | Returns empty cluster array without error or unhandled exceptions |
| `T2-R1-02` | Single Claim in Cluster (No Pair Available) | Entity mentioned in only one document | Cluster generated with 1 claim; consensus score set to default 1.0 (no contradiction) |
| `T2-R1-03` | Massive Claim Text Exceeding 10,000 Characters | Extremely verbose academic quote | Hashed and embedded cleanly; similarity calculation does not buffer-overflow |
| `T2-R1-04` | Identical Verbatim Claims Across Documents | Exact same sentence in Doc A and Doc B | Cosine similarity $S_c = 1.0$; consensus score $C = 1.0$; zero contradiction |
| `T2-R1-05` | Special Characters & Math Notation in Claims | Formulas with LaTeX, Unicode subscripts, and emojis | Parsed and clustered without stripping valid evidentiary characters |

### Feature R2: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R2-01` | Contextual Exception vs Direct Negation | Claims: "A causes B in vivo" vs "A does not cause B in vitro" | Tier 2 LLM classifies as `contextual_exception` with medium severity rather than hard negation |
| `T2-R2-02` | Resolving Already Resolved Alert | POST resolve on alert with `status = 'resolved_claim_a'` | Returns HTTP 400 Bad Request or idempotent response; does not corrupt audit trail |
| `T2-R2-03` | Resolving Non-Existent Contradiction ID | POST `/api/graph/contradictions/invalid-uuid/resolve` | Returns HTTP 404 Not Found with descriptive error message |
| `T2-R2-04` | Malformed Date String in Document Metadata | Metadata date = `"undated"` or invalid timestamp | Staleness evaluation ignores malformed date gracefully without throwing |
| `T2-R2-05` | Circular Contradiction Triplet | Doc A contradicts Doc B, Doc B contradicts Doc C, Doc C contradicts Doc A | 3 distinct contradiction alerts generated without infinite loop |
| `T2-R2-06` | Same Document Contrasting Statements | Two conflicting sentences inside the exact same document | Ignored by cross-source engine ($docId_A == docId_B$) per specification |

### Feature R3: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R3-01` | Curating Non-Existent Edge ID | POST `/api/graph/relationships/missing_edge/curate` | Returns HTTP 404 Not Found; zero audit events emitted |
| `T2-R3-02` | Redundant Curation State Transition | Accept an edge that is already `verified` | Idempotent HTTP 200; edge remains `verified`; timestamp updated |
| `T2-R3-03` | Double Inversion of Relationship Direction | Invert direction twice sequentially | `sourceId` and `targetId` return to initial positions; status remains `corrected` |
| `T2-R3-04` | Correction with Unknown Relation Type | POST correct with invalid relationType string | Returns HTTP 400 Bad Request; edge remains unchanged |
| `T2-R3-05` | Extremely Long Curation Reason String | Reason containing 5,000 characters | Saved cleanly into `curationReason` and audit entry without truncation |
| `T2-R3-06` | Self-Loop Edge Direction Inversion | Edge where `sourceId === targetId` | Direction swap is safely handled without creating orphan pointers |

### Feature R4: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R4-01` | Rolling Back Non-Existent Audit ID | POST `/api/graph/audit-log/bad_id/rollback` | Returns HTTP 404 Not Found with clear error explanation |
| `T2-R4-02` | Double Rollback of Same Mutation | Call rollback twice on the exact same audit entry | Second rollback returns HTTP 400 or logs warning that mutation is already rolled back |
| `T2-R4-03` | Rollback of a Rollback Mutation | Attempt to roll back an entry where `action === 'rollback'` | Properly handles recursive reversion or rejects with informative validation error |
| `T2-R4-04` | Corrupted JSONL Line in Audit Log | File contains a corrupted line among valid entries | AuditStore skips corrupted line with warning; parses all remaining valid records |
| `T2-R4-05` | Concurrent Audit Log Appends | 25 simultaneous curation events dispatched | File lock / append mutex ensures 0 interleaved or mangled lines |
| `T2-R4-06` | Audit Query with Negative or Zero Limit | GET `/api/graph/audit-log?limit=-5` | Clamped to safe default (e.g. 50) without crashing server |

### Feature R5: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R5-01` | Contradiction Drawer When Zero Alerts Exist | Open drawer when `activeCount === 0` | Renders clean empty state ("No active contradictions detected across sources") |
| `T2-R5-02` | Rapid Consecutive Popover Action Clicks | User clicks Accept then Reject within 50ms | Requests serialized safely; final state reflects last successful action |
| `T2-R5-03` | Extremely Large Audit Timeline (1,000+ entries) | History modal loads with large log file | Paginated or virtualized; response time $\le 80$ms |
| `T2-R5-04` | Canvas Interaction on Soft-Deleted Edge | Attempting to curate an already rejected edge | Allows un-rejecting or correcting edge through details inspector |
| `T2-R5-05` | Side-by-Side Drawer with Missing Quote Offset | One source document lacks charOffset data | Fallback quote rendering displays verbatim text cleanly without UI crash |

### Feature R6: Boundary & Corner Cases
| Test ID | Test Name | Input / Edge Condition | Expected Output |
|---|---|---|---|
| `T2-R6-01` | Disk Full / Unwriteable Directory Simulation | Write to read-only directory | Graceful error emission; existing data files not corrupted |
| `T2-R6-02` | Trailing Newline Consistency in JSONL | Sequential appends and file reads | Always maintains clean single trailing newline; no empty parsed entries |
| `T2-R6-03` | Rapid Server Restart During Write Lock | Server reboot while atomic temp file exists | `sweepAllTempFilesSync` cleans up `.tmp` files on reboot; main file clean |
| `T2-R6-04` | Empty Initial Data Files | `graph.json` contains `{}` and `audit_log.jsonl` is 0 bytes | Stores initialize with empty maps; 0 null pointer exceptions |
| `T2-R6-05` | Git Cleanliness Verification | Inspect git status during and after test run | No untracked files added to git index; no commits or tags created |

---

## 7. Tier 3: Cross-Feature Combinations (Pairwise Coverage)

| Test ID | Features Combined | Interaction Under Test | Expected Behavior |
|---|---|---|---|
| `T3-COMB-01` | R3 (Curation) + R4 (Audit) | User accepts proposed edge `edge_1` | `edge_1.curationStatus` becomes `verified`; audit log records `edge_curate_accept` with before/after diff. |
| `T3-COMB-02` | R3 (Curation) + R1/Search | User rejects edge `edge_2`; then runs search traversal | `edge_2` is filtered out from search results and Q&A context chunks. |
| `T3-COMB-03` | R3 (Curation) + R4 (Rollback) | User rejects `edge_3`; user immediately rolls back rejection | `edge_3` is restored to `proposed`; edge immediately reappears in active search traversals. |
| `T3-COMB-04` | R1 (Alignment) + R2 (Contradiction) | Aligned claim cluster has $C = 0.40$ due to contrasting statements | Contradiction detection engine automatically generates a `ContradictionAlert`. |
| `T3-COMB-05` | R2 (Contradiction) + R4 (Audit) | User resolves contradiction alert with `prefer_a` | Contradiction alert marked resolved; `contradiction_resolve` event logged to audit stream. |
| `T3-COMB-06` | R2 (Contradiction) + R4 (Rollback) | User rolls back contradiction resolution | Contradiction alert status reverts from `resolved_claim_a` to `active`. |
| `T3-COMB-07` | R1 (Alignment) + R2 (Staleness) | Doc A (v1) and Doc B (v2) have aligned claims on same topic | Claim from Doc A tagged with `isStale: true` and lowered in ranking; Doc B claim prioritized. |
| `T3-COMB-08` | R2 (Staleness) + R6 (Persistence) | Re-upload document revision; detect staleness; reboot server | Staleness tags and `supersededByClaimId` references rehydrate intact from `graph.json`. |
| `T3-COMB-09` | R3 (Direction Inversion) + R4 (Audit) | Correct edge by inverting direction | Audit log beforeState shows original `(sourceId, targetId)`, afterState shows inverted `(targetId, sourceId)`. |
| `T3-COMB-10` | R3 (Multi-Step) + R4 (Step-by-Step Rollback) | Edge undergoes Accept $\to$ Correct $\to$ Reject; roll back 3 times in reverse | Edge precisely returns: `rejected` $\to$ `corrected` $\to$ `verified` $\to$ `proposed`. |
| `T3-COMB-11` | R2 (Contradiction) + R3 (Edge Tagging) | Resolving contradiction with `explicit_contradicts_edge` | Synthesizes bidirectional `CONTRADICTS` edge in `GraphStore` with `curationStatus = 'verified'`. |
| `T3-COMB-12` | R4 (Audit Store) + R6 (Local Persistence) | Log 50 mutations; restart server; query history | All 50 audit entries reloaded from `data/audit_log.jsonl` in exact chronological order. |
| `T3-COMB-13` | R5 (UI Routes) + R3 (Curation Service) | Send `POST /api/graph/relationships/:id/curate` via HTTP client | State updates in `GraphStore`; returns HTTP 200 matching UI state requirements. |
| `T3-COMB-14` | R5 (UI Drawer) + R2 (Contradiction Alerts) | Query `GET /api/graph/contradictions?status=active` | Returns active alerts formatted for side-by-side rendering with source quotes and coordinates. |
| `T3-COMB-15` | R5 (UI History) + R4 (Audit Log Query) | Query `GET /api/graph/audit-log?limit=25` | Returns 25 latest events with before/after state diffs for Version History modal timeline. |

---

## 8. Tier 4: Real-World Application Scenarios

### Scenario 1: Multi-Document Biology Textbook Conflict Resolution (`T4-SCEN-01`)
- **Workflow**:
  1. User ingests Doc A (*Campbell Biology 11th Ed*) and Doc B (*OpenStax Biology 2nd Ed*).
  2. Both documents contain claims regarding light-independent reactions of photosynthesis.
  3. Doc A states: *"The Calvin cycle takes place in the stroma and requires light indirectly."*
  4. Doc B states: *"The dark reactions occur strictly in the absence of light."*
  5. Contradiction engine flags `direct_negation` with `severity = 'high'`.
  6. User opens Contradiction Drawer, inspects side-by-side quotes, and resolves with *"Prefer Source A (Doc A)"*.
  7. Contradiction status becomes `resolved_claim_a`; audit log records resolution; graph reflects verified claim.
- **Verification**:
  - Contradiction alert created with valid `docIdA` and `docIdB`.
  - Resolution persists to `data/contradictions.json` and `data/audit_log.jsonl`.
  - Q&A search prioritizes Doc A claim and suppresses contradicted claim.

### Scenario 2: Algorithm Complexity & Negative Edge Discrepancy Correction (`T4-SCEN-02`)
- **Workflow**:
  1. Ingest algorithms syllabus (Doc 1) and lecture transcript (Doc 2).
  2. Extraction engine proposes edge: `Dijkstra -> HANDLES -> Negative Edge Weights` (extracted with low confidence).
  3. User inspects graph canvas, spots erroneous edge, and opens Edge Curation Popover.
  4. User clicks `[ Correct ]`, changes relationType to `INCOMPATIBLE_WITH`, and adds note: *"Dijkstra fails with negative cycles; Bellman-Ford required"*.
  5. Later, user notices direction was inverted (`Negative Edge Weights -> INCOMPATIBLE_WITH -> Dijkstra`), clicks `[ ⇄ Invert ]`.
- **Verification**:
  - `originalRelationType` preserved as `HANDLES`.
  - `curationStatus` transitions to `corrected`.
  - Two distinct audit entries logged (`edge_curate_correct` for type edit, then for inversion).
  - Graph query verifies correct source/target orientation and relation type.

### Scenario 3: Accidental Relationship Deletion & Instant One-Click Rollback (`T4-SCEN-03`)
- **Workflow**:
  1. User reviews relationship `Cell Membrane -> REGULATES -> Osmotic Pressure`.
  2. User accidentally clicks `[ Reject ]`, turning the edge status to `rejected`.
  3. Search traversal verifies that the edge is now excluded from Q&A context.
  4. User realizes mistake, opens `[ ⏱️ History ]` (Version History Modal), and finds the latest `edge_curate_reject` entry.
  5. User clicks `[ ↩ Revert This Action ]`.
  6. Backend invokes `POST /api/graph/audit-log/:id/rollback`, restoring previous `verified` state.
- **Verification**:
  - Edge `curationStatus` returns to `verified`.
  - Edge immediately re-included in `graphStore.getSubgraph()`.
  - Audit log contains inverse `rollback` event referencing the rejected audit ID.

### Scenario 4: Course Syllabus Grading Policy Re-Upload & Staleness Tagging (`T4-SCEN-04`)
- **Workflow**:
  1. Ingest Course Syllabus v1 (Doc 1, published August 2024): *"Late penalty is 10% per day up to 3 days."*
  2. Ingest Course Syllabus v2 (Doc 2, published October 2024, revision of Doc 1): *"Late submissions are no longer accepted; 0% credit."*
  3. Cross-document claim alignment detects topic overlap on *"Late submission policy"*.
  4. Temporal staleness engine identifies Doc 2 as superseding Doc 1 based on publication date and version.
  5. Doc 1 claim tagged with `isStale: true` and `supersededByClaimId` pointing to Doc 2 claim.
- **Verification**:
  - `GET /api/graph/claims/compare` returns group with `hasStaleClaim = true`.
  - Doc 1 claim exhibits `isStale === true`.
  - Search Q&A for "What is the late penalty?" returns Doc 2 policy with note that Doc 1 policy is superseded.

### Scenario 5: High-Velocity Rapid-Fire Collaborative Curation Burst (`T4-SCEN-05`)
- **Workflow**:
  1. Simulate 30 rapid-fire curation actions (10 accepts, 10 rejections, 10 corrections) dispatched concurrently within 200ms.
  2. AuditStore processes writes through sequential file lock / mutex.
  3. GraphStore applies memory mutations and saves state atomically.
- **Verification**:
  - Exactly 30 lines appended to `data/audit_log.jsonl`.
  - Zero JSON syntax errors or half-written records.
  - All 30 target edges reflect their final intended curation states.
  - No orphaned temp files left in `data/`.

### Scenario 6: End-to-End Automated Contradiction Flagging, User Review & Graph Disambiguation (`T4-SCEN-06`)
- **Workflow**:
  1. Multi-document upload triggers background contradiction detection.
  2. System detects factual conflict between two medical guidelines regarding medication dosage.
  3. Contradiction count in header badge increments from 0 to 1 (`[ ⚠️ Contradictions (1) ]`).
  4. User clicks header badge, opening `ContradictionDrawer`.
  5. User selects *"Prefer Source B"*, adding explanation: *"Follows latest 2024 FDA guidance"*.
  6. System marks alert resolved, updates relationship edge confidence, and appends audit event.
- **Verification**:
  - Header badge count returns to 0.
  - Alert status in `data/contradictions.json` is `resolved_claim_b`.
  - Edge confidence and description reflect preference for Source B.
  - Audit record captures full before/after state and user explanation.

---

## 9. Execution Commands & Verification Matrix

| Target | Command | Expected Result |
|---|---|---|
| **Phase 3 E2E Test Suite Only** | `pnpm --prefix backend test backend/test/e2e/phase3_curation_audit.e2e.test.ts` | 100% passing tests (zero broken tests) |
| **Phase 2 Optimization E2E Suite** | `pnpm --prefix backend test backend/test/e2e/gemini_optimization.e2e.test.ts` | 100% passing tests (54/54) |
| **Full Backend Test Suite** | `pnpm --prefix backend test` | All test files pass with 0 failures |
| **Backend TypeScript Build** | `pnpm --prefix backend build` | 0 TypeScript compilation errors |
| **Full Monorepo Build** | `pnpm build` | 0 backend TS errors, 0 frontend Vite errors |
