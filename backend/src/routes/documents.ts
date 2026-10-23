import { Router, Request, Response } from 'express';
import fs from 'fs';
import { metadataStore } from '../store/MetadataStore';
import { vectorStore } from '../store/VectorStore';
import { keywordIndex } from '../store/KeywordIndex';
import { graphStore } from '../store/GraphStore';
import { reviewStore } from '../store/ReviewStore';
import { extractionService } from '../services/ExtractionService';
import { chunkingService } from '../services/ChunkingService';
import { embeddingService } from '../services/EmbeddingService';
import { VectorRecord } from '../types';

export const documentsRouter = Router();

// GET /api/documents
documentsRouter.get('/', (_req: Request, res: Response) => {
  const docs = metadataStore.getAll();
  res.json(docs);
});

// DELETE /api/documents/:docId
documentsRouter.delete('/:docId', async (req: Request, res: Response) => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc) {
    res.status(404).json({ error: `Document ${docId} not found` });
    return;
  }

  // Delete raw file from disk
  if (doc.filePath && fs.existsSync(doc.filePath)) {
    try {
      await fs.promises.unlink(doc.filePath);
    } catch (err) {
      console.warn(`Could not delete file ${doc.filePath}:`, err);
    }
  }

  // Clean indices
  await vectorStore.deleteByDocId(docId);
  keywordIndex.deleteByDocId(docId);
  graphStore.deleteByDocId(docId);
  await graphStore.save();
  reviewStore.deleteByDocId(docId);
  await reviewStore.save();
  await metadataStore.delete(docId);

  res.json({ ok: true, docId });
});

// Helper file handler
const sendDocumentFile = (docId: string, res: Response) => {
  const doc = metadataStore.get(docId);

  if (!doc || !doc.filePath || !fs.existsSync(doc.filePath)) {
    res.status(404).json({ error: `File for document ${docId} not found` });
    return;
  }

  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  res.sendFile(doc.filePath);
};

// GET /api/documents/:docId/file
documentsRouter.get('/:docId/file', (req: Request, res: Response) => {
  sendDocumentFile(req.params.docId, res);
});

// Legacy / alias: GET /api/documents/file/:docId
documentsRouter.get('/file/:docId', (req: Request, res: Response) => {
  sendDocumentFile(req.params.docId, res);
});

// GET /api/documents/:docId/content - Returns extracted text for preview
documentsRouter.get('/:docId/content', async (req: Request, res: Response) => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc) {
    res.status(404).json({ error: `Document ${docId} not found` });
    return;
  }

  // First check chunks from keywordIndex
  const chunks = keywordIndex.getChunksByDocId(docId);
  if (chunks.length > 0) {
    const text = chunks.map((c) => c.text).join('\n\n');
    res.json({ docId, filename: doc.filename, text });
    return;
  }

  // Fallback: If raw file exists and is text-like, read directly
  if (doc.filePath && fs.existsSync(doc.filePath)) {
    try {
      const ext = doc.filename.split('.').pop()?.toLowerCase();
      if (['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'xml'].includes(ext || '')) {
        const text = await fs.promises.readFile(doc.filePath, 'utf-8');
        res.json({ docId, filename: doc.filename, text });
        return;
      }
    } catch {
      // ignore
    }
  }

  res.json({ docId, filename: doc.filename, text: '' });
});

// POST /api/documents/:docId/reindex - Re-extract and re-embed document
documentsRouter.post('/:docId/reindex', async (req: Request, res: Response) => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc || !doc.filePath || !fs.existsSync(doc.filePath)) {
    res.status(404).json({ error: `Document ${docId} not found` });
    return;
  }

  try {
    metadataStore.updateStatus(docId, { stage: 'extracting', progress: 20 });
    const pages = await extractionService.extract(doc.filePath, doc.mimeType, doc.filename);
    const hasOCR = pages.some((p) => p.isOCR === true);

    metadataStore.updateStatus(docId, { stage: 'chunking', progress: 50 });
    const chunks = chunkingService.chunk(pages, docId, doc.filename, doc.mimeType);

    metadataStore.updateStatus(docId, { stage: 'embedding', progress: 75 });
    const embedded = await embeddingService.embedChunks(chunks);

    await vectorStore.deleteByDocId(docId);
    keywordIndex.deleteByDocId(docId);

    const vectorRecords: VectorRecord[] = chunks.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      vector: embedded[index]?.vector || [],
      text: chunk.text,
      metadata: chunk.metadata,
    }));

    await vectorStore.upsertBatch(vectorRecords);
    keywordIndex.addChunks(chunks);

    metadataStore.updateStatus(docId, { stage: 'done', progress: 100 });
    metadataStore.update(docId, { isOCR: hasOCR });

    res.json({ ok: true, docId, chunksCount: chunks.length });
  } catch (err: any) {
    console.error(`Re-index failed for ${docId}:`, err);
    metadataStore.updateStatus(docId, { stage: 'error', progress: 0, error: err?.message || 'Re-index failed' });
    res.status(500).json({ error: err?.message || 'Re-indexing failed' });
  }
});
