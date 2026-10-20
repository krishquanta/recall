import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';

describe('API Routes Integration', () => {
  it('GET /api/health should return ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeDefined();
  });

  it('GET /api/documents should return an array', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/upload should return 400 when no file is attached', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No file uploaded');
  });

  it('POST /api/search should validate missing query', async () => {
    const res = await request(app).post('/api/search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Field "query" is required');
  });

  it('POST /api/ask should validate missing question', async () => {
    const res = await request(app).post('/api/ask').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Field "question" is required');
  });

  it('POST /api/ask should handle query with no matching docs gracefully', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'What is the speed of light?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBeDefined();
    expect(Array.isArray(res.body.citations)).toBe(true);
  });

  it('POST /api/upload should accept and process a .docx document successfully', async () => {
    const path = require('path');
    const docxPath = path.join(__dirname, '../fixtures/sample.docx');
    const res = await request(app)
      .post('/api/upload')
      .attach('file', docxPath);

    expect(res.status).toBe(202);
    expect(res.body.docId).toBeDefined();
    expect(res.body.filename).toBe('sample.docx');
    expect(res.body.status).toBeDefined();
    expect(res.body.status.stage).toBe('pending');
  });

  it('POST /api/upload should accept and process a .pptx presentation successfully', async () => {
    const path = require('path');
    const pptxPath = path.join(__dirname, '../fixtures/sample.pptx');
    const res = await request(app)
      .post('/api/upload')
      .attach('file', pptxPath);

    expect(res.status).toBe(202);
    expect(res.body.docId).toBeDefined();
    expect(res.body.filename).toBe('sample.pptx');
    expect(res.body.status).toBeDefined();
    expect(res.body.status.stage).toBe('pending');
  });

  it('GET /api/graph should return graph nodes, edges and summary', async () => {
    const res = await request(app).get('/api/graph');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.edges)).toBe(true);
    expect(Array.isArray(res.body.claims)).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.totalNodes).toBe('number');
  });

  it('GET /api/graph/review-queue should return review queue items', async () => {
    const res = await request(app).get('/api/graph/review-queue');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });

  it('POST /api/graph/review-queue/:id/resolve should validate resolution action', async () => {
    const res = await request(app)
      .post('/api/graph/review-queue/invalid-id/resolve')
      .send({ action: 'invalid-action' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Field "action" is required');
  });
});
