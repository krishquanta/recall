import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { KeyManager, maskApiKey } from '../../src/services/KeyManager';
import { CacheService, cacheService } from '../../src/services/CacheService';
import { GraphExtractionService } from '../../src/services/GraphExtractionService';
import { ProvenanceValidator } from '../../src/services/ProvenanceValidator';
import { DeduplicationService } from '../../src/services/DeduplicationService';
import { GraphStore } from '../../src/store/GraphStore';
import { ReviewStore } from '../../src/store/ReviewStore';
import { Chunk, ValidatedEntity, ExtractedGraphPayload } from '../../src/types';

describe('Milestone 5 Tier 5 Adversarial Hardening: Core Optimization Services', () => {
  // =========================================================================
  // SUITE 1: Rapid Concurrent 429 Cascades Across Multiple Keys in KeyManager
  // =========================================================================
  describe('1. KeyManager: Rapid Concurrent 429 Cascades & Failover Resilience', () => {
    it('handles 20 concurrent requests with multiple 429 cascades without race conditions or mock fallback', async () => {
      let virtualNow = 100000;
      const keys = ['AIzaSyCascadeKeyA', 'AIzaSyCascadeKeyB', 'AIzaSyCascadeKeyC', 'AIzaSyCascadeKeyD'];
      const km = new KeyManager(keys, {
        cooldownDurationMs: 60000,
        enableRateLimiting: false, // focus on failover concurrency
        nowFn: () => virtualNow,
      });

      // Emulate: Key A, B, C encounter 429; Key D always succeeds
      const callLog: string[] = [];
      const operation = async (key: string) => {
        callLog.push(key);
        if (key === 'AIzaSyCascadeKeyA' || key === 'AIzaSyCascadeKeyB' || key === 'AIzaSyCascadeKeyC') {
          const err = new Error('429 Too Many Requests: quota exceeded');
          (err as any).status = 429;
          throw err;
        }
        return { success: true, processedBy: key };
      };

      // Launch 20 concurrent calls
      const requests = Array.from({ length: 20 }, () => km.executeWithFailover(operation));
      const results = await Promise.all(requests);

      // Verify all 20 succeeded on Key D
      expect(results.length).toBe(20);
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.processedBy).toBe('AIzaSyCascadeKeyD');
      }

      // Check key statuses
      const statuses = km.getKeyStatuses();
      const statusMap = new Map(statuses.map((s) => [s.maskedKey, s]));

      // Keys A, B, C must be in COOLDOWN
      for (const k of keys.slice(0, 3)) {
        const masked = statuses.find((s) => s.maskedKey === maskApiKey(k));
        expect(masked).toBeDefined();
        expect(masked!.status).toBe('COOLDOWN');
        expect(masked!.cooldownRemainingMs).toBeGreaterThan(0);
      }

      // Key D must be ACTIVE with 20 recorded successes
      const keyDStatus = statuses.find((s) => s.maskedKey === maskApiKey('AIzaSyCascadeKeyD'));
      expect(keyDStatus).toBeDefined();
      expect(keyDStatus!.status).toBe('ACTIVE');
      expect(keyDStatus!.totalRequests).toBe(20);
      expect(keyDStatus!.failedRequests).toBe(0);
    });

    it('throws informative exhaustion error when all keys concurrently encounter 429', async () => {
      let virtualNow = 200000;
      const km = new KeyManager(['AIzaSyExhaustKey1', 'AIzaSyExhaustKey2', 'AIzaSyExhaustKey3'], {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
        nowFn: () => virtualNow,
      });

      const failingOp = async (key: string) => {
        const err = new Error(`Resource exhausted on ${key}`);
        (err as any).statusCode = 429;
        throw err;
      };

      // 10 concurrent requests
      const promises = Array.from({ length: 10 }, () => km.executeWithFailover(failingOp));
      const results = await Promise.allSettled(promises);

      // All 10 must reject with exhausted error
      expect(results.length).toBe(10);
      for (const res of results) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.message).toMatch(/all.*keys.*(cooldown|failed)/i);
        }
      }

      // All 3 keys are now in cooldown
      expect(km.getActiveKeyCount()).toBe(0);
    });

    it('recovers immediately and processes concurrent requests once cooldown expires', async () => {
      let virtualNow = 300000;
      const km = new KeyManager(['AIzaSyRecoverKey1', 'AIzaSyRecoverKey2'], {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
        nowFn: () => virtualNow,
      });

      // Cool both keys down
      km.recordCooldown('AIzaSyRecoverKey1');
      km.recordCooldown('AIzaSyRecoverKey2');
      expect(km.getActiveKeyCount()).toBe(0);

      // Advance virtual time by 60,001 ms (expiry)
      virtualNow += 60001;
      expect(km.getActiveKeyCount()).toBe(2);

      // Now dispatch 10 concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        km.executeWithFailover(async (k) => ({ handledBy: k }))
      );
      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      for (const r of results) {
        expect(r.handledBy).toMatch(/^AIzaSyRecoverKey[12]$/);
      }
    });
  });

  // =========================================================================
  // SUITE 2: CacheService Concurrent Atomic Persistence & Zero Orphaned .tmp Files
  // =========================================================================
  describe('2. CacheService: Concurrent Atomic Persistence & Orphaned .tmp Hygiene', () => {
    const testDir = path.join(__dirname, '..', '..', 'data', 'test_adversarial_m5');
    const testCachePath = path.join(testDir, 'm5_cache.json');

    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(async () => {
      if (fs.existsSync(testDir)) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true });
        } catch {
          // Ignore Windows file lock on test cleanup
        }
      }
    });

    it('survives massive concurrent write burst with zero corruption and zero orphaned .tmp files', async () => {
      const cache = new CacheService(testCachePath);
      await cache.initialize();

      // Launch 30 concurrent setEmbedding + 20 concurrent setQA + 5 concurrent flush calls
      const embeddingTasks = Array.from({ length: 30 }, (_, i) =>
        cache.setEmbedding(`concurrent_term_${i}`, [i * 0.1, i * 0.2, i * 0.3])
      );
      const qaTasks = Array.from({ length: 20 }, (_, i) =>
        cache.setQA(`What is topic ${i}?`, [`doc_${i}`], `Answer for topic ${i}`)
      );
      const flushTasks = Array.from({ length: 5 }, () => cache.flush());

      // Run all simultaneously
      await Promise.all([...embeddingTasks, ...qaTasks, ...flushTasks]);
      await cache.flush();

      // 1. Verify in-memory state
      for (let i = 0; i < 30; i++) {
        const vec = cache.getEmbedding(`concurrent_term_${i}`);
        expect(vec).toEqual([i * 0.1, i * 0.2, i * 0.3]);
      }
      for (let i = 0; i < 20; i++) {
        const ans = cache.getQA(`What is topic ${i}?`, [`doc_${i}`]);
        expect(ans).toBe(`Answer for topic ${i}`);
      }

      // 2. Verify disk state
      expect(fs.existsSync(testCachePath)).toBe(true);
      const rawDisk = fs.readFileSync(testCachePath, 'utf-8');
      const parsed = JSON.parse(rawDisk);
      expect(Object.keys(parsed.embeddings).length).toBe(30);
      expect(Object.keys(parsed.qa).length).toBe(20);

      // 3. STRICT HYGIENE CHECK: ZERO orphaned .tmp files in test directory
      const testFiles = fs.readdirSync(testDir);
      const orphanedTmp = testFiles.filter((f) => f.includes('.tmp.'));
      expect(orphanedTmp.length).toBe(0);
    });

    it('verifies that backend/data/ directory contains zero orphaned gemini_cache .tmp files', () => {
      const backendDataDir = path.join(__dirname, '..', '..', 'data');
      if (fs.existsSync(backendDataDir)) {
        const files = fs.readdirSync(backendDataDir);
        const orphanedCacheTmp = files.filter(
          (f) => f.startsWith('gemini_cache.json.tmp.') || f.startsWith('gemini_cache.tmp.')
        );
        expect(orphanedCacheTmp.length).toBe(0);
      }
    });

    it('cleanupStaleTempFiles correctly cleans up pre-existing abandoned temp files', async () => {
      const cache = new CacheService(testCachePath);
      // Create a simulated stale temp file
      const staleTmpFile = `${testCachePath}.tmp.stale_12345`;
      fs.writeFileSync(staleTmpFile, '{"stale": true}', 'utf-8');
      // Set mtime to 2 hours ago
      const twoHoursAgo = (Date.now() - 7200000) / 1000;
      fs.utimesSync(staleTmpFile, twoHoursAgo, twoHoursAgo);

      expect(fs.existsSync(staleTmpFile)).toBe(true);

      // Run cleanup
      await cache.cleanupStaleTempFiles(60000);

      // Verify stale temp file was purged
      expect(fs.existsSync(staleTmpFile)).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 3: Multi-Chunk Windowing & Strict Provenance Anchoring
  // =========================================================================
  describe('3. Multi-Chunk Windowing: Token Estimation & Strict Provenance Anchoring', () => {
    const extractor = new GraphExtractionService();

    const sampleChunks: Chunk[] = [
      {
        chunkId: 'chunk_window_01',
        text: 'Singular Value Decomposition (SVD) is a fundamental matrix factorization method in linear algebra. It factorizes a real matrix into singular vectors and singular values.',
        metadata: {
          docId: 'doc_math_01',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 0,
          lineStart: 1,
          charStart: 0,
          charEnd: 165,
        },
      },
      {
        chunkId: 'chunk_window_02',
        text: 'Principal Component Analysis (PCA) is an unsupervised learning technique closely related to SVD. PCA identifies directions of maximal variance in high-dimensional data.',
        metadata: {
          docId: 'doc_math_01',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 1,
          lineStart: 10,
          charStart: 166,
          charEnd: 338,
        },
      },
      {
        chunkId: 'chunk_window_03',
        text: 'The Spectral Theorem guarantees that any real symmetric matrix can be orthogonally diagonalized. This theorem forms the mathematical foundation of dimensionality reduction.',
        metadata: {
          docId: 'doc_math_01',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 2,
          lineStart: 20,
          charStart: 339,
          charEnd: 512,
        },
      },
      {
        chunkId: 'chunk_window_04',
        text: 'Eigenvalue Decomposition serves as a special case of SVD for square diagonalizable matrices. It expresses linear transformations in an intuitive coordinate basis.',
        metadata: {
          docId: 'doc_math_01',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 3,
          lineStart: 30,
          charStart: 513,
          charEnd: 677,
        },
      },
    ];

    it('extracts across a 4-chunk window and guarantees 100% character-level provenance grounding', () => {
      const extracted = extractor.extractMockWindow(sampleChunks);
      const validated = ProvenanceValidator.validateAndAnchorWindow(sampleChunks, extracted);

      expect(validated.entities.length).toBeGreaterThan(0);
      expect(validated.claims.length).toBeGreaterThan(0);
      expect(validated.relationships.length).toBeGreaterThan(0);

      // Verify strict character-level provenance on every single validated item
      for (const ent of validated.entities) {
        const chunk = sampleChunks.find((c) => c.chunkId === ent.evidence.chunkId);
        expect(chunk).toBeDefined();
        const { start, end } = ent.evidence.charOffset;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(chunk!.text.length);
        const verbatimInChunk = chunk!.text.substring(start, end);
        expect(verbatimInChunk).toBe(ent.evidence.exactQuote);
      }

      for (const claim of validated.claims) {
        const chunk = sampleChunks.find((c) => c.chunkId === claim.evidence.chunkId);
        expect(chunk).toBeDefined();
        const { start, end } = claim.evidence.charOffset;
        const verbatimInChunk = chunk!.text.substring(start, end);
        expect(verbatimInChunk).toBe(claim.evidence.exactQuote);
      }

      for (const rel of validated.relationships) {
        const chunk = sampleChunks.find((c) => c.chunkId === rel.evidence.chunkId);
        expect(chunk).toBeDefined();
        const { start, end } = rel.evidence.charOffset;
        const verbatimInChunk = chunk!.text.substring(start, end);
        expect(verbatimInChunk).toBe(rel.evidence.exactQuote);
      }
    });

    it('strictly discards ungrounded or hallucinated assertions', () => {
      const hallucinatedPayload: ExtractedGraphPayload = {
        entities: [
          {
            name: 'Alien Quantum Reactor',
            type: 'Concept',
            mentionQuote: 'Alien quantum reactors were discovered orbiting Jupiter.',
          },
        ],
        claims: [
          {
            subjectEntityName: 'Alien Quantum Reactor',
            claimText: 'Reactors operate via faster-than-light tachyon pulses.',
            modality: 'Fact',
            confidence: 0.99,
            exactQuote: 'Reactors operate via faster-than-light tachyon pulses.',
          },
        ],
        relationships: [
          {
            sourceEntityName: 'Alien Quantum Reactor',
            targetEntityName: 'Jupiter',
            relationType: 'PART_OF',
            description: 'Reactor orbits Jupiter',
            confidence: 0.95,
            exactQuote: 'Alien quantum reactors were discovered orbiting Jupiter.',
          },
        ],
      };

      const validated = ProvenanceValidator.validateAndAnchorWindow(sampleChunks, hallucinatedPayload);
      expect(validated.entities.length).toBe(0);
      expect(validated.claims.length).toBe(0);
      expect(validated.relationships.length).toBe(0);
    });

    it('handles edge case inputs cleanly (empty chunk array, whitespace only)', () => {
      const empty1 = extractor.extractMockWindow([]);
      expect(empty1.entities).toEqual([]);
      const validatedEmpty = ProvenanceValidator.validateAndAnchorWindow([], empty1);
      expect(validatedEmpty.entities).toEqual([]);

      const whitespaceChunk: Chunk = {
        chunkId: 'chunk_ws',
        text: '   \n\t   ',
        metadata: {
          docId: 'd1',
          filename: 'ws.txt',
          mimeType: 'text/plain',
          chunkIndex: 0,
          lineStart: 1,
          charStart: 0,
          charEnd: 7,
        },
      };
      const empty2 = extractor.extractMockWindow([whitespaceChunk]);
      expect(empty2.entities).toEqual([]);
    });
  });

  // =========================================================================
  // SUITE 4: Batch Entity Deduplication Slicing at 100-Item Boundaries & Cache Pre-Filtering
  // =========================================================================
  describe('4. DeduplicationService: 100-Item Slicing & Cache Pre-Filtering', () => {
    let mockGraph: GraphStore;
    let mockReview: ReviewStore;

    beforeEach(() => {
      cacheService.clear();
      mockGraph = new GraphStore();
      mockReview = new ReviewStore();
    });

    const createCandidates = (count: number, prefix = 'Entity'): ValidatedEntity[] => {
      const runId = Math.random().toString(36).substring(2, 7);
      return Array.from({ length: count }, (_, i) => ({
        name: `${prefix}_${runId}_${i + 1}`,
        type: 'Concept' as const,
        aliases: [`Alias_${i + 1}`],
        evidence: {
          docId: 'doc_1',
          chunkId: 'chunk_1',
          filename: 'test.txt',
          exactQuote: `Sample quote for ${prefix}_${i + 1}`,
          charOffset: { start: 0, end: 20 },
        },
      }));
    };

    it('slices candidate entities exactly at 100-item boundaries (100, 101, 205 items)', async () => {
      const batchCalls: string[][] = [];
      const mockEmbedder: any = {
        embedBatch: async (texts: string[]) => {
          batchCalls.push([...texts]);
          return texts.map(() => new Array(768).fill(0.1));
        },
        embedQuery: async () => new Array(768).fill(0.1),
        generateMockEmbedding: () => new Array(768).fill(0.1),
      };

      const dedup = new DeduplicationService(mockGraph, mockReview, mockEmbedder);

      // Case A: Exactly 100 candidates -> Exactly 1 batch call with 100 items
      batchCalls.length = 0;
      const entities100 = createCandidates(100, 'BatchA');
      await dedup.resolveEntities(entities100);
      expect(batchCalls.length).toBe(1);
      expect(batchCalls[0].length).toBe(100);

      // Case B: Exactly 101 candidates -> Exactly 2 batch calls (100 + 1)
      batchCalls.length = 0;
      const entities101 = createCandidates(101, 'BatchB');
      await dedup.resolveEntities(entities101);
      expect(batchCalls.length).toBe(2);
      expect(batchCalls[0].length).toBe(100);
      expect(batchCalls[1].length).toBe(1);

      // Case C: Exactly 205 candidates -> Exactly 3 batch calls (100 + 100 + 5)
      batchCalls.length = 0;
      const entities205 = createCandidates(205, 'BatchC');
      await dedup.resolveEntities(entities205);
      expect(batchCalls.length).toBe(3);
      expect(batchCalls[0].length).toBe(100);
      expect(batchCalls[1].length).toBe(100);
      expect(batchCalls[2].length).toBe(5);
    }, 25000);

    it('cache pre-filtering filters out cached entities and reduces batch calls by >90%', async () => {
      const batchCalls: string[][] = [];
      const mockEmbedder: any = {
        embedBatch: async (texts: string[]) => {
          batchCalls.push([...texts]);
          return texts.map(() => new Array(768).fill(0.05));
        },
        embedQuery: async () => new Array(768).fill(0.05),
        generateMockEmbedding: () => new Array(768).fill(0.05),
      };

      const dedup = new DeduplicationService(mockGraph, mockReview, mockEmbedder);

      // Pass 1: 150 unique candidates
      const entities = createCandidates(150, 'PrefilterTest');
      batchCalls.length = 0;
      await dedup.resolveEntities(entities);

      // 150 unseen items -> 2 calls (100 + 50)
      expect(batchCalls.length).toBe(2);
      expect(batchCalls[0].length).toBe(100);
      expect(batchCalls[1].length).toBe(50);

      // Pass 2: Re-run with the exact same 150 candidates!
      // All 150 must now be pre-filtered by CacheService -> exactly 0 batch calls!
      batchCalls.length = 0;
      const secondResolution = await dedup.resolveEntities(entities);

      expect(batchCalls.length).toBe(0);
      expect(secondResolution.size).toBeGreaterThanOrEqual(150);
    });

    it('deduplicates duplicate candidate names within the same batch prior to embedding', async () => {
      const batchCalls: string[][] = [];
      const mockEmbedder: any = {
        embedBatch: async (texts: string[]) => {
          batchCalls.push([...texts]);
          return texts.map(() => new Array(768).fill(0.02));
        },
        embedQuery: async () => new Array(768).fill(0.02),
        generateMockEmbedding: () => new Array(768).fill(0.02),
      };

      const dedup = new DeduplicationService(mockGraph, mockReview, mockEmbedder);

      // 10 candidates, but all have the exact same name
      const duplicateCandidates: ValidatedEntity[] = Array.from({ length: 10 }, () => ({
        name: 'RepeatedConceptUniqueTest',
        type: 'Concept' as const,
        aliases: [],
        evidence: {
          docId: 'doc_1',
          chunkId: 'chunk_1',
          filename: 'test.txt',
          exactQuote: 'Quote',
          charOffset: { start: 0, end: 5 },
        },
      }));

      batchCalls.length = 0;
      const idMap = await dedup.resolveEntities(duplicateCandidates);

      // Only 1 unique name embedded
      expect(batchCalls.length).toBe(1);
      expect(batchCalls[0].length).toBe(1);
      expect(batchCalls[0][0]).toBe('RepeatedConceptUniqueTest');
      expect(idMap.get('RepeatedConceptUniqueTest')).toBeDefined();
    });
  });
});
