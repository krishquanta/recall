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
import { metadataStore } from './store/MetadataStore';
import { vectorStore } from './store/VectorStore';
import { keywordIndex } from './store/KeywordIndex';
import { statusEmitter } from './routes/upload';
import { ProcessingStatus } from './types';

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
