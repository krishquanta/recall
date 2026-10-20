# SDD — Software Design Document
> **How the software will be structured and implemented**

---

## Repository Layout

```
ai-study-bank/
├── plan/                           ← this folder
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── upload.ts           ← POST /api/upload + SSE
│   │   │   ├── documents.ts        ← GET/DELETE /api/documents
│   │   │   ├── search.ts           ← POST /api/search
│   │   │   └── ask.ts              ← POST /api/ask
│   │   ├── services/
│   │   │   ├── ExtractionService.ts  ← per-mime parsers + OCR fallback
│   │   │   ├── ChunkingService.ts    ← sliding window chunker
│   │   │   ├── EmbeddingService.ts   ← Gemini text-embedding-004
│   │   │   ├── SearchService.ts      ← hybrid BM25 + cosine fusion
│   │   │   └── LLMService.ts         ← gemini-2.0-flash + citation prompt
│   │   ├── store/
│   │   │   ├── VectorStore.ts        ← Vectra wrapper (upsert / query)
│   │   │   ├── KeywordIndex.ts       ← MiniSearch wrapper (add / search)
│   │   │   └── MetadataStore.ts      ← JSON file registry (CRUD)
│   │   ├── types/
│   │   │   └── index.ts              ← shared interfaces (see below)
│   │   └── index.ts                  ← Express app bootstrap
│   ├── uploads/                      ← gitignored: raw uploaded files
│   ├── data/                         ← gitignored: vectra + minisearch indices
│   ├── test/
│   │   ├── fixtures/                 ← sample PDF, XLSX, MD, handwritten JPG
│   │   ├── unit/                     ← ExtractionService, ChunkingService tests
│   │   └── e2e/                      ← upload → ask smoke test
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Sidebar/
    │   │   │   ├── UploadDropzone.tsx
    │   │   │   ├── DocumentList.tsx
    │   │   │   └── DocumentCard.tsx
    │   │   ├── Chat/
    │   │   │   ├── ChatPanel.tsx
    │   │   │   ├── MessageList.tsx
    │   │   │   ├── AssistantBubble.tsx
    │   │   │   ├── CitationChip.tsx
    │   │   │   └── InputBar.tsx
    │   │   └── Preview/
    │   │       ├── PreviewPanel.tsx
    │   │       ├── PDFViewer.tsx
    │   │       ├── ImageViewer.tsx
    │   │       └── SourceMetaBadge.tsx
    │   ├── hooks/
    │   │   ├── useUpload.ts          ← multipart POST + SSE consumption
    │   │   ├── useDocuments.ts       ← fetch + delete documents
    │   │   ├── useChat.ts            ← POST /api/ask, manage messages
    │   │   └── useSSE.ts             ← generic SSE hook
    │   ├── api/
    │   │   └── client.ts             ← typed fetch wrappers for all endpoints
    │   ├── store/
    │   │   └── appStore.ts           ← Zustand global state
    │   ├── types/
    │   │   └── index.ts              ← Document, Message, Citation, Chunk types
    │   └── App.tsx
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── package.json
```

---

## Key Module Designs

### ExtractionService

```typescript
// Public API
async function extract(filePath: string, mimeType: string): Promise<Page[]>

// Internal parsers
async function extractPDF(path: string): Promise<Page[]>
  // Step 1: pdf-parse → get text per page
  // Step 2: if total chars < 50 → scanned PDF
  //         → pdf2pic (page → PNG buffer) → extractImage() per page

async function extractXLSX(path: string): Promise<Page[]>      // SheetJS XLSX
async function extractMarkdown(path: string): Promise<Page[]>   // remark + strip-markdown
async function extractText(path: string): Promise<Page[]>       // readline line-by-line

async function extractImage(
  pathOrBuffer: string | Buffer,
  pageNumber?: number
): Promise<Page[]>
  // Sends to Gemini Vision (gemini-2.0-flash multimodal):
  // Prompt: "Transcribe ALL text visible in this image, including any
  //          handwritten content, printed text, and diagram labels.
  //          Preserve paragraph breaks. Output plain text only."

// Output shape
interface Page {
  text:       string;
  page?:      number;    // PDF page or image number (1-indexed)
  sheet?:     string;    // Excel sheet name
  rowStart?:  number;    // Excel / CSV starting row
  lineStart?: number;    // Markdown / TXT starting line
  isOCR?:     boolean;   // true = came from Gemini Vision
}
```

### ChunkingService (sliding window)

```typescript
// windowTokens = 512, overlapTokens = 64 (approx word count, not subword tokens)
function chunk(pages: Page[], docId: string, filename: string): Chunk[]

interface Chunk {
  chunkId:  string;          // `${docId}-${chunkIndex}`
  text:     string;
  metadata: ChunkMetadata;
}

interface ChunkMetadata {
  docId:      string;
  filename:   string;
  mimeType:   string;
  chunkIndex: number;
  isOCR?:     boolean;
  page?:      number;
  sheet?:     string;
  rowStart?:  number;
  lineStart?: number;
  charStart:  number;
  charEnd:    number;
}
```

### EmbeddingService

```typescript
// Batches chunks (max 100 per API call) and calls text-embedding-004
async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]>

interface EmbeddedChunk {
  chunkId: string;
  vector:  number[];   // 768-dimensional float array
}
```

### SearchService (hybrid BM25 + vector)

```typescript
async function hybridSearch(
  query:  string,
  docIds: string[],    // empty = search all documents
  topK  = 8,
  alpha = 0.6          // 0.0 = pure BM25, 1.0 = pure semantic
): Promise<RankedChunk[]>

// Fusion formula:
// score = alpha * cosine_similarity + (1 - alpha) * bm25_normalised

interface RankedChunk extends Chunk {
  score: number;
}
```

### LLMService — Citation Prompt Template

```
SYSTEM:
You are a helpful tutor. Answer ONLY using the provided context chunks.
For every factual claim, append a citation tag [N] where N is the chunk number.
If the answer is not in the context, say "I don't have information about that."
Never invent or guess information not present in the context.

CONTEXT:
[1] (doc: stats101.pdf, page 14, OCR: false)
"The central limit theorem states that the distribution of sample means
approaches a normal distribution as sample size increases..."

[2] (doc: stats101.pdf, page 15, OCR: false)
"A sample size of n ≥ 30 is generally considered sufficient..."

USER: What is the central limit theorem?

ASSISTANT:
The central limit theorem states that as sample size grows, the distribution
of sample means approaches normality [1]. A common rule of thumb is n ≥ 30 [2].
```

---

## State Management (Zustand)

```typescript
interface AppStore {
  // Data
  documents:    Document[];
  messages:     Message[];
  activeDocIds: string[];        // scope filter (empty = all)
  previewChunk: Chunk | null;    // set on citation chip click

  // Actions
  addDocument:  (d: Document) => void;
  updateStatus: (docId: string, patch: Partial<ProcessingStatus>) => void;
  removeDocument:(docId: string) => void;
  addMessage:   (m: Message) => void;
  setPreview:   (chunk: Chunk | null) => void;
  toggleDocScope:(docId: string) => void;
}

// Supporting types
type ProcessingStage = 'pending' | 'saving' | 'extracting' | 'ocr' | 'chunking' | 'embedding' | 'done' | 'error';

interface ProcessingStatus {
  stage:    ProcessingStage;
  progress: number;    // 0–100
  error?:   string;
}

interface Document {
  docId:    string;
  filename: string;
  mimeType: string;
  isOCR:    boolean;
  size:     number;
  uploadedAt: string;
  status:   ProcessingStatus;
}

interface Message {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  citations?: Citation[];
  createdAt:  string;
}

interface Citation {
  index:   number;       // [1], [2] ...
  chunkId: string;
  quote:   string;
  metadata: ChunkMetadata;
}
```
