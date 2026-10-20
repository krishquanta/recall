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
});
