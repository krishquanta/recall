# UI/UX Design — User Interface / User Experience Design
> **How the product looks and how users interact with it**

---

## Layout — Three-Panel Shell

```
┌──────────────────────────────────────────────────────────────────┐
│  📚 Smart Teacher                                [Settings ⚙]    │
├──────────┬───────────────────────────┬───────────────────────────┤
│          │                           │                           │
│ LIBRARY  │      CHAT                 │    SOURCE PREVIEW         │
│ (sidebar)│      (center)             │    (right panel)          │
│          │                           │                           │
│ [+ Add]  │  ┌─────────────────────┐  │  ┌─────────────────────┐  │
│          │  │ You: What is the    │  │  │ [PDF page / MD text │  │
│ 📄 doc1  │  │ central limit ...   │  │  │  highlighted quote] │  │
│ ✅ ready │  └─────────────────────┘  │  │                     │  │
│          │  ┌─────────────────────┐  │  │ Page 14 · chunk 3   │  │
│ 🖼 img1  │  │ AI: The central     │  │  └─────────────────────┘  │
│ ⏳ 47%   │  │ limit theorem ...   │  │                           │
│ (OCR)    │  │ [¹] [²]             │  │                           │
│ 📄 doc2  │  └─────────────────────┘  │                           │
│ ❌ error │  [Ask anything...]  [➤]   │                           │
└──────────┴───────────────────────────┴───────────────────────────┘
```

**Panel responsibilities:**
| Panel | Width | Purpose |
|-------|-------|---------|
| Library sidebar | 240 px | File list, upload trigger, processing status |
| Chat (center) | flex-1 | Conversation, citation chips, scope filter |
| Source preview | 380 px | PDF viewer, image viewer, highlighted quote, source metadata |

---

## Key Interaction Flows

### Flow A — Upload Document
1. Click **+ Add** → full-panel drag-and-drop zone appears (accepts PDF, MD, XLSX, TXT, PNG, JPG, WEBP, HEIC).
2. Drop or select file → upload begins immediately.
3. Progress bar appears in library card with stage label: **Saving → Extracting → OCR (if image) → Chunking → Embedding → Done**.
4. On completion → status chip turns ✅ green.
5. On error → ❌ red chip; hover/tap to see error message tooltip.

### Flow B — Ask a Question
1. Type question in input bar at bottom of Chat panel.
2. Optionally scope to specific documents using the pill filter above the input.
3. Hit **Enter** or click ➤ → loading dots appear in chat.
4. Answer streams in with superscript citation chips `[1]`, `[2]` inline.
5. Click a chip → Source Preview panel slides open with:
   - Highlighted quote from the source
   - Document name + page / row / line number
   - "Open full page" button → scrolls PDF viewer / shows full image
6. Chips from OCR'd images show a 🖼 icon badge to indicate the source was a photo/scan.

### Flow C — Manage Documents
1. Hover a document card → context menu icon (⋯) appears.
2. Options: **Re-index**, **Download**, **Delete**.
3. Delete → confirmation dialog → removes file from disk + purges from vector + keyword index.

---

## Component Tree

```
App
├── Shell (layout, theme provider)
│   ├── Sidebar
│   │   ├── UploadDropzone        ← drag-and-drop overlay
│   │   ├── DocumentList
│   │   │   └── DocumentCard      ← status chip, OCR badge, progress bar
│   │   └── DocumentContextMenu   ← Re-index / Download / Delete
│   ├── ChatPanel
│   │   ├── DocScopeFilter        ← pill selector (all docs / specific)
│   │   ├── MessageList
│   │   │   ├── UserBubble
│   │   │   └── AssistantBubble
│   │   │       └── CitationChip  ← clickable, triggers PreviewPanel
│   │   └── InputBar
│   └── PreviewPanel
│       ├── PDFViewer             ← react-pdf, lazy page rendering
│       ├── ImageViewer           ← for PNG/JPG/WEBP source files
│       ├── TextHighlighter       ← highlights the cited quote
│       └── SourceMetaBadge       ← "stats101.pdf · Page 14 · OCR 🖼"
└── StatusToast                   ← SSE-driven, top-right corner
```

---

## Design Tokens (Tailwind CSS)

| Token | Hex | Tailwind class | Usage |
|-------|-----|----------------|-------|
| `primary` | `#4F46E5` | `indigo-600` | CTAs, active states, citation chips |
| `success` | `#16A34A` | `green-600` | ✅ indexed status |
| `warning` | `#D97706` | `amber-600` | ⏳ processing / OCR in progress |
| `error` | `#DC2626` | `red-600` | ❌ error status |
| `surface` | `#F9FAFB` | `gray-50` | Panel backgrounds |
| `border` | `#E5E7EB` | `gray-200` | Dividers between panels |
| `ocr-badge` | `#7C3AED` | `violet-700` | 🖼 OCR source badge on citation chips |

---

## Responsive Behaviour

| Breakpoint | Layout |
|------------|--------|
| ≥ 1280 px (xl) | All 3 panels visible simultaneously |
| 768–1279 px (md) | Sidebar collapses to icon rail; Preview as slide-over sheet |
| < 768 px (sm) | Sidebar as bottom sheet; Preview as full-screen modal |
