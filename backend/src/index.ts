import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { uploadRouter } from './routes/upload';
import { documentsRouter } from './routes/documents';
import { searchRouter } from './routes/search';
import { askRouter } from './routes/ask';
import { graphRouter, extractAndStoreGraphForChunks } from './routes/graph';
import { auditRouter } from './routes/audit';
import { curationRouter } from './routes/curation';
import { contradictionsRouter } from './routes/contradictions';
import { claimsRouter } from './routes/claims';
import { settingsRouter } from './routes/settings';
import { metadataStore } from './store/MetadataStore';
import { vectorStore } from './store/VectorStore';
import { keywordIndex } from './store/KeywordIndex';
import { graphStore } from './store/GraphStore';
import { reviewStore } from './store/ReviewStore';
import { auditStore } from './store/AuditStore';
import { contradictionStore } from './store/ContradictionStore';
import { statusEmitter } from './routes/upload';
import { ProcessingStatus } from './types';
import { sweepAllTempFilesSync } from './utils/fileStorage';

export const app = express();

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure upload and data folders exist
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Sweep any orphaned temporary files on server boot
const swept = sweepAllTempFilesSync(dataDir, 0);
if (swept > 0) {
  console.log(`Cleaned up ${swept} stale temporary files in ${dataDir}.`);
}

// Rehydrate keywordIndex from vectorStore on server startup
try {
  const existingRecords = vectorStore.getAll();
  if (existingRecords.length > 0) {
    keywordIndex.addChunks(
      existingRecords.map((r) => ({
        chunkId: r.chunkId,
        text: r.text,
        metadata: r.metadata,
      }))
    );
    console.log(`Rehydrated keyword index with ${existingRecords.length} chunks from storage.`);
  }
} catch (rehydrateErr) {
  console.warn('Could not rehydrate keyword index:', rehydrateErr);
}

// Rehydrate GraphStore, ReviewStore, AuditStore & ContradictionStore on server startup
try {
  graphStore.loadSync();
  reviewStore.loadSync();
  auditStore.loadSync();
  contradictionStore.loadSync();
  const summary = graphStore.getAll();
  console.log(`Loaded knowledge graph: ${summary.nodes.length} nodes, ${summary.edges.length} edges, ${summary.claims.length} claims.`);
} catch (graphLoadErr) {
  console.warn('Could not load graph stores:', graphLoadErr);
}

// Background backfill: silently index documents in metadataStore lacking graph data
if (process.env.NODE_ENV !== 'test') {
  setTimeout(async () => {
    try {
      const allDocs = metadataStore.getAll().filter((d) => d.status?.stage === 'done');
      const allGraph = graphStore.getAll();
      const existingDocIds = new Set<string>();

      for (const node of allGraph.nodes) {
        for (const ev of node.evidence || []) {
          existingDocIds.add(ev.docId);
        }
      }
      for (const edge of allGraph.edges) {
        if (edge.evidence?.docId) {
          existingDocIds.add(edge.evidence.docId);
        }
      }

      for (const doc of allDocs) {
        if (!existingDocIds.has(doc.docId)) {
          const chunks = keywordIndex.getChunksByDocId(doc.docId);
          if (chunks.length > 0) {
            console.log(`Backfilling knowledge graph for document ${doc.filename} (${doc.docId})...`);
            await extractAndStoreGraphForChunks(chunks);
          }
        }
      }
    } catch (backfillErr) {
      console.warn('Background graph backfill error:', backfillErr);
    }
  }, 1000);
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// SSE endpoint direct mount: GET /api/status/:docId
app.get('/api/status/:docId', (req: Request, res: Response): void => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc) {
    res.status(404).json({ error: `Document ${docId} not found` });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

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

  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    statusEmitter.off(`status:${docId}`, listener);
  });
});

// GET /api/file/:docId direct mount
app.get('/api/file/:docId', (req: Request, res: Response) => {
  const { docId } = req.params;
  const doc = metadataStore.get(docId);

  if (!doc || !doc.filePath || !fs.existsSync(doc.filePath)) {
    res.status(404).json({ error: `File for document ${docId} not found` });
    return;
  }

  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  res.sendFile(doc.filePath);
});

// Route Mounts
app.use('/api/upload', uploadRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/search', searchRouter);
app.use('/api/ask', askRouter);
app.use('/api/graph', graphRouter);
app.use('/api/graph', auditRouter);
app.use('/api/graph', curationRouter);
app.use('/api/graph/contradictions', contradictionsRouter);
app.use('/api/graph/claims', claimsRouter);
app.use('/api/settings', settingsRouter);

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled application error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err?.message || 'Internal Server Error',
  });
});

// Bootstrap listener
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Smart Teacher Backend running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}
