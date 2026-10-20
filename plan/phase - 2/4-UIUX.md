# UI/UX Design — User Interface / User Experience Design (Phase 2)
> **Knowledge Graph Exploration, Provenance Inspection, and Review Queue Interfaces**

---

## Workspace Layout with Graph View

Recall extends its three-panel shell by introducing a seamless **View Mode Toggle** in the center header: **[ Chat Mode 💬 ]** vs **[ Graph Mode 🕸️ ]**, while preserving the left **Library Sidebar** and right **Source Preview Panel**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🧠 Recall          [ 💬 Chat ]  [ 🕸️ Graph ]   [ ⚖️ Review Queue (3) ]   [Settings ⚙]   │
├──────────────┬──────────────────────────────────────────┬──────────────────────────────┤
│              │                                          │                              │
│ LIBRARY      │           GRAPH EXPLORER                 │        EVIDENCE PREVIEW      │
│ (sidebar)    │              (center)                    │        (right panel)         │
│              │                                          │                              │
│ [+ Add]      │   ┌──────────────┐                       │  ┌────────────────────────┐  │
│              │   │ Eigenvalues  │                       │  │ 📑 LinearAlgebra.pdf   │  │
│ 📄 math.pdf  │   └──────┬───────┘                       │  │ Page 42 · Paragraph 3  │  │
│              │          │                               │  ├────────────────────────┤  │
│ 📽️ lec3.pptx │          │ PREREQUISITE_FOR [1]          │  │ "Eigenvalues are roots │  │
│              │          ▼                               │  │ of the characteristic  │  │
│ 📊 data.xlsx │   ┌──────────────┐       IS_A [2]        │  │ polynomial..."         │  │
│              │   │     PCA      ├────────────────►...   │  └────────────────────────┘  │
│              │   └──────────────┘                       │                              │
│              │                                          │  Claim: Fact (conf: 0.96)    │
│              │   [ Zoom In / Out ] [ Reset ] [ Filter ] │  Relationship: PREREQ_FOR    │
└──────────────┴──────────────────────────────────────────┴──────────────────────────────┘
```

---

## Key Interaction Flows

### Flow A — Graph Exploration & Evidence Inspection (DoD Focus)
1. User clicks **[ 🕸️ Graph ]** in top navbar.
2. The center panel transitions into an interactive force-directed graph canvas displaying concepts (color-coded by type: e.g. blue for `Concept`, emerald for `Theorem`, amber for `Formula`).
3. Directional arrows display relation chips (e.g. `PREREQUISITE_FOR`, `DEFINES`, `CONTRADICTS`).
4. **Clicking any Edge or Node**:
   - Right-side **Preview Panel** immediately snaps open.
   - Shows the exact source document, page/slide/row, and highlights the **exact verbatim quote** that established this relationship.
   - User can click "Open Full Page" to jump into the document view.

---

### Flow B — Uncertain Match Review Queue Modal
1. Top bar displays an orange indicator chip: **[ ⚖️ Review Queue (3) ]** when uncertain matches are detected during ingestion.
2. Clicking it opens a focused modal side-by-side comparison:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚖️ Review Duplicate Entity Matches (1 of 3)                                │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  PROPOSED CANDIDATE                  │  EXISTING GRAPH ENTITY               │
├──────────────────────────────────────┼──────────────────────────────────────┤
│  Name: "SVD"                         │  Name: "Singular Value Decomposition"│
│  Type: Method                        │  Type: Method                        │
│  Doc:  lecture_4.pptx (Slide 12)     │  Doc:  textbook_ch3.pdf (Page 88)    │
│                                      │  Known Aliases: ["S.V.D."]           │
│  Evidence Quote:                     │  Evidence Quote:                     │
│  "We compute the SVD of matrix A to  │  "The Singular Value Decomposition   │
│  find low-rank approximations..."    │  decomposes any m x n matrix..."     │
├──────────────────────────────────────┴──────────────────────────────────────┤
│  Cosine Similarity: 88.4% (Uncertain threshold)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  [ Keep Separate (Different Concepts) ]       [ Merge & Consolidate Aliases ]│
└─────────────────────────────────────────────────────────────────────────────┘
```

3. **Action: Merge**:
   - `SVD` is recorded as an alias under `Singular Value Decomposition`.
   - All incident edges originally linked to `SVD` are repointed to `Singular Value Decomposition`.
   - Both evidence references are merged without losing citations.
   - Modal advances to match 2 of 3.
4. **Action: Keep Separate**:
   - `SVD` is saved as an independent entity node with its own isolated subgraph.

---

### Flow C — Graph Citations in Chat (Phase 1 + Phase 2 Synergy)
1. In standard **Chat Mode**, when answering a query like *"How does PCA work and what does it depend on?"*, the assistant answers using both vector passages and graph relations.
2. In addition to chunk citation chips (`[1] math.pdf p.14`), the assistant can render graph relation chips (e.g. `[🔗 PCA → USES → Eigenvalues]`).
3. Clicking a graph chip toggles the preview panel to show the exact sentence proving that relationship.

---

## Visual Design & Token Specifications

| Element | Appearance | Tailwind Token |
|---|---|---|
| Concept Node | Soft Indigo pill with border | `bg-indigo-50 border-indigo-200 text-indigo-900` |
| Method Node | Soft Teal pill | `bg-teal-50 border-teal-200 text-teal-900` |
| Formula / Theorem Node | Soft Amber pill | `bg-amber-50 border-amber-200 text-amber-900` |
| Relation Edge | Slate curved path with label badge | `stroke-slate-400 text-[11px] font-semibold bg-white border border-slate-200` |
| Review Queue Alert Badge | Pulsing Amber pill | `bg-amber-100 text-amber-800 border-amber-300 animate-pulse` |
| Evidence Highlight | Yellow marker glow with quotation borders | `bg-amber-100/80 border-l-4 border-amber-500 pl-3 py-1 font-serif` |
