# Architecture Design — Software / System Architecture
> **How the components fit together, data flows, APIs, and services**

---

## Component Diagram

```mermaid
flowchart TD
    subgraph Browser["Browser (React 19 + TypeScript)"]
        U[Upload Panel]
        L[Document Library]
        C[Chat Interface]
        P[PDF / Source Preview Panel]
        S[Status Toast / Progress Bar]
    end

    subgraph API["Express API Server"]
        direction TB
        R_Upload["/api/upload  (POST)"]
        R_Status["/api/status/:id  (SSE)"]
        R_Documents["/api/documents  (GET/DELETE)"]
        R_Search["/api/search  (POST)"]
        R_Ask["/api/ask  (POST)"]
    end

    subgraph Services["Service Layer"]
        ExtractionSvc["ExtractionService\n(PDF / XLSX / MD / TXT / Image)"]
        ChunkingSvc["ChunkingService\n(sliding window, 512 tokens)"]
        EmbeddingSvc["EmbeddingService\n(Gemini text-embedding-004)"]
        SearchSvc["SearchService\n(BM25 + vector hybrid)"]
        LLMSvc["LLMService\n(gemini-2.0-flash)"]
        VisionSvc["GeminiVision\n(handwriting OCR)"]
    end

    subgraph Storage["Local Storage"]
        FS["File System\n(uploads/)"]
        VDB["Vectra\n(vector index)"]
        MSIdx["MiniSearch Index\n(BM25)"]
        MetaDB["metadata.json\n(doc registry)"]
    end

    U -->|multipart/form-data| R_Upload
    R_Upload --> ExtractionSvc
    ExtractionSvc -->|image / scanned PDF| VisionSvc
    VisionSvc -->|transcribed text| ExtractionSvc
    ExtractionSvc --> ChunkingSvc
    ChunkingSvc --> EmbeddingSvc
    EmbeddingSvc --> VDB
    ChunkingSvc --> MSIdx
    R_Upload --> FS
    R_Upload --> MetaDB
    R_Status -.->|SSE stream| S
    L -->|GET| R_Documents
    R_Documents --> MetaDB
    C -->|POST query| R_Ask
    R_Ask --> SearchSvc
    SearchSvc --> VDB
    SearchSvc --> MSIdx
    R_Ask --> LLMSvc
    LLMSvc -->|answer + citations| C
    C -->|citation click| P
    P --> FS
```

---

## Data Flow — Upload & Indexing

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Express API
    participant Ext as ExtractionService
    participant Vis as GeminiVision (OCR)
    participant Chunk as ChunkingService
    participant Emb as EmbeddingService
    participant FS as File System
    participant VDB as Vectra DB
    participant MS as MiniSearch

    B->>API: POST /api/upload (file)
    API->>FS: Save raw file
    API-->>B: { docId } + SSE channel open
    API->>Ext: extract(filePath, mimeType)
    alt Text-based PDF / MD / XLSX / TXT
        Ext-->>API: [{ text, page, row, lineStart }]
    else Image file or scanned PDF (< 50 chars)
        Ext->>Vis: transcribe(imageBuffer, page?)
        Vis-->>Ext: transcribed plain text
        Ext-->>API: [{ text, page, isOCR: true }]
    end
    API-->>B: SSE: { stage: "extracted", progress: 30 }
    API->>Chunk: chunk(pages, windowSize=512, overlap=64)
    Chunk-->>API: [{ chunkId, text, metadata }]
    API-->>B: SSE: { stage: "chunked", progress: 50 }
    API->>Emb: embed(chunks[])
    Emb-->>API: [{ chunkId, vector }]
    API->>VDB: upsert(chunkId, vector, metadata)
    API->>MS: add(chunkId, text)
    API-->>B: SSE: { stage: "indexed", progress: 100 }
```

---

## Data Flow — Q&A

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Express API
    participant Srch as SearchService
    participant LLM as LLMService

    B->>API: POST /api/ask { question, docIds[] }
    API->>Srch: hybridSearch(question, topK=8)
    Srch-->>API: [{ chunkId, text, score, metadata }]
    API->>LLM: generateAnswer(question, chunks)
    LLM-->>API: { answer, citations[{chunkId, quote}] }
    API-->>B: { answer, citations }
    B->>B: render answer with citation chips [1] [2]
    B->>B: on chip click → open source preview at page N
```

---

## Chunk Metadata Schema

```typescript
interface ChunkMetadata {
  docId:       string;   // UUID
  filename:    string;
  mimeType:    string;
  chunkIndex:  number;
  isOCR?:      boolean;  // true when text came from Gemini Vision
  // Source location (filled per parser)
  page?:       number;   // PDF pages (1-indexed) or image sequence number
  sheet?:      string;   // Excel sheet name
  rowStart?:   number;   // Excel / CSV row
  lineStart?:  number;   // Markdown / TXT line
  charStart:   number;   // absolute char offset in extracted text
  charEnd:     number;
}
```

---

## API Contract

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/upload` | `multipart: file` | `{ docId, filename, status }` |
| `GET` | `/api/status/:docId` | — | SSE stream `{ stage, progress, error? }` |
| `GET` | `/api/documents` | — | `Document[]` |
| `DELETE` | `/api/documents/:docId` | — | `{ ok }` |
| `POST` | `/api/ask` | `{ question, docIds[] }` | `{ answer, citations[] }` |
| `GET` | `/api/file/:docId` | — | raw file (for PDF / image preview) |
