# Recall 🧠

Recall is a local-first, document-aware AI study companion. Upload your notes, question banks, PDFs, slides, and handwritten pages — then ask anything in plain English and get answers with clickable citations that jump to the exact source passage.

---

## 🌟 Key Features

1. **Comprehensive Multi-Format Ingestion**:
   - 📄 **Word Processing (`.docx`, `.doc`, `.odt`, `.rtf`)**: Full paragraph, heading, and line structure extraction using Mammoth & XML parser.
   - 📽️ **Presentations (`.pptx`, `.ppt`, `.odp`)**: Slide-by-slide extraction preserving exact slide numbers (`Slide 1`, `Slide 2`) for precise clickable citation jumps.
   - 📑 **PDFs (`.pdf`)**: Digital text extraction per page, with automatic fallback to Gemini Vision OCR for scanned/image-only PDFs.
   - 📊 **Spreadsheets (`.xlsx`, `.xls`, `.csv`, `.tsv`, `.ods`)**: Preserves sheet names, headers, and row indices.
   - 📝 **Markdown (`.md`) & Text (`.txt`)**: Preserves heading context and exact line number ranges.
   - 🌐 **Web & Data Formats (`.html`, `.htm`, `.json`, `.jsonl`, `.xml`)**: Clean text and structure parsing with tag stripping.
   - ✍️ **Handwritten Notes & Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.heic`)**: Gemini Vision multimodal OCR extracts cursive and printed handwriting, labeled with an `🖼 OCR` badge.
2. **Hybrid Search Engine**:
   - Vector similarity using Gemini `text-embedding-004` (768-dim) cosine ranking (with local mock fallback).
   - BM25 full-text keyword search using `MiniSearch`.
   - Balanced score fusion with configurable α weighting.
3. **Conversational Q&A with Clickable Citations**:
   - Powered by **`gemini-3.8-flash`** enforcing strict grounding and citation tags (`[1]`, `[2]`).
   - Clicking any citation chip opens the Source Preview panel displaying the document, exact page/slide/row/line, and highlighted quote snippet.
4. **Real-Time Processing Status**:
   - Server-Sent Events (SSE) stream real-time progress (`Saving` → `Extracting` → `Chunking` → `Embedding` → `Done`).
   - Clear visual status chips (✅ ready, ⏳ progress bar, ❌ error with tooltip).
5. **Three-Panel Browser Workspace**:
   - **Left Panel (240px)**: Library sidebar with drag-and-drop upload, document list, and context menu.
   - **Center Panel (Flex)**: Conversational chat interface with document scope filtering.
   - **Right Panel (380px)**: Source Preview panel with PDF viewer, image viewer, and text quote highlighter.
6. **Math & Multilingual Output**:
   - KaTeX renders inline and block LaTeX math, vectors, matrices, and special symbols in responses.
   - Gemini replies in the user's language automatically.

---

## 🏗️ Architecture

```
recall/
├── backend/
│   ├── src/
│   │   ├── routes/          # upload (SSE), documents, search, ask
│   │   ├── services/        # Extraction, Chunking, Embedding, Search, LLM
│   │   ├── store/           # MetadataStore, VectorStore, KeywordIndex
│   │   ├── types/           # Core domain TypeScript interfaces
│   │   └── index.ts         # Express server entry point (port 3001)
│   ├── uploads/             # Raw file storage
│   └── data/                # Vector store & metadata registries
│
├── frontend/
│   ├── src/
│   │   ├── api/             # Typed fetch & SSE client
│   │   ├── components/      # Sidebar, Chat, Preview, StatusToast
│   │   ├── hooks/           # useUpload, useDocuments, useChat, useSSE
│   │   ├── store/           # Zustand global state (appStore)
│   │   └── App.tsx          # Three-panel responsive layout
│   └── vite.config.ts       # Vite proxy to backend API
│
└── plan/                    # Full design documents (PRD, TRD, Architecture, UIUX, SDD, Plan)
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v20+ LTS (tested on Node v24)
- **pnpm**: v9+ (v11 installed)

### 2. Configure Environment Variables
Copy `backend/.env.example` to `backend/.env` and add your Google Gemini API key:

```env
# backend/.env
GEMINI_API_KEY=your_gemini_api_key_here
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.8-flash
EMBEDDING_MODEL=text-embedding-004
PORT=3001
UPLOAD_DIR=./uploads
DATA_DIR=./data
```
*(Get a free API key at [Google AI Studio](https://aistudio.google.com/))*

> **Note**: If `GEMINI_API_KEY` is not provided, the app runs with mock embeddings and safe fallback responses so you can test UI flows immediately.

### 3. Run Both Servers Concurrently
From the project root:

```bash
pnpm dev
```

- **Frontend**: `http://localhost:5180`
- **Backend API**: `http://localhost:3001`

### 4. Build for Production
```bash
pnpm build
```

---

## 🧪 Testing Definition of Done

1. Upload a PDF document → verify status progresses to ✅ Ready.
2. Upload a Markdown notes file or Excel sheet → verify source locations (line/row) are captured.
3. Upload an image of handwritten notes → verify OCR transcription with `🖼 OCR` badge.
4. Ask a question about an imported document → verify answer includes `[1]` citation tags.
5. Click a citation chip → verify the Preview Panel jumps to the exact cited page/line with highlighted quote.
