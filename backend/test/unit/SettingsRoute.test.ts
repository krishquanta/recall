import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { keyManager, maskApiKey } from '../../src/services/KeyManager';
import { cacheService } from '../../src/services/CacheService';

describe('Settings Route Unit Tests (/api/settings)', () => {
  beforeEach(() => {
    keyManager.reset(['AIzaSyBaseKey1111111111111111111111111', 'AIzaSyBaseKey2222222222222222222222222']);
    cacheService.clear();
  });

  describe('GET /api/settings/keys', () => {
    it('returns status 200 with key statuses, cache stats, and counts', async () => {
      const res = await request(app).get('/api/settings/keys');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys.length).toBe(2);

      expect(res.body.cacheStats).toBeDefined();
      expect(typeof res.body.cacheStats.embeddingHits).toBe('number');
      expect(typeof res.body.cacheStats.embeddingMisses).toBe('number');
      expect(typeof res.body.cacheStats.qaHits).toBe('number');
      expect(typeof res.body.cacheStats.qaMisses).toBe('number');
      expect(typeof res.body.cacheStats.totalRequestsSaved).toBe('number');

      expect(res.body.activeKeyCount).toBe(2);
      expect(res.body.totalKeyCount).toBe(2);

      const firstKey = res.body.keys[0];
      expect(firstKey.keyId).toBeDefined();
      expect(firstKey.maskedKey).toContain('...');
      expect(firstKey.status).toBe('ACTIVE');
      expect(firstKey.cooldownRemainingMs).toBe(0);
      expect(typeof firstKey.totalRequests).toBe('number');
      expect(typeof firstKey.failedRequests).toBe('number');
    });

    it('accurately reflects COOLDOWN keys in status and activeKeyCount', async () => {
      keyManager.recordCooldown('AIzaSyBaseKey1111111111111111111111111', 45000);

      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);
      expect(res.body.activeKeyCount).toBe(1);
      expect(res.body.totalKeyCount).toBe(2);

      const cooledKey = res.body.keys.find((k: any) => k.status === 'COOLDOWN');
      expect(cooledKey).toBeDefined();
      expect(cooledKey.cooldownRemainingMs).toBeGreaterThan(0);
    });

    it('accurately reflects cache hits and savings', async () => {
      await cacheService.setEmbedding('hello world', [0.1, 0.2]);
      cacheService.getEmbedding('hello world'); // hit
      cacheService.getEmbedding('missing text'); // miss

      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);
      expect(res.body.cacheStats.embeddingHits).toBe(1);
      expect(res.body.cacheStats.embeddingMisses).toBe(1);
      expect(res.body.cacheStats.totalRequestsSaved).toBe(1);
    });
  });

  describe('POST /api/settings/keys', () => {
    it('successfully registers a new valid key and returns 200 with keyStatus', async () => {
      const newKey = 'AIzaSyNewDynamicKey9999999999999999999';
      const res = await request(app)
        .post('/api/settings/keys')
        .send({ key: newKey });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyStatus).toBeDefined();
      expect(res.body.keyStatus.status).toBe('ACTIVE');
      expect(res.body.keyStatus.maskedKey).toBe(maskApiKey(newKey));

      // Subsequent GET should show 3 keys
      const getRes = await request(app).get('/api/settings/keys');
      expect(getRes.status).toBe(200);
      expect(getRes.body.totalKeyCount).toBe(3);
      expect(getRes.body.activeKeyCount).toBe(3);
      expect(getRes.body.keys.some((k: any) => k.maskedKey === maskApiKey(newKey))).toBe(true);
    });

    it('also accepts apiKey property for compatibility', async () => {
      const apiKey = 'AIzaSyCompatKey888888888888888888888';
      const res = await request(app)
        .post('/api/settings/keys')
        .send({ apiKey });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyStatus.maskedKey).toBe(maskApiKey(apiKey));
    });

    it('rejects empty or whitespace-only key with 400 Bad Request', async () => {
      const resEmpty = await request(app).post('/api/settings/keys').send({ key: '' });
      expect(resEmpty.status).toBe(400);
      expect(resEmpty.body.error).toBe('Field "key" is required');

      const resWhitespace = await request(app).post('/api/settings/keys').send({ key: '    ' });
      expect(resWhitespace.status).toBe(400);
      expect(resWhitespace.body.error).toBe('Field "key" is required');
    });

    it('rejects missing key field with 400 Bad Request', async () => {
      const res = await request(app).post('/api/settings/keys').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Field "key" is required');
    });

    it('rejects duplicate key with 400 Bad Request', async () => {
      const existingKey = 'AIzaSyBaseKey1111111111111111111111111';
      const res = await request(app)
        .post('/api/settings/keys')
        .send({ key: existingKey });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already exists/i);
    });
  });
});
