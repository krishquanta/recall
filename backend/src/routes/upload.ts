import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { metadataStore } from '../store/MetadataStore';
import { vectorStore } from '../store/VectorStore';
import { keywordIndex } from '../store/KeywordIndex';
import { extractionService } from '../services/ExtractionService';
import { chunkingService } from '../services/ChunkingService';
import { embeddingService } from '../services/EmbeddingService';
import { extractAndStoreGraphForChunks } from './graph';
import { Document, ProcessingStatus, VectorRecord } from '../types';

export const uploadRouter = Router();
export const statusEmitter = new EventEmitter();

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}-${sanitizedBase}${ext}`);
  },
});

const ALLOWED_EXTENSIONS = new Set([
  // Documents & Word Processing
  '.pdf',
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
  // Presentations
  '.pptx',
  '.ppt',
  '.odp',
  // Spreadsheets & Tabular
  '.xlsx',
  '.xls',
  '.csv',
  '.tsv',
  '.ods',
  // Text, Markdown, Web & Data
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.html',
  '.htm',
  '.json',
  '.jsonl',
  '.xml',
  // Images & Handwritten notes
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Supported formats: PDF, Word (.docx/.doc), PowerPoint (.pptx/.ppt), Excel/CSV/TSV/ODS, OpenDocument (.odt/.odp), RTF, Markdown, HTML, JSON/XML, and Images (PNG/JPG/WEBP)`));
    }
  },
});

function emitStatusUpdate(docId: string, status: ProcessingStatus): void {
  metadataStore.updateStatus(docId, status);
  statusEmitter.emit(`status:${docId}`, status);
}

async function processDocumentAsync(docId: string, filePath: string, filename: string, mimeType: string): Promise<void> {
  try {
    emitStatusUpdate(docId, { stage: 'saving', progress: 10 });

    // 1. Extraction
    emitStatusUpdate(docId, { stage: 'extracting', progress: 25 });
    const pages = await extractionService.extract(filePath, mimeType, filename);
    const hasOCR = pages.some((p) => p.isOCR === true);

    if (hasOCR) {
      emitStatusUpdate(docId, { stage: 'ocr', progress: 45 });
    }

    // 2. Chunking
    emitStatusUpdate(docId, { stage: 'chunking', progress: 60 });
    const chunks = chunkingService.chunk(pages, docId, filename, mimeType);

    // 3. Embedding
    emitStatusUpdate(docId, { stage: 'embedding', progress: 75 });
    const embedded = await embeddingService.embedChunks(chunks);

    // 4. Indexing (VectorStore + KeywordIndex)
    emitStatusUpdate(docId, { stage: 'saving', progress: 80 });
    const vectorRecords: VectorRecord[] = chunks.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      vector: embedded[index]?.vector || [],
      text: chunk.text,
      metadata: chunk.metadata,
    }));

    await vectorStore.upsertBatch(vectorRecords);
    keywordIndex.addChunks(chunks);

    // 5. Graph Extraction & Provenance Anchoring
    emitStatusUpdate(docId, { stage: 'graph', progress: 85 });
    await extractAndStoreGraphForChunks(chunks);

    // Asynchronously scan for cross-source contradictions
    try {
      const { contradictionDetectionService } = await import('../services/ContradictionDetectionService');
      await contradictionDetectionService.evaluateCrossSourceContradictions(docId);
    } catch (contradictionErr) {
      console.warn('Contradiction evaluation failed:', contradictionErr);
    }

    // Update document with isOCR flag
    const doc = metadataStore.get(docId);
    if (doc) {
      doc.isOCR = hasOCR;
      await metadataStore.set(doc);
    }

    // 6. Done
    emitStatusUpdate(docId, { stage: 'done', progress: 100 });
  } catch (err: any) {
    console.error(`Document processing failed for ${docId}:`, err);
    emitStatusUpdate(docId, {
      stage: 'error',
      progress: 0,
      error: err?.message || 'Processing failed',
    });
  }
}

// POST /api/upload
uploadRouter.post('/', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Key must be "file".' });
    return;
  }

  const docId = uuidv4();
  const initialStatus: ProcessingStatus = { stage: 'pending', progress: 0 };

  const newDoc: Document = {
    docId,
    filename: req.file.originalname,
    mimeType: req.file.mimetype || 'application/octet-stream',
    isOCR: false,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    status: initialStatus,
    filePath: req.file.path,
  };

  await metadataStore.set(newDoc);

  // Trigger ingestion asynchronously in background
  processDocumentAsync(docId, req.file.path, req.file.originalname, req.file.mimetype);

  res.status(202).json({
    docId,
    filename: newDoc.filename,
    status: initialStatus,
  });
});

// SSE endpoint: GET /api/status/:docId
uploadRouter.get('/status/:docId', (req: Request, res: Response): void => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc) {
    res.status(404).json({ error: `Document ${docId} not found` });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send current status immediately
  res.write(`data: ${JSON.stringify(doc.status)}\n\n`);

  if (doc.status.stage === 'done' || doc.status.stage === 'error') {
    res.end();
    return;
  }

  const listener = (status: ProcessingStatus) => {
    res.write(`data: ${JSON.stringify(status)}\n\n`);
    if (status.stage === 'done' || status.stage === 'error') {
      statusEmitter.off(`status:${docId}`, listener);
      res.end();
    }
  };

  statusEmitter.on(`status:${docId}`, listener);

  // Heartbeat ping every 15 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    statusEmitter.off(`status:${docId}`, listener);
  });
});
