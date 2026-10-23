import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { CacheService, cacheService } from '../../src/services/CacheService';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { Chunk } from '../../src/types';

describe('CacheService Unit Tests', () => {
  const testDir = path.resolve(__dirname, '../fixtures/test-cache-dir');
  const testCachePath = path.join(testDir, 'test_gemini_cache.json');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    cacheService.clear();
  });

  afterEach(() => {
    cacheService.clear();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Embedding Caching', () => {
    it('returns null on cache miss and increments embeddingMisses', () => {
      const cache = new CacheService(testCachePath);
      const result = cache.getEmbedding('uncached text snippet');

      expect(result).toBeNull();
      const stats = cache.getStats();
      expect(stats.embeddingMisses).toBe(1);
      expect(stats.embeddingHits).toBe(0);
      expect(stats.totalRequestsSaved).toBe(0);
    });

    it('returns identical vector on cache hit and increments embeddingHits & totalRequestsSaved', async () => {
      const cache = new CacheService(testCachePath);
      const text = 'Photosynthesis in C4 plants';
      const vector = [0.123, -0.456, 0.789, 0.001];

      await cache.setEmbedding(text, vector);
      const hit = cache.getEmbedding(text);

      expect(hit).toEqual(vector);
      const stats = cache.getStats();
      expect(stats.embeddingHits).toBe(1);
      expect(stats.embeddingMisses).toBe(0);
      expect(stats.totalRequestsSaved).toBe(1);
    });

    it('generates deterministic SHA-256 keys for identical text', () => {
      const cache = new CacheService(testCachePath);
      const key1 = cache.hashEmbeddingKey('Exact Text String');
      const key2 = cache.hashEmbeddingKey('Exact Text String');
      const key3 = cache.hashEmbeddingKey('Different Text String');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1.length).toBe(64); // SHA-256 hex string length
    });

    it('supports batch embedding caching via setEmbeddingBatch', async () => {
      const cache = new CacheService(testCachePath);
      const batch = [
        { text: 'batch item alpha', vector: [1, 0, 0] },
        { text: 'batch item beta', vector: [0, 1, 0] },
        { text: 'batch item gamma', vector: [0, 0, 1] },
      ];

      await cache.setEmbeddingBatch(batch);

      expect(cache.getEmbedding('batch item alpha')).toEqual([1, 0, 0]);
      expect(cache.getEmbedding('batch item beta')).toEqual([0, 1, 0]);
      expect(cache.getEmbedding('batch item gamma')).toEqual([0, 0, 1]);

      const stats = cache.getStats();
      expect(stats.embeddingHits).toBe(3);
      expect(stats.totalRequestsSaved).toBe(3);
    });
  });

  describe('Q&A Response Caching', () => {
    it('returns null on Q&A cache miss and increments qaMisses', () => {
      const cache = new CacheService(testCachePath);
      const answer = cache.getQA('What is the capital of France?');

      expect(answer).toBeNull();
      const stats = cache.getStats();
      expect(stats.qaMisses).toBe(1);
      expect(stats.qaHits).toBe(0);
      expect(stats.totalRequestsSaved).toBe(0);
    });

    it('returns cached answer on hit and increments qaHits & totalRequestsSaved', async () => {
      const cache = new CacheService(testCachePath);
      const question = 'What is cellular respiration?';
      const docIds = ['doc_bio_1'];
      const answer = 'Cellular respiration is a metabolic pathway that breaks down glucose to produce ATP.';

      await cache.setQA(question, docIds, answer);
      const cached = cache.getQA(question, docIds);

      expect(cached).toBe(answer);
      const stats = cache.getStats();
      expect(stats.qaHits).toBe(1);
      expect(stats.qaMisses).toBe(0);
      expect(stats.totalRequestsSaved).toBe(1);
    });

    it('normalizes question by trimming whitespace and lowercasing', async () => {
      const cache = new CacheService(testCachePath);
      const questionOriginal = '  What is Machine Learning?  ';
      const questionQuery = 'what is machine learning?';
      const answer = 'Machine learning is a field of AI focusing on data-driven models.';

      await cache.setQA(questionOriginal, undefined, answer);
      const hit = cache.getQA(questionQuery);

      expect(hit).toBe(answer);
    });

    it('sorts docIds alphabetically so order does not affect cache hit', async () => {
      const cache = new CacheService(testCachePath);
      const question = 'Summarize quantum mechanics findings';
      const docIdsStored = ['docZ', 'docA', 'docM'];
      const docIdsQueried = ['docA', 'docM', 'docZ'];
      const answer = 'Quantum mechanics governs physical properties at atomic and subatomic scales.';

      await cache.setQA(question, docIdsStored, answer);
      const hit = cache.getQA(question, docIdsQueried);

      expect(hit).toBe(answer);
    });

    it('treats empty docIds array and undefined docIds as equivalent', async () => {
      const cache = new CacheService(testCachePath);
      const question = 'What is entropy?';
      const answer = 'Entropy is a measure of randomness or disorder in a system.';

      await cache.setQA(question, undefined, answer);
      const hit = cache.getQA(question, []);

      expect(hit).toBe(answer);
    });
  });

  describe('Disk Persistence & Rehydration', () => {
    it('persists cache to disk and reloads on fresh instance', async () => {
      const cache1 = new CacheService(testCachePath);
      await cache1.setEmbedding('persistent text', [0.42, 0.84]);
      await cache1.setQA('Persistent question?', ['doc1'], 'Persistent answer.');
      await cache1.flush();

      expect(fs.existsSync(testCachePath)).toBe(true);

      // Create new separate instance reading same file
      const cache2 = new CacheService(testCachePath);
      await cache2.initialize();

      expect(cache2.getEmbedding('persistent text')).toEqual([0.42, 0.84]);
      expect(cache2.getQA('Persistent question?', ['doc1'])).toBe('Persistent answer.');

      const stats2 = cache2.getStats();
      expect(stats2.embeddingHits).toBe(1);
      expect(stats2.qaHits).toBe(1);
      expect(stats2.totalRequestsSaved).toBe(2);
    });

    it('serializes stats to disk and initializes fresh instances with clean stats', async () => {
      const cache1 = new CacheService(testCachePath);
      cache1.getEmbedding('miss1');
      cache1.getEmbedding('miss2');
      cache1.getQA('missQA');
      await cache1.setEmbedding('hit1', [1, 2, 3]);
      cache1.getEmbedding('hit1');
      await cache1.flush();

      const stats1 = cache1.getStats();
      expect(stats1.embeddingMisses).toBe(2);
      expect(stats1.embeddingHits).toBe(1);
      expect(stats1.qaMisses).toBe(1);
      expect(stats1.totalRequestsSaved).toBe(1);

      // Verify file on disk contains the serialized stats
      const raw = JSON.parse(fs.readFileSync(testCachePath, 'utf-8'));
      expect(raw.stats.embeddingHits).toBe(1);
      expect(raw.stats.embeddingMisses).toBe(2);

      // Fresh instance starts with fresh session metrics
      const cache2 = new CacheService(testCachePath);
      await cache2.initialize();
      const stats2 = cache2.getStats();

      expect(stats2.embeddingMisses).toBe(0);
      expect(stats2.embeddingHits).toBe(0);
      expect(stats2.totalRequestsSaved).toBe(0);

      // Cached embedding from file is immediately accessible
      expect(cache2.getEmbedding('hit1')).toEqual([1, 2, 3]);
      expect(cache2.getStats().embeddingHits).toBe(1);
      expect(cache2.getStats().totalRequestsSaved).toBe(1);
    });

    it('leaves no orphaned temporary files after atomic persistence', async () => {
      const cache = new CacheService(testCachePath);
      for (let i = 0; i < 15; i++) {
        await cache.setEmbedding(`temp_test_${i}`, [i, i * 2]);
      }
      await cache.flush();

      const files = fs.readdirSync(testDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);
      expect(files).toContain(path.basename(testCachePath));
    });

    it('recovers gracefully from corrupt or empty JSON file', async () => {
      fs.writeFileSync(testCachePath, '{ invalid json @@ corrupt', 'utf-8');

      const cache = new CacheService(testCachePath);
      await cache.initialize();

      expect(cache.getEmbedding('any')).toBeNull();
      expect(cache.getQA('any')).toBeNull();
      expect(cache.getStats().embeddingMisses).toBe(1);
      expect(cache.getStats().qaMisses).toBe(1);
    });
  });

  describe('Integration with EmbeddingService', () => {
    it('caches query embedding on first call and avoids duplicate computation on second', async () => {
      const embedder = new EmbeddingService();
      const text = 'Thermodynamics of black holes';

      // First call: cache miss, computes vector and stores in cache
      const vector1 = await embedder.embedQuery(text);
      expect(vector1).toBeDefined();
      expect(vector1.length).toBe(768);

      // Second call: cache hit, returns identical vector directly from cache
      const vector2 = await embedder.embedQuery(text);
      expect(vector2).toEqual(vector1);

      const stats = cacheService.getStats();
      expect(stats.embeddingHits).toBeGreaterThanOrEqual(1);
      expect(stats.totalRequestsSaved).toBeGreaterThanOrEqual(1);
    });

    it('caches chunks and only embeds uncached chunks in subsequent batches', async () => {
      const embedder = new EmbeddingService();
      const chunksBatch1: Chunk[] = [
        {
          chunkId: 'c1',
          text: 'Superconductivity at high temperatures',
          metadata: { docId: 'd1', filename: 'f1.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 38 },
        },
        {
          chunkId: 'c2',
          text: 'Bose-Einstein condensates in optical lattices',
          metadata: { docId: 'd1', filename: 'f1.txt', mimeType: 'text/plain', chunkIndex: 1, charStart: 39, charEnd: 84 },
        },
      ];

      // Batch 1: both uncached
      const res1 = await embedder.embedChunks(chunksBatch1);
      expect(res1.length).toBe(2);

      // Batch 2: c1 is cached, c3 is new
      const chunksBatch2: Chunk[] = [
        {
          chunkId: 'c1_again',
          text: 'Superconductivity at high temperatures', // identical to c1
          metadata: { docId: 'd2', filename: 'f2.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 38 },
        },
        {
          chunkId: 'c3',
          text: 'Topological insulators in condensed matter', // new
          metadata: { docId: 'd2', filename: 'f2.txt', mimeType: 'text/plain', chunkIndex: 1, charStart: 39, charEnd: 81 },
        },
      ];

      const res2 = await embedder.embedChunks(chunksBatch2);
      expect(res2.length).toBe(2);
      expect(res2[0].vector).toEqual(res1[0].vector);

      const stats = cacheService.getStats();
      expect(stats.embeddingHits).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cache Reset & Concurrency Safety', () => {
    it('clear() empties in-memory maps and resets statistics', async () => {
      const cache = new CacheService(testCachePath);
      await cache.setEmbedding('sample', [1, 2]);
      await cache.setQA('question', undefined, 'answer');
      cache.getEmbedding('missing');

      cache.clear();

      expect(cache.getEmbedding('sample')).toBeNull();
      expect(cache.getQA('question')).toBeNull();
      const stats = cache.getStats();
      expect(stats.embeddingHits).toBe(0);
      expect(stats.embeddingMisses).toBe(1); // from getEmbedding('sample') miss after clear
      expect(stats.qaHits).toBe(0);
      expect(stats.qaMisses).toBe(1); // from getQA('question') miss after clear
      expect(stats.totalRequestsSaved).toBe(0);
    });

    it('handles concurrent set operations sequentially without race conditions', async () => {
      const cache = new CacheService(testCachePath);
      const operations = Array.from({ length: 20 }, (_, i) =>
        cache.setEmbedding(`concurrent_${i}`, [i, i * 10])
      );

      await Promise.all(operations);
      await cache.flush();

      for (let i = 0; i < 20; i++) {
        expect(cache.getEmbedding(`concurrent_${i}`)).toEqual([i, i * 10]);
      }

      // Verify rehydration after concurrent writes
      const cache2 = new CacheService(testCachePath);
      await cache2.initialize();
      for (let i = 0; i < 20; i++) {
        expect(cache2.getEmbedding(`concurrent_${i}`)).toEqual([i, i * 10]);
      }
    });

    it('serializes writes across multiple distinct instances accessing the same file path without leaving .tmp files', async () => {
      const instances = Array.from({ length: 5 }, () => new CacheService(testCachePath));

      const writePromises = instances.map((instance, idx) =>
        instance.setEmbedding(`cross_instance_${idx}`, [idx, idx * 2])
      );

      await Promise.all(writePromises);
      await Promise.all(instances.map((inst) => inst.flush()));

      // Verify all items are readable
      const freshReader = new CacheService(testCachePath);
      await freshReader.initialize();
      for (let i = 0; i < 5; i++) {
        expect(freshReader.getEmbedding(`cross_instance_${i}`)).toEqual([i, i * 2]);
      }

      // Verify zero orphaned .tmp files
      const files = fs.readdirSync(testDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles.length).toBe(0);
    });

    it('prevents accidental QA key collisions across question/docId boundaries via distinct delimiter', () => {
      const cache = new CacheService(testCachePath);
      const key1 = cache.hashQAKey('what is ai', ['10']);
      const key2 = cache.hashQAKey('what is ai1', ['0']);

      expect(key1).not.toBe(key2);
    });

    it('safeUnlink retries with backoff on EBUSY errors before succeeding', async () => {
      const tempFile = path.join(testDir, 'retry_test.tmp');
      fs.writeFileSync(tempFile, 'temporary data', 'utf-8');

      let attempts = 0;
      const originalUnlink = fs.promises.unlink;
      vi.spyOn(fs.promises, 'unlink').mockImplementation(async (target) => {
        if (target === tempFile && attempts < 2) {
          attempts++;
          const err: any = new Error('resource busy or locked');
          err.code = 'EBUSY';
          throw err;
        }
        return originalUnlink.call(fs.promises, target);
      });

      try {
        await CacheService.safeUnlink(tempFile, 3, 20);
        expect(attempts).toBe(2);
        expect(fs.existsSync(tempFile)).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('sweeps and cleans up stale temporary files older than maxAge on initialize()', async () => {
      const staleFile = path.join(testDir, `${path.basename(testCachePath)}.tmp.stale_old`);
      const recentFile = path.join(testDir, `${path.basename(testCachePath)}.tmp.active_recent`);

      fs.writeFileSync(staleFile, 'stale temp', 'utf-8');
      fs.writeFileSync(recentFile, 'recent in-flight temp', 'utf-8');

      // Set staleFile mtime to 120 seconds in the past
      const pastTime = (Date.now() - 120000) / 1000;
      fs.utimesSync(staleFile, pastTime, pastTime);

      const cache = new CacheService(testCachePath);
      await cache.initialize(60000);

      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(recentFile)).toBe(true);

      // Clean up recentFile
      if (fs.existsSync(recentFile)) {
        fs.unlinkSync(recentFile);
      }
    });
  });
});
