# Workspace Rules: AI Study Bank (Recall)

## Phased Plan Structure Standard

Whenever creating, organizing, or updating project plans or roadmap specifications (e.g., in `plan/phase <N>/`), always structure the plan into the standard **6 specification documents**:

1. **`1-PRD.md` — Product Requirements Document**:
   - Problem statement & cognitive hurdles
   - Target user personas & real-world scenarios
   - Goals & Non-Goals
   - Success metrics & target thresholds
   - Prioritized feature table (P0, P1, P2)

2. **`2-TRD.md` — Technical Requirements Document**:
   - Functional requirements (FRs) with explicit data structures & types
   - Non-functional requirements (performance, latency, durability)
   - Domain schemas & TypeScript interface definitions
   - Verification criteria & constraints

3. **`3-Architecture.md` — System Architecture**:
   - High-level system & component Mermaid diagrams (`flowchart TD / LR`)
   - Interaction & lifecycle sequence diagrams (`sequenceDiagram`)
   - Data flow, pipeline sequence, and persistence models

4. **`4-UIUX.md` — User Interface / User Experience Design**:
   - Workspace layout & shell integration
   - ASCII wireframes for panels, modals, drawers, and canvases
   - Visual design system (status badges, color coding, interactive states)
   - Step-by-step key interaction flows

5. **`5-SDD.md` — Software Design Document**:
   - Directory & file inventory ([NEW], [MODIFY], [DELETE])
   - Detailed service class designs, method signatures, and state machines
   - REST API contracts (routes, HTTP methods, request payloads, response schemas)
   - Storage format details and transaction/concurrency handling

6. **`6-Implementation-Plan.md` — Implementation Plan / Roadmap**:
   - Milestone sequence diagram (`flowchart LR`)
   - Sequenced task checklist with checkboxes (`[ ]`) grouped by milestone
   - Automated testing commands and end-to-end Definition of Done (DoD) verification steps
