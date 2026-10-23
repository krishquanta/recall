import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { KeyManager } from '../../src/services/KeyManager';
import { cacheService } from '../../src/services/CacheService';
import { Chunk } from '../../src/types';

describe('EmbeddingService Unit & Failover Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    cacheService.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
    cacheService.clear();
  });

  describe('Mock Mode (Zero Keys Configured)', () => {
    it('operates in mock mode and generates deterministic vectors when 0 keys configured', async () => {
      const km = new KeyManager([]);
      const service = new EmbeddingService(km);

      expect(service.isMockMode()).toBe(true);

      const query = 'Quantum entanglement in Bell states';
      const vector = await service.embedQuery(query);

      expect(vector).toBeDefined();
      expect(vector.length).toBe(768);

      // Verify cached
      const cached = cacheService.getEmbedding(query);
      expect(cached).toEqual(vector);
    });

    it('embedChunks generates and caches vectors in mock mode', async () => {
      const km = new KeyManager([]);
      const service = new EmbeddingService(km);

      const chunks: Chunk[] = [
        {
          chunkId: 'chk_1',
          text: 'Chunk text alpha',
          metadata: { docId: 'd1', filename: 'f.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 16 },
        },
        {
          chunkId: 'chk_2',
          text: 'Chunk text beta',
          metadata: { docId: 'd1', filename: 'f.txt', mimeType: 'text/plain', chunkIndex: 1, charStart: 17, charEnd: 32 },
        },
      ];

      const res = await service.embedChunks(chunks);
      expect(res).toHaveLength(2);
      expect(res[0].chunkId).toBe('chk_1');
      expect(res[0].vector.length).toBe(768);
      expect(res[1].chunkId).toBe('chk_2');
      expect(res[1].vector.length).toBe(768);
    });
  });

  describe('KeyManager Integration & 429 Failover', () => {
    it('executes batchEmbedContents with KeyManager and fails over on 429 without mock vectors', async () => {
      const keys = ['key-failing-123', 'key-healthy-456'];
      const km = new KeyManager(keys, {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
      });

      const callLog: string[] = [];

      const mockGenAIFactory = (apiKey: string): any => ({
        getGenerativeModel: () => ({
          batchEmbedContents: async (req: any) => {
            callLog.push(apiKey);
            if (apiKey === 'key-failing-123') {
              const err: any = new Error('429 ResourceExhausted: rate limit exceeded');
              err.status = 429;
              err.code = 'RESOURCE_EXHAUSTED';
              throw err;
            }
            return {
              embeddings: req.requests.map((_: any, idx: number) => ({
                values: new Array(768).fill(0.123 + idx * 0.01),
              })),
            };
          },
        }),
      });

      const service = new EmbeddingService(km, mockGenAIFactory);
      expect(service.isMockMode()).toBe(false);

      const chunks: Chunk[] = [
        {
          chunkId: 'c1',
          text: 'Superconducting qubits and fluxonium circuits',
          metadata: { docId: 'd1', filename: 'f1.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 45 },
        },
      ];

      const results = await service.embedChunks(chunks);

      // Verify failover happened: first tried key-failing-123, then key-healthy-456
      expect(callLog).toEqual(['key-failing-123', 'key-healthy-456']);
      expect(results).toHaveLength(1);
      expect(results[0].vector[0]).toBeCloseTo(0.123);

      // Verify key statuses
      const statuses = km.getKeyStatuses();
      const failingStatus = statuses.find((s) => s.status === 'COOLDOWN');
      const healthyStatus = statuses.find((s) => s.status === 'ACTIVE');

      expect(failingStatus?.status).toBe('COOLDOWN');
      expect(failingStatus?.cooldownRemainingMs).toBeGreaterThan(0);
      expect(healthyStatus?.status).toBe('ACTIVE');
      expect(healthyStatus?.totalRequests).toBe(1);

      // Verify cached vector is the real API vector, NOT a mock vector
      const cached = cacheService.getEmbedding('Superconducting qubits and fluxonium circuits');
      expect(cached).toEqual(results[0].vector);
    });

    it('throws error and does NOT fallback to mock vectors when all keys are exhausted', async () => {
      const keys = ['key-only-exhausted'];
      const km = new KeyManager(keys, {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
      });

      const mockGenAIFactory = (apiKey: string): any => ({
        getGenerativeModel: () => ({
          batchEmbedContents: async () => {
            const err: any = new Error('429 Too Many Requests');
            err.status = 429;
            throw err;
          },
        }),
      });

      const service = new EmbeddingService(km, mockGenAIFactory);
      expect(service.isMockMode()).toBe(false);

      const chunks: Chunk[] = [
        {
          chunkId: 'c1',
          text: 'Unobtainable embedding text',
          metadata: { docId: 'd1', filename: 'f1.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 27 },
        },
      ];

      await expect(service.embedChunks(chunks)).rejects.toThrow(/All Gemini API keys are currently in cooldown/i);

      // Verify cache was NOT polluted with mock vectors
      const cached = cacheService.getEmbedding('Unobtainable embedding text');
      expect(cached).toBeNull();
    });

    it('embedBatch deduplicates identical texts within the same batch call', async () => {
      const km = new KeyManager(['key-123'], { enableRateLimiting: false });
      let requestsReceived = 0;

      const mockGenAIFactory = (): any => ({
        getGenerativeModel: () => ({
          batchEmbedContents: async (req: any) => {
            requestsReceived = req.requests.length;
            return {
              embeddings: req.requests.map((_: any, idx: number) => ({
                values: new Array(768).fill(idx + 1),
              })),
            };
          },
        }),
      });

      const service = new EmbeddingService(km, mockGenAIFactory);

      // Duplicate text inputs
      const texts = ['duplicate concept', 'duplicate concept', 'different concept'];
      const vectors = await service.embedBatch(texts);

      expect(vectors).toHaveLength(3);
      expect(vectors[0]).toEqual(vectors[1]); // Both identical strings got the same vector
      expect(requestsReceived).toBe(2); // Only 2 unique texts were sent to the Gemini API
    });
  });
});
