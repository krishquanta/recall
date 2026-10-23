# UI/UX Design — User Interface / User Experience Design (Phase 3)
> **Visual language, wireframes, interaction flows, and components for contradiction inspection, relationship curation, and version history**

---

## Workspace Layout & Extended Canvas Shell

Recall's header extends with dedicated badges for **Contradictions** and **Version History**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🧠 Recall   [ 💬 Chat ] [ 🕸️ Graph ]  [ ⚠️ Contradictions (2) ] [ ⚖️ Review (0) ] [ ⏱️ History ] │
├──────────────┬──────────────────────────────────────────┬──────────────────────────────┤
│              │                                          │                              │
│ LIBRARY      │           GRAPH EXPLORER                 │     CROSS-SOURCE COMPARISON  │
│ (sidebar)    │              (center)                    │        (right drawer)        │
│              │                                          │                              │
│ [+ Add]      │   ┌──────────────┐                       │  ⚠️ CONTRADICTION DETECTED   │
│              │   │ Greedy Model │                       │  Topic: Time Complexity      │
│ 📄 notes.pdf │   └──────┬───────┘                       │  Entity: Prim's Algorithm    │
│              │          │                               │  ──────────────────────────  │
│ 📑 book.pdf  │          │ ⚡ CONTRADICTS                │  SOURCE A: notes.pdf (P. 14) │
│ (v2 updated) │          ▼                               │  "Prim's runs in O(V^2)..."  │
│              │   ┌──────────────┐                       │  ──────────────────────────  │
│              │   │ O(E log V)   │ [Accept] [Correct]    │  SOURCE B: book.pdf (P. 310) │
│              │   └──────────────┘ [ Reject ]            │  "With fibonacci heaps, runs │
│              │                                          │  in O(E + V log V)..."       │
│              │   [ Zoom In / Out ] [ Reset ] [ Filter ] │                              │
│              │   Active Edges: 48 (5 Verified, 2 Stale) │  [ Prefer A ] [ Prefer B ]   │
│              │                                          │  [ Both Valid (Context) ]    │
└──────────────┴──────────────────────────────────────────┴──────────────────────────────┘
```

---

## Wireframes & Modals

### 1. Relationship Curation Popover
Hovering or clicking any relationship edge on the `@xyflow/react` canvas displays the inline curation popover:

```
┌─────────────────────────────────────────────────────────────────────┐
│  RELATIONSHIP CURATION                                          [×] │
├─────────────────────────────────────────────────────────────────────┤
│  Source:      Dijkstra's Algorithm                                  │
│  Target:      Negative Edge Weights                                 │
│  Type:        CANNOT_HANDLE                                         │
│  Status:      ⚪ Proposed (Gemini-3.8-flash extraction)             │
│  Confidence:  94%                                                   │
│                                                                     │
│  Evidence Quote:                                                    │
│  "Dijkstra fails when edges have negative weight cycles..."         │
│  Source: algorithms_ch4.pdf (Slide 22)                              │
├─────────────────────────────────────────────────────────────────────┤
│  [  Accept  ]      [  Reject  ]      [  Correct / Edit  ]           │
│  (Marks verified)  (Soft deletes)    (Re-type or invert edge)       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 2. "Correct Relationship" Modal
When the user clicks **[ Correct / Edit ]**, an intuitive modal opens allowing instant re-typing:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ✏️ Correct Relationship                                         [×] │
├─────────────────────────────────────────────────────────────────────┤
│  Source Entity:   Dijkstra's Algorithm                              │
│  Target Entity:   Negative Edge Weights                             │
│                                                                     │
│  Relation Type:                                                     │
│  [ PREREQUISITE_FOR ▼ ]                                             │
│    DEFINES                                                          │
│    IS_A                                                             │
│    PART_OF                                                          │
│  ✓ PREREQUISITE_FOR                                                 │
│    CAUSES                                                           │
│    USES                                                             │
│    CONTRADICTS                                                      │
│    PROVES                                                           │
│    EQUIVALENT_TO                                                    │
│    RELATED_TO                                                       │
│                                                                     │
│  Swap Direction:  [ ⇄ Invert Source & Target ]                      │
│                                                                     │
│  Correction Reason (Optional):                                      │
│  [ Textbook states Dijkstra requires non-negative weights as prereq]│
├─────────────────────────────────────────────────────────────────────┤
│                          [ Cancel ]  [ Save Correction & Log Audit ]│
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3. Version History & Audit Trail Modal
Clicking **[ ⏱️ History ]** in the top navbar displays the chronological event ledger with one-click rollback:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⏱️ Knowledge Graph Version History & Audit Log                          [×] │
├─────────────────────────────────────────────────────────────────────────────┤
│  Filter: [ All Actions ▼ ]   Search: [                     ]                │
├─────────────────────────────────────────────────────────────────────────────┤
│  • 10 mins ago · by User                                                    │
│    CORRECTED RELATIONSHIP                                                   │
│    Dijkstra's Algorithm ──► Negative Edge Weights                           │
│    Changed: RELATED_TO  ──►  PREREQUISITE_FOR                                │
│    Reason: "Prerequisite requirement specified in Ch. 4"                    │
│    [ ↩ Revert This Action ]                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  • 42 mins ago · by Ingestion System (Upload: lecture_notes_v2.pdf)         │
│    MERGED ENTITIES (AUTO)                                                   │
│    "SVD" merged into "Singular Value Decomposition" (Score: 0.98)           │
│    [ ↩ Revert Merge ]                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Yesterday, 16:30 · by User                                               │
│    REJECTED RELATIONSHIP                                                    │
│    Matrix Inversion ──► QuickSort (status: rejected)                        │
│    [ ↩ Restore Relationship ]                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Visual Design System & Edge Status Indicators

| Edge State | Visual Treatment in Canvas | Chip / Badge in Evidence Card |
|---|---|---|
| **Proposed** (AI-extracted) | Slate `#64748b`, dashed line (stroke-dasharray: 4) | `⚪ Proposed` (Gray) |
| **Verified** (Accepted by User) | Emerald `#059669`, thick solid line (2.5px), glowing dot | `🟢 Verified` (Green) |
| **Corrected** (Edited by User) | Indigo `#6366f1`, solid line, subtle pencil glyph | `🟣 Corrected` (Indigo) |
| **Rejected** (Soft-deleted) | Faded zinc `#d4d4d8`, 1px line, strikethrough label | `🔴 Rejected` (Muted Red) |
| **Contradictory** (Conflicting) | Rose `#e11d48`, pulsing animated dashed line | `⚠️ Contradiction` (Flashing Rose) |
| **Stale / Superseded** | Amber `#d97706`, dotted line with clock glyph | `⏳ Stale (v1)` (Amber) |

---

## Key Interaction Flows

### Flow A — Curating a Relationship
1. User hovers or clicks an edge in the Graph Canvas.
2. An inline popover shows the extraction confidence, source passage quote, and document location.
3. User selects **Accept** (edge turns solid emerald), **Reject** (edge fades or hides), or **Correct**.
4. If **Correct** is chosen, user selects a new relation type and enters an optional reason.
5. The graph updates instantly (<50ms) and an audit entry is appended.

### Flow B — Resolving Cross-Source Contradictions
1. User clicks the top navbar chip **[ ⚠️ Contradictions (2) ]**.
2. The right panel slides open showing the two opposing claims side-by-side with full verbatim context and publication dates.
3. User selects:
   - **"Prefer Newer Source (B)"**: Marks Source A as stale/superseded.
   - **"Both Valid in Context"**: Adds contextual scope (e.g. Euclidean vs Non-Euclidean) and dismisses alert.
   - **"Create Contradicts Edge"**: Explicitly connects both concepts with a permanent `CONTRADICTS` relation.

### Flow C — Inspecting History and Rolling Back
1. User opens **[ ⏱️ History ]**.
2. Scans recent mutations with clear diff highlights (red for removed/changed, green for added).
3. Clicks **[ ↩ Revert This Action ]** on any previous change.
4. System executes state rollback, restores prior graph topology, and displays confirmation toast.
