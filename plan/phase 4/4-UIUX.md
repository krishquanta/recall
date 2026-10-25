# UI/UX Design Specification (Phase 4)
> **Autonomous Research Agent, Gap Investigation & Bounded Web Discovery**

---

## 1. Workspace Layout & Shell Integration

The Recall UI incorporates Phase 4 research capabilities seamlessly across the existing three-panel workspace and Graph canvas:

1. **Header Bar Trigger**:
   - Next to the `[ ⚠️ Contradictions (N) ]` badge and `[ 📜 History ]` button, a new interactive badge `[ 🔍 Gaps (N) ]` appears.
   - Clicking opens the **Investigation Queue & Gap Ideas Modal**.
2. **Graph Canvas & Context Actions**:
   - Right-clicking or hovering on any Entity node displays a `[ 🔍 Investigate Gaps ]` quick action.
   - Contradiction Drawer cards include an `[ 🔍 Research Consensus ]` button to trigger an online research task directly targeting the conflicting claims.
3. **Research Review Drawer**:
   - A right-hand slide-over drawer (640px wide) containing the **Two-Tab Review Workspace**:
     - **Tab 1: Sourced Report & "What Changed"**: Executive summary, detailed findings, external citations, and delta explanation.
     - **Tab 2: Proposed Graph Updates**: Interactive diff table with checkboxes, relation type editors, and one-click import/reject actions.
4. **Document Library (Sidebar)**:
   - Imported research documents appear in the sidebar list with a distinct blue globe icon `[ 🌐 Web: <Topic> ]` and can be scoped into RAG chat just like uploaded files.
   - Visually distinguished from user-uploaded docs via `sourceType: 'web'`.
5. **Settings Panel**:
   - A new "Research & Sources" tab in the Settings Modal to view and customize the domain allowlist and task budgets.

---

## 2. ASCII Wireframes

### A. Header Bar with Research & Gaps Trigger

```
+---------------------------------------------------------------------------------------------------------------------------------+
| [=] RECALL | Mode: [ Chat | Graph ] | Active Scope: All Docs (3) | [ 🔍 Gaps (4) ] [ ⚠️ Conflicts (2) ] [ 📜 History ] [ ⚙️ ]  |
+---------------------------------------------------------------------------------------------------------------------------------+
```

### B. Investigation Queue & Gap Suggestions Modal

```
+---------------------------------------------------------------------------------------------------+
|  🔍 Knowledge Gaps & Investigation Ideas                                                    [ X ] |
+---------------------------------------------------------------------------------------------------+
|  Recall analyzed your knowledge graph and identified 4 areas worth investigating:                  |
|                                                                                                   |
|  [ All Gaps (4) ]   [ ⚠️ Contradictions (2) ]   [ ⏱️ Stale (1) ]   [ 🧩 Missing Evidence (1) ]    |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | ⚠️ HIGH (0.95): Algorithm Time Complexity Conflict                                          |  |
|  | Entities: [Dijkstra's Algorithm] <-> [Fibonacci Heap]                                       |  |
|  | Problem: Slides state O(V log V) while Textbook B proves O(E + V log V).                    |  |
|  | Suggested: "What is the exact time complexity of Dijkstra with Fibonacci heaps?"             |  |
|  |                                                         [ 🔍 Investigate Online (arXiv/Wiki) ] |  |
|  +---------------------------------------------------------------------------------------------+  |
|  | ⏱️ MEDIUM (0.70): Stale Clinical Guideline                                                   |  |
|  | Entity: [Pediatric Sepsis Protocol]                                                          |  |
|  | Problem: Sepsis definition references 2016 consensus; newer 2026 advisories may exist.       |  |
|  | Suggested: "What are the updated international consensus definitions for sepsis?"             |  |
|  |                                                                        [ 🔍 Investigate ]    |  |
|  +---------------------------------------------------------------------------------------------+  |
|  | 🧩 LOW (0.40): Weakly Grounded Concept                                                       |  |
|  | Entity: [Cas12a Nuclease] — only 1 relationship edge                                         |  |
|  | Problem: Missing mechanistic details on cleavage kinetics.                                   |  |
|  | Suggested: "What is the molecular mechanism and cleavage kinetics of Cas12a?"                 |  |
|  |                                                                        [ 🔍 Investigate ]    |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  --- Or enter a custom topic to investigate ---                                                   |
|  [ Enter any topic, entity, or question to research...                       ] [ 🔍 Start Task ]  |
+---------------------------------------------------------------------------------------------------+
```

### C. Active Bounded Research Task (In-Progress State)

```
+---------------------------------------------------------------------------------------------------+
|  🔍 Researching: "What is the exact time complexity of Dijkstra with Fibonacci heaps?"      [ X ] |
+---------------------------------------------------------------------------------------------------+
|  Status: Searching approved sources...                                                            |
|  Budget Remaining: Queries: 2/3 | Sources: 3/5 | Time: 88s remaining                              |
|                                                                                                   |
|  [✓] Formulated query: "Dijkstra algorithm Fibonacci heap time complexity proof"                  |
|  [✓] Discovered Wikipedia: "Dijkstra's algorithm" (en.wikipedia.org ✓)                            |
|  [✓] Discovered arXiv:2104.xxxxx "Optimal Graph Traversal Bounds" (arxiv.org ✓)                  |
|  [⟳] Fetching and parsing candidate evidence...                                                  |
|                                                                                                   |
|  [========================================                      ] 65%                             |
|                                                                                 [ Cancel Task ]   |
+---------------------------------------------------------------------------------------------------+
```

### D. Two-Tab Research Review Drawer (Slide-Over, 640px)

#### Tab 1: Sourced Report & "What Changed and Why"

```
+---------------------------------------------------------------------------------------------------+
|  🔍 Research Findings: Dijkstra's Algorithm Complexity                                     [ X ]  |
+---------------------------------------------------------------------------------------------------+
|  [ 📄 Sourced Report & Summary ]  |  [ 🔀 Proposed Graph Updates (3) ]                            |
+---------------------------------------------------------------------------------------------------+
|  Executive Summary                                                                                |
|  Dijkstra's algorithm using a standard binary heap runs in O((E + V) log V). When implemented     |
|  with a Fibonacci heap, the decrease-key operation takes amortized O(1) time, bringing total      |
|  runtime to O(E + V log V).                                                                       |
|                                                                                                   |
|  What Changed & Why                                                                               |
|  • Local Gap: Lecture slides omitted the amortized O(1) cost of decrease-key.                     |
|  • Resolution: Clarifies that O(V log V) is only valid when E = O(V).                              |
|  • Contradiction Resolved: Bridges Conflict #C-12 between Slides and Textbook.                   |
|                                                                                                   |
|  Authoritative Sources                                                                            |
|  ┌────────────────────────────────────────────────────────────────────────┐                        |
|  │ 1. Wikipedia: "Dijkstra's algorithm"                                  │                        |
|  │    🌐 en.wikipedia.org • Retrieved 2026-10-25T10:01:22Z                │                        |
|  │    ┊ "With a Fibonacci heap, the running time is O(E + V log V)."      │                        |
|  └────────────────────────────────────────────────────────────────────────┘                        |
|  ┌────────────────────────────────────────────────────────────────────────┐                        |
|  │ 2. arXiv: "Priority Queues in Shortest Path Algorithms"               │                        |
|  │    🌐 arxiv.org • Retrieved 2026-10-25T10:01:30Z                       │                        |
|  │    ┊ "Amortized O(1) decrease-key yields optimal E + V log V."         │                        |
|  └────────────────────────────────────────────────────────────────────────┘                        |
|                                                                                                   |
|  [ Switch to Proposed Updates -> ]                                                                |
+---------------------------------------------------------------------------------------------------+
```

#### Tab 2: Proposed Graph Updates (Interactive Staging Diff)

```
+---------------------------------------------------------------------------------------------------+
|  🔍 Research Findings: Dijkstra's Algorithm Complexity                                     [ X ]  |
+---------------------------------------------------------------------------------------------------+
|  [ 📄 Sourced Report & Summary ]  |  [ 🔀 Proposed Graph Updates (3) ]                            |
+---------------------------------------------------------------------------------------------------+
|  Review proposed additions before importing into your knowledge bank:                             |
|                                                                                                   |
|  [x] Select All (3 items)                                                                         |
|                                                                                                   |
|  [x] ● NEW ENTITY: [Fibonacci Heap] (Data Structure)                                              |
|      Description: Priority queue data structure supporting amortized O(1) decrease-key operations.|
|      Evidence: "A Fibonacci heap is a data structure for priority queue operations..." (Wikipedia)|
|      [ Edit ]                                                                                     |
|                                                                                                   |
|  [x] → NEW RELATION: [Dijkstra's Algorithm] --OPTIMIZED_BY--> [Fibonacci Heap]                    |
|      Evidence: "running time becomes O(E + V log V) when using a Fibonacci heap" (Wikipedia)      |
|      [ Edit Type ▾ ]                                                                              |
|                                                                                                   |
|  [x] ⚠ RESOLVE CONTRADICTION: Conflict #C-12 (Time Complexity Divergence)                        |
|      Resolution: Context clarification — O(E + V log V) is general; O(V log V) when E = O(V).     |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | [ Import Accepted Updates (3) ]                                            [ Discard All ]  |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

### E. Error & Edge-Case States

```
+---------------------------------------------------------------------------------------------------+
|  Research Task Failed                                                                      [ X ]  |
+---------------------------------------------------------------------------------------------------+
|  ⚠ Could not complete research for "Cas12a cleavage kinetics"                                     |
|                                                                                                   |
|  Reason: All 3 search queries returned results outside the approved domain allowlist.             |
|                                                                                                   |
|  What you can do:                                                                                 |
|  • Add additional approved domains in Settings > Research & Sources                               |
|  • Try rephrasing the question with different terminology                                         |
|  • Check your internet connection                                                                 |
|                                                                                                   |
|  Budget Used: Queries: 3/3 | Sources: 0/5 | Time: 12s                                             |
|                                                                                   [ Try Again ]   |
+---------------------------------------------------------------------------------------------------+
```

```
+---------------------------------------------------------------------------------------------------+
|  🔍 Knowledge Gaps & Investigation Ideas                                                    [ X ] |
+---------------------------------------------------------------------------------------------------+
|  ✅ No knowledge gaps detected!                                                                    |
|                                                                                                   |
|  Your knowledge graph looks well-connected. All contradictions are resolved, no stale claims      |
|  detected, and all entities have sufficient evidence grounding.                                   |
|                                                                                                   |
|  You can still investigate any topic manually:                                                    |
|  [ Enter any topic, entity, or question to research...                       ] [ 🔍 Start Task ]  |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Visual Design System & Styling Tokens

| UI Element | Tailwind Class Tokens | Description |
|------------|-----------------------|-------------|
| **Research Badge** | `bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100` | Header notification chip |
| **Drawer Shell** | `w-full max-w-2xl bg-white border-l border-slate-200 shadow-2xl` | 640px slide-over drawer |
| **Tab Active** | `border-b-2 border-indigo-600 text-indigo-600 font-semibold` | Active tab indicator |
| **Tab Inactive** | `text-slate-500 hover:text-slate-700 border-b-2 border-transparent` | Inactive tab |
| **New Entity Chip** | `bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold` | Newly proposed entity badge |
| **New Relation Chip** | `bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold` | Newly proposed edge badge |
| **Resolve Chip** | `bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold` | Contradiction resolution badge |
| **Source Pill** | `bg-slate-100 text-slate-600 text-xs rounded-full px-2 py-0.5 border` | Domain indicator |
| **Verbatim Quote Callout** | `border-l-2 border-indigo-400 bg-slate-50 italic text-slate-600 text-xs p-2` | Grounded evidence quote |
| **Web Doc Icon** | `text-blue-500` (Globe icon from Lucide) | Library sidebar indicator for web research docs |
| **Error State** | `bg-red-50 text-red-700 border-red-200 rounded-lg p-4` | Research failure card |
| **Empty State** | `text-slate-400 text-center py-12` | No gaps detected |
| **Progress Bar** | `bg-indigo-600 h-2 rounded-full transition-all` | Research task progress |

---

## 4. Step-by-Step Interaction Flows

### Flow 1: Gap Discovery to Sourced Report
1. User clicks `[ 🔍 Gaps (4) ]` in the top header.
2. The Investigation Queue modal opens, showing ranked suggestions grouped by type (Contradictions, Stale, Missing Evidence).
3. User reviews the top card: *"Algorithm Time Complexity Conflict"* and clicks `[ 🔍 Investigate Online ]`.
4. The modal transitions to the **In-Progress** state showing budget counters and discovered sources in real-time.
5. Upon completion, the modal closes and the **Two-Tab Research Review Drawer** slides open.

### Flow 2: Review, Selection & Import
1. In Tab 1, the user reads the summary and "What changed and why" section.
2. User switches to Tab 2 (Proposed Graph Updates).
3. User sees 3 proposed items: 1 new entity, 1 new relation, 1 contradiction resolution.
4. User unchecks 1 item if not desired, or leaves all 3 checked. Can click `[Edit Type ▾]` to change a proposed relation type.
5. User clicks `[ Import Accepted Updates ]`.
6. Backend creates a web dossier, indexes it, commits graph changes, and writes an audit event.
7. A toast appears: *"3 updates imported into Knowledge Graph."*
8. Graph canvas re-renders with the newly added nodes highlighted with a temporary pulsing border animation.
9. Library sidebar shows the new web research document with 🌐 icon.

### Flow 3: One-Click Rollback
1. If the user decides the imported research is unwanted, they click `[ 📜 History ]` in the header.
2. The top audit event shows: `research_import: "Dijkstra's Algorithm Complexity" (+1 entity, +1 relation, +1 doc)`.
3. User clicks `[ Rollback ]`.
4. The system atomically removes the entity, edge, research document, and all indexed chunks, reverting graph topology cleanly.

### Flow 4: Research Failure (Error State)
1. User triggers an investigation, but all queries return blocked domains or no useful content.
2. The progress panel transitions to an **Error State** card explaining the failure reason.
3. Suggests actionable next steps: add approved domains in Settings, rephrase the question, or check connectivity.

### Flow 5: Context Menu Research from Graph Canvas
1. User right-clicks an entity node (e.g., "Cas12a Nuclease") in the Graph Canvas.
2. Context menu shows `[ 🔍 Investigate Gaps ]`.
3. Clicking opens the Investigation Queue modal pre-filtered to gaps associated with that entity, or directly starts a research task with a pre-formulated question.
