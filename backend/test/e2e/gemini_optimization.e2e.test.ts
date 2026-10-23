import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { app } from '../../src/index';
import { keyManager, KeyManager, maskApiKey, isRateLimitError, KeyStatus } from '../../src/services/KeyManager';
import { embeddingService } from '../../src/services/EmbeddingService';
import { llmService } from '../../src/services/LLMService';
import { cacheService } from '../../src/services/CacheService';
import { sweepAllTempFilesSync } from '../../src/utils/fileStorage';

/**
 * Controlled Mock Gemini Provider for Opaque-Box E2E Testing.
 * Emulates Gemini API behavior deterministically without network calls or billable credits.
 */
class ControlledGeminiProvider {
  private callLog: Array<{ key: string; method: string; payload: any; timestamp: number }> = [];
  private failKeys = new Set<string>();
  private failOnceKeys = new Set<string>();

  public simulate429On(key: string, onceOnly: boolean = false): void {
    if (onceOnly) {
      this.failOnceKeys.add(key);
    } else {
      this.failKeys.add(key);
    }
  }

  public clearFailures(): void {
    this.failKeys.clear();
    this.failOnceKeys.clear();
  }

  public reset(): void {
    this.callLog = [];
    this.clearFailures();
  }

  public getCalls(): Array<{ key: string; method: string; payload: any; timestamp: number }> {
    return [...this.callLog];
  }

  public getCallsForKey(key: string): Array<{ key: string; method: string; payload: any; timestamp: number }> {
    return this.callLog.filter((c) => c.key === key);
  }

  public async embedChunks(key: string, chunks: Array<{ chunkId: string; text: string }>): Promise<Array<{ chunkId: string; vector: number[] }>> {
    this.recordCall(key, 'batchEmbedContents', { count: chunks.length });
    this.checkFailures(key);
    return chunks.map((c) => ({
      chunkId: c.chunkId,
      vector: this.generateDeterministicVector(c.text),
    }));
  }

  public async embedQuery(key: string, query: string): Promise<number[]> {
    this.recordCall(key, 'embedContent', { query });
    this.checkFailures(key);
    return this.generateDeterministicVector(query);
  }

  public async generateContent(key: string, prompt: string): Promise<{ text: string }> {
    this.recordCall(key, 'generateContent', { promptLength: prompt.length });
    this.checkFailures(key);
    return {
      text: JSON.stringify({
        answer: `Verified response for: ${prompt.slice(0, 50)}...`,
        citations: [{ chunkId: 'c1', exactQuote: 'verbatim quote', docId: 'doc1' }],
      }),
    };
  }

  private recordCall(key: string, method: string, payload: any): void {
    this.callLog.push({
      key,
      method,
      payload,
      timestamp: Date.now(),
    });
  }

  private checkFailures(key: string): void {
    if (this.failOnceKeys.has(key)) {
      this.failOnceKeys.delete(key);
      const err: any = new Error('429 Too Many Requests: ResourceExhausted');
      err.status = 429;
      err.statusCode = 429;
      err.code = 'RESOURCE_EXHAUSTED';
      throw err;
    }
    if (this.failKeys.has(key)) {
      const err: any = new Error('429 Quota Exceeded: RESOURCE_EXHAUSTED');
      err.status = 429;
      err.statusCode = 429;
      err.code = 'RESOURCE_EXHAUSTED';
      throw err;
    }
  }

  private generateDeterministicVector(text: string, dim: number = 768): number[] {
    const vec = new Array(dim).fill(0);
    const cleaned = (text || '').trim().toLowerCase();
    for (let i = 0; i < cleaned.length; i++) {
      const idx = (cleaned.charCodeAt(i) * (i + 1)) % dim;
      vec[idx] += 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) vec[i] /= norm;
    } else {
      vec[0] = 1;
    }
    return vec;
  }
}

// Progressive module availability detection
const cacheServicePath = path.resolve(__dirname, '../../src/services/CacheService.ts');
const hasCacheService = fs.existsSync(cacheServicePath);

const settingsRoutePath = path.resolve(__dirname, '../../src/routes/settings.ts');
const hasSettingsRoute = fs.existsSync(settingsRoutePath);

describe('E2E Test Suite: Gemini API Key Optimization & Caching', () => {
  let mockProvider: ControlledGeminiProvider;

  beforeEach(() => {
    mockProvider = new ControlledGeminiProvider();
  });

  afterEach(() => {
    mockProvider.reset();
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 Test Cases Per Feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('Feature R1: Multi-Key Pooling & Auto-Failover', () => {
      it('T1-R1-01: Multi-Key Initialization loads and masks multiple keys', () => {
        const km = new KeyManager(['AIzaSyTestKeyOne111', 'AIzaSyTestKeyTwo222', 'AIzaSyTestKeyThree333']);
        expect(km.getTotalKeyCount()).toBe(3);
        expect(km.getActiveKeyCount()).toBe(3);

        const statuses = km.getKeyStatuses();
        expect(statuses.length).toBe(3);
        for (const s of statuses) {
          expect(s.status).toBe('ACTIVE');
          expect(s.maskedKey).toContain('...');
          expect(s.totalRequests).toBe(0);
          expect(s.failedRequests).toBe(0);
        }
      });

      it('T1-R1-02: Backward Compatibility works seamlessly with a single key', () => {
        const km = new KeyManager(['AIzaSySingleKeyOnly1234']);
        expect(km.getTotalKeyCount()).toBe(1);
        expect(km.getActiveKeyCount()).toBe(1);

        const key = km.getActiveKey();
        expect(key).toBe('AIzaSySingleKeyOnly1234');
      });

      it('T1-R1-03: Round-Robin Key Scheduling distributes requests evenly across active keys', async () => {
        const keys = ['keyAlpha12345', 'keyBeta67890', 'keyGamma54321'];
        const km = new KeyManager(keys, { enableRateLimiting: false });

        for (let i = 0; i < 9; i++) {
          await km.executeWithFailover(async (k) => {
            return mockProvider.embedQuery(k, `query_${i}`);
          });
        }

        expect(mockProvider.getCallsForKey('keyAlpha12345').length).toBe(3);
        expect(mockProvider.getCallsForKey('keyBeta67890').length).toBe(3);
        expect(mockProvider.getCallsForKey('keyGamma54321').length).toBe(3);

        const statuses = km.getKeyStatuses();
        for (const s of statuses) {
          expect(s.totalRequests).toBe(3);
          expect(s.failedRequests).toBe(0);
        }
      });

      it('T1-R1-04: 429 Failover immediately retries with next key and sets 60s cooldown', async () => {
        const keys = ['keyFailing123', 'keyBackup456'];
        const km = new KeyManager(keys, {
          cooldownDurationMs: 60000,
          enableRateLimiting: false,
        });

        // Simulate 429 on first key
        mockProvider.simulate429On('keyFailing123', true);

        const result = await km.executeWithFailover(async (k) => {
          return mockProvider.embedQuery(k, 'critical payload');
        });

        expect(result).toBeDefined();
        expect(result.length).toBe(768);

        // First key should now be in cooldown
        const statuses = km.getKeyStatuses();
        const failingStatus = statuses.find((s) => s.maskedKey === maskApiKey('keyFailing123'));
        const backupStatus = statuses.find((s) => s.maskedKey === maskApiKey('keyBackup456'));

        expect(failingStatus?.status).toBe('COOLDOWN');
        expect(failingStatus?.cooldownRemainingMs).toBeGreaterThan(50000);
        expect(failingStatus?.failedRequests).toBe(1);

        expect(backupStatus?.status).toBe('ACTIVE');
        expect(backupStatus?.totalRequests).toBe(1);
        expect(backupStatus?.failedRequests).toBe(0);
      });

      it('T1-R1-05: Dynamic Key Addition adds active key and expands pool capacity', () => {
        const km = new KeyManager(['initialKey111'], { enableRateLimiting: false });
        expect(km.getTotalKeyCount()).toBe(1);

        const addResult = km.addKey('AIzaSyDynamicKey999');
        expect(addResult.success).toBe(true);
        expect(addResult.keyId).toBeDefined();

        expect(km.getTotalKeyCount()).toBe(2);
        expect(km.getActiveKeyCount()).toBe(2);

        const statuses = km.getKeyStatuses();
        expect(statuses.some((s) => s.maskedKey === maskApiKey('AIzaSyDynamicKey999'))).toBe(true);
      });
    });

    describe('Feature R4: Adaptive Rate Limiting & Token Bucket', () => {
      it('T1-R4-01: Single key initializes with 15 RPM token bucket capacity', () => {
        const km = new KeyManager(['keyOne'], { rpmPerKey: 15 });
        expect(km.getTokens('keyOne')).toBe(15);
      });

      it('T1-R4-02: Multi-key pool scales aggregate capacity proportionally', () => {
        const km = new KeyManager(['keyA', 'keyB', 'keyC'], { rpmPerKey: 15 });
        expect(km.getTokens()).toBe(45);
      });

      it('T1-R4-03: Token consumption decrements available tokens on execution', async () => {
        const km = new KeyManager(['keyOne'], { rpmPerKey: 15, enableRateLimiting: true });
        const before = km.getTokens('keyOne');

        await km.executeWithFailover(async (k) => {
          return mockProvider.embedQuery(k, 'hello');
        });

        const after = km.getTokens('keyOne');
        expect(after).toBeLessThan(before);
      });

      it('T1-R4-04: Burst handling within capacity completes without throttling', async () => {
        const km = new KeyManager(['keyBurst1', 'keyBurst2'], { rpmPerKey: 15, enableRateLimiting: true });
        const start = Date.now();

        // 10 concurrent requests (< capacity 30)
        const tasks = Array.from({ length: 10 }, (_, i) =>
          km.executeWithFailover(async (k) => mockProvider.embedQuery(k, `burst_${i}`))
        );

        const results = await Promise.all(tasks);
        const elapsed = Date.now() - start;

        expect(results.length).toBe(10);
        expect(elapsed).toBeLessThan(2000); // Instant burst without waiting
      });

      it('T1-R4-05: Depleted tokens trigger proactive delay via sleepFn', async () => {
        let sleepCalled = false;
        let sleepDurationMs = 0;

        const km = new KeyManager(['keyThrottled'], {
          rpmPerKey: 1,
          enableRateLimiting: true,
          sleepFn: async (ms) => {
            sleepCalled = true;
            sleepDurationMs = ms;
            (km as any).keys[0].tokens += 1;
          },
        });

        // First consumes token
        await km.acquireToken();
        // Second should require wait
        await km.acquireToken();

        expect(sleepCalled).toBe(true);
        expect(sleepDurationMs).toBeGreaterThan(0);
      });
    });

    describe('Feature R1/R5: Key Masking & Telemetry Guardrails', () => {
      it('T1-R1-06: Key Masking obscures secret characters and preserves prefix/suffix', () => {
        const maskedStandard = maskApiKey('AIzaSyD-1234567890abcdefghijklmno');
        expect(maskedStandard).toMatch(/^AIzaSy\.\.\.[a-z0-9]+$/);
        expect(maskedStandard).not.toContain('1234567890');

        const maskedShort = maskApiKey('1234567');
        expect(maskedShort).toBe('123...67');

        const maskedTiny = maskApiKey('abc');
        expect(maskedTiny).toBe('***');
      });

      it('T1-R1-07: Key statuses distinguish ACTIVE and COOLDOWN states accurately', () => {
        const km = new KeyManager(['keyActive', 'keyCooling'], { cooldownDurationMs: 50000 });
        km.recordCooldown('keyCooling');

        const statuses = km.getKeyStatuses();
        const active = statuses.find((s) => s.maskedKey === maskApiKey('keyActive'));
        const cooling = statuses.find((s) => s.maskedKey === maskApiKey('keyCooling'));

        expect(active?.status).toBe('ACTIVE');
        expect(active?.cooldownRemainingMs).toBe(0);

        expect(cooling?.status).toBe('COOLDOWN');
        expect(cooling?.cooldownRemainingMs).toBeGreaterThan(0);
      });

      it('T1-R1-08: Cooldown remaining countdown decrements as time elapses', async () => {
        const km = new KeyManager(['keyTiming'], { cooldownDurationMs: 500 });
        km.recordCooldown('keyTiming');

        const status1 = km.getKeyStatuses()[0];
        expect(status1.status).toBe('COOLDOWN');
        const rem1 = status1.cooldownRemainingMs;

        await new Promise((r) => setTimeout(r, 100));

        const status2 = km.getKeyStatuses()[0];
        const rem2 = status2.cooldownRemainingMs;
        expect(rem2).toBeLessThan(rem1);
      });

      it('T1-R1-09: Request success and failure counts track accurately per key', () => {
        const km = new KeyManager(['keyStats']);
        km.recordSuccess('keyStats');
        km.recordSuccess('keyStats');
        km.recordFailure('keyStats');

        const status = km.getKeyStatuses()[0];
        expect(status.totalRequests).toBe(3);
        expect(status.failedRequests).toBe(1);
      });

      it('T1-R1-10: Last used timestamp records on successful execution', async () => {
        const km = new KeyManager(['keyTimestamp'], { enableRateLimiting: false });
        expect(km.getKeyStatuses()[0].lastUsedTimestamp).toBeNull();

        await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'test'));

        expect(km.getKeyStatuses()[0].lastUsedTimestamp).toBeTypeOf('number');
        expect(km.getKeyStatuses()[0].lastUsedTimestamp).toBeGreaterThan(0);
      });
    });

    // Progressive suites: R2, R3, R5
    describe.runIf(hasCacheService)('Feature R2: Persistent Two-Tier Caching', () => {
      it('T1-R2-01: In-memory embedding cache hit returns identical vector with 0 provider calls', async () => {
        const { CacheService } = require('../../src/services/CacheService');
        const cache = new CacheService();
        await cache.initialize();

        const text = 'Quantum entanglement in macroscopic systems';
        const vector = mockProvider['generateDeterministicVector'](text);

        await cache.setEmbedding(text, vector);
        const hit = cache.getEmbedding(text);

        expect(hit).toEqual(vector);
        expect(cache.getStats().embeddingHits).toBe(1);
        expect(cache.getStats().totalRequestsSaved).toBe(1);
      });

      it('T1-R2-02: Exact Q&A response cache hit returns instant answer for repeated query', async () => {
        const { CacheService } = require('../../src/services/CacheService');
        const cache = new CacheService();
        await cache.initialize();

        const q = 'What is cellular respiration?';
        const docIds = ['doc_bio_1'];
        const answer = 'Cellular respiration is the process of converting glucose into ATP.';

        await cache.setQA(q, docIds, answer);
        const cachedAnswer = cache.getQA(q, docIds);

        expect(cachedAnswer).toBe(answer);
        expect(cache.getStats().qaHits).toBe(1);
      });

      it('T1-R2-03: Disk persistence to gemini_cache.json rehydrates on restart', async () => {
        const tmpPath = path.resolve(__dirname, '../fixtures/tmp_cache_test.json');
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

        const { CacheService } = require('../../src/services/CacheService');
        const cache1 = new CacheService(tmpPath);
        await cache1.initialize();

        await cache1.setEmbedding('rehydration test', [0.1, 0.2, 0.3]);
        await cache1.flush();

        // Fresh instance reading same file
        const cache2 = new CacheService(tmpPath);
        await cache2.initialize();
        const hit = cache2.getEmbedding('rehydration test');

        expect(hit).toEqual([0.1, 0.2, 0.3]);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      });

      it('T1-R2-04: Cache statistics track hits, misses, and saved requests accurately', async () => {
        const { CacheService } = require('../../src/services/CacheService');
        const cache = new CacheService();
        await cache.initialize();

        cache.getEmbedding('missing text 1');
        cache.getEmbedding('missing text 2');
        await cache.setEmbedding('hit text', [1, 0]);
        cache.getEmbedding('hit text');

        const stats = cache.getStats();
        expect(stats.embeddingMisses).toBe(2);
        expect(stats.embeddingHits).toBe(1);
        expect(stats.totalRequestsSaved).toBe(1);
      });

      it('T1-R2-05: Hash keys are deterministic and ignore docId ordering', async () => {
        const { CacheService } = require('../../src/services/CacheService');
        const cache = new CacheService();
        await cache.initialize();

        await cache.setQA('Question', ['docA', 'docB'], 'Answer');
        const hit = cache.getQA('Question', ['docB', 'docA']);
        expect(hit).toBe('Answer');
      });
    });

    describe.runIf(hasSettingsRoute)('Feature R5: Discreet Settings Endpoints', () => {
      it('T1-R5-01: GET /api/settings/keys returns 200 with masked keys and telemetry', async () => {
        const res = await request(app).get('/api/settings/keys');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.keys)).toBe(true);
        expect(res.body.cacheStats).toBeDefined();
        expect(typeof res.body.activeKeyCount).toBe('number');
        expect(typeof res.body.totalKeyCount).toBe('number');
      });

      it('T1-R5-02: POST /api/settings/keys dynamically registers new valid key', async () => {
        const res = await request(app)
          .post('/api/settings/keys')
          .send({ key: 'AIzaSyDynamicSettingsKey12345' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.keyStatus).toBeDefined();
        expect(res.body.keyStatus.status).toBe('ACTIVE');
      });

      it('T1-R5-03: Cooldown status is visible via GET /api/settings/keys without UI alerts', async () => {
        const res = await request(app).get('/api/settings/keys');
        expect(res.status).toBe(200);
        for (const k of res.body.keys) {
          expect(['ACTIVE', 'COOLDOWN']).toContain(k.status);
        }
      });

      it('T1-R5-04: POST /api/settings/keys rejects blank or missing key with 400', async () => {
        const res = await request(app).post('/api/settings/keys').send({ key: '   ' });
        expect(res.status).toBe(400);
      });

      it('T1-R5-05: Settings response matches Project contract interface', async () => {
        const res = await request(app).get('/api/settings/keys');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('keys');
        expect(res.body).toHaveProperty('cacheStats');
        expect(res.body).toHaveProperty('activeKeyCount');
        expect(res.body).toHaveProperty('totalKeyCount');
      });
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 Test Cases Per Feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('R1 Boundary & Corner Cases', () => {
      it('T2-R1-01: Whitespace, trailing commas, and empty items are cleanly sanitized', () => {
        const km = new KeyManager(['  keyValidOne  ', '', '   ', 'keyValidTwo', 'your_key_here']);
        expect(km.getTotalKeyCount()).toBe(2);
      });

      it('T2-R1-02: Duplicate keys in configuration are automatically deduplicated', () => {
        const km = new KeyManager(['keyDuplicate', 'keyDuplicate', 'keyDuplicate']);
        expect(km.getTotalKeyCount()).toBe(1);
      });

      it('T2-R1-03: All keys in cooldown throws descriptive error without mock vector fallback', async () => {
        const km = new KeyManager(['keyA', 'keyB'], { cooldownDurationMs: 60000, enableRateLimiting: false });
        km.recordCooldown('keyA');
        km.recordCooldown('keyB');

        await expect(
          km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'hello'))
        ).rejects.toThrow(/cooldown/i);
      });

      it('T2-R1-04: Cascading failover cascades through multiple failing keys to reach healthy key', async () => {
        const keys = ['keyCascade1', 'keyCascade2', 'keyCascade3'];
        const km = new KeyManager(keys, { cooldownDurationMs: 60000, enableRateLimiting: false });

        mockProvider.simulate429On('keyCascade1');
        mockProvider.simulate429On('keyCascade2');

        const result = await km.executeWithFailover(async (k) => {
          return mockProvider.embedQuery(k, 'cascade text');
        });

        expect(result).toBeDefined();
        const statuses = km.getKeyStatuses();
        expect(statuses[0].status).toBe('COOLDOWN');
        expect(statuses[1].status).toBe('COOLDOWN');
        expect(statuses[2].status).toBe('ACTIVE');
        expect(statuses[2].totalRequests).toBe(1);
      });

      it('T2-R1-05: Cooldown expiration automatically restores key to ACTIVE status', async () => {
        const km = new KeyManager(['keyExpiring'], { cooldownDurationMs: 50, enableRateLimiting: false });
        km.recordCooldown('keyExpiring');

        expect(km.getActiveKeyCount()).toBe(0);
        await new Promise((r) => setTimeout(r, 70));

        expect(km.getActiveKeyCount()).toBe(1);
        expect(km.getKeyStatuses()[0].status).toBe('ACTIVE');
      });
    });

    describe('R4 Rate Limiter Boundary & Corner Cases', () => {
      it('T2-R4-01: Rapid-fire burst exceeding RPM is metered smoothly without crashing', async () => {
        let sleepInvocations = 0;
        const km = new KeyManager(['keyMetered'], {
          rpmPerKey: 5,
          enableRateLimiting: true,
          sleepFn: async () => {
            sleepInvocations++;
            (km as any).keys[0].tokens += 1;
          },
        });

        for (let i = 0; i < 7; i++) {
          await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, `item_${i}`));
        }

        expect(sleepInvocations).toBeGreaterThan(0);
        expect(mockProvider.getCalls().length).toBe(7);
      });

      it('T2-R4-02: Zero-key pool throws clean error when acquiring token', async () => {
        const km = new KeyManager(['your_key_here']);
        await expect(km.executeWithFailover(async () => {})).rejects.toThrow(/No Gemini API keys configured/i);
      });

      it('T2-R4-03: Rate limiter excludes cooled keys from available token scheduling', async () => {
        const km = new KeyManager(['keyLive', 'keyDead'], { rpmPerKey: 15, cooldownDurationMs: 50000 });
        km.recordCooldown('keyDead');

        // Available tokens should reflect only active keys
        const activeTokens = km.getTokens();
        expect(activeTokens).toBe(15); // 1 key active = 15 tokens
      });

      it('T2-R4-04: Dynamic key addition immediately boosts available token capacity', () => {
        const km = new KeyManager(['keyOne'], { rpmPerKey: 15 });
        expect(km.getTokens()).toBe(15);

        km.addKey('keyTwo');
        expect(km.getTokens()).toBe(30);
      });

      it('T2-R4-05: Rapid consecutive requests do not produce negative token counts', async () => {
        const km = new KeyManager(['keyNonNegative'], { rpmPerKey: 2, enableRateLimiting: false });
        for (let i = 0; i < 10; i++) {
          km.recordSuccess('keyNonNegative');
        }
        expect(km.getTokens('keyNonNegative')).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Rate Limit Error Matcher Boundary Tests', () => {
      it('T2-ERR-01: Recognizes numeric status 429', () => {
        expect(isRateLimitError({ status: 429 })).toBe(true);
        expect(isRateLimitError({ statusCode: 429 })).toBe(true);
        expect(isRateLimitError({ code: 429 })).toBe(true);
      });

      it('T2-ERR-02: Recognizes string ResourceExhausted codes', () => {
        expect(isRateLimitError({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
        expect(isRateLimitError({ code: 'RESOURCE_EXHAUSTED' })).toBe(true);
      });

      it('T2-ERR-03: Recognizes nested error structures', () => {
        expect(isRateLimitError({ error: { code: 429 } })).toBe(true);
        expect(isRateLimitError({ error: { status: 'RESOURCE_EXHAUSTED' } })).toBe(true);
      });

      it('T2-ERR-04: Recognizes plain text error messages with rate limit indicators', () => {
        expect(isRateLimitError(new Error('Quota exceeded for quota metric'))).toBe(true);
        expect(isRateLimitError('Too Many Requests on endpoint')).toBe(true);
      });

      it('T2-ERR-05: Returns false for generic non-rate-limit errors', () => {
        expect(isRateLimitError(new Error('SyntaxError: unexpected token'))).toBe(false);
        expect(isRateLimitError({ status: 500 })).toBe(false);
        expect(isRateLimitError(null)).toBe(false);
        expect(isRateLimitError(undefined)).toBe(false);
      });
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Coverage)
  // =========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('T3-COMB-01: R1 (Failover) + R4 (Rate Limiting): Throttled key-hopping executes transparently', async () => {
      const km = new KeyManager(['keyHopA', 'keyHopB'], {
        cooldownDurationMs: 60000,
        rpmPerKey: 15,
        enableRateLimiting: true,
      });

      // KeyHopA fails with 429
      mockProvider.simulate429On('keyHopA', true);

      const result = await km.executeWithFailover(async (k) => {
        return mockProvider.embedQuery(k, 'hop test');
      });

      expect(result).toBeDefined();
      expect(mockProvider.getCallsForKey('keyHopB').length).toBe(1);
      expect(km.getKeyStatuses()[0].status).toBe('COOLDOWN');
      expect(km.getKeyStatuses()[1].status).toBe('ACTIVE');
    });

    it('T3-COMB-02: R1 (Pooling) + Dynamic Key Addition: Throughput and round-robin expand in flight', async () => {
      const km = new KeyManager(['keyInitA', 'keyInitB'], { enableRateLimiting: false });

      // Request 1 uses keyInitA (pointer moves to index 1)
      await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'req1'));

      // Dynamically add third key (appended at index 2)
      km.addKey('keyInitC');

      // Request 2 uses keyInitB (pointer moves to index 2)
      await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'req2'));

      // Request 3 uses keyInitC (pointer moves to index 0)
      await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'req3'));

      expect(mockProvider.getCallsForKey('keyInitA').length).toBe(1);
      expect(mockProvider.getCallsForKey('keyInitB').length).toBe(1);
      expect(mockProvider.getCallsForKey('keyInitC').length).toBe(1);
    });

    it('T3-COMB-03: R1 (All-Cooling) + Dynamic Recovery: Adding key while all are cooling unblocks requests', async () => {
      const km = new KeyManager(['keyStuck1'], { cooldownDurationMs: 60000, enableRateLimiting: false });
      km.recordCooldown('keyStuck1');

      // Attempting request throws because pool is empty
      await expect(km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'fail'))).rejects.toThrow();

      // User adds key in settings
      km.addKey('keyRescue');

      // Request now immediately succeeds
      const res = await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'rescue'));
      expect(res).toBeDefined();
      expect(mockProvider.getCallsForKey('keyRescue').length).toBe(1);
    });

    it('T3-COMB-04: R1 (Failover) + Telemetry: 429 event updates failure count and sets remaining countdown', async () => {
      const km = new KeyManager(['keyTel1', 'keyTel2'], { cooldownDurationMs: 40000, enableRateLimiting: false });
      mockProvider.simulate429On('keyTel1', true);

      await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'telemetry check'));

      const s1 = km.getKeyStatuses().find((s) => s.maskedKey === maskApiKey('keyTel1'));
      expect(s1?.status).toBe('COOLDOWN');
      expect(s1?.failedRequests).toBe(1);
      expect(s1?.totalRequests).toBe(1);
      expect(s1?.cooldownRemainingMs).toBeGreaterThan(30000);
    });

    it('T3-COMB-05: R4 (Rate Limiter) + High Concurrency: 16 parallel requests paced cleanly across 2 keys', async () => {
      const km = new KeyManager(['keyConcA', 'keyConcB'], { rpmPerKey: 15, enableRateLimiting: true });

      const tasks = Array.from({ length: 16 }, (_, i) =>
        km.executeWithFailover(async (k) => mockProvider.embedQuery(k, `parallel_${i}`))
      );

      const results = await Promise.all(tasks);
      expect(results.length).toBe(16);

      const callsA = mockProvider.getCallsForKey('keyConcA').length;
      const callsB = mockProvider.getCallsForKey('keyConcB').length;

      expect(callsA + callsB).toBe(16);
      expect(Math.abs(callsA - callsB)).toBeLessThanOrEqual(2); // Balanced load
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    it('T4-SCEN-01: Multi-Document Ingestion with automatic 429 failover under heavy call load', async () => {
      const km = new KeyManager(['keyDocA', 'keyDocB', 'keyDocC'], {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
      });

      // Simulate 429 on KeyDocA midway through processing
      mockProvider.simulate429On('keyDocA', true);

      // Simulate chunk embedding batches across ingestion pipeline
      const chunks = Array.from({ length: 12 }, (_, i) => ({
        chunkId: `chunk_${i}`,
        text: `Text content for academic study chapter chunk ${i} with scientific terminology`,
      }));

      const batchResults = [];
      for (let i = 0; i < chunks.length; i += 4) {
        const slice = chunks.slice(i, i + 4);
        const res = await km.executeWithFailover(async (k) => {
          return mockProvider.embedChunks(k, slice);
        });
        batchResults.push(...res);
      }

      expect(batchResults.length).toBe(12);
      expect(km.getKeyStatuses().find((s) => s.maskedKey === maskApiKey('keyDocA'))?.status).toBe('COOLDOWN');
      expect(km.getKeyStatuses().find((s) => s.maskedKey === maskApiKey('keyDocB'))?.status).toBe('ACTIVE');
      expect(km.getKeyStatuses().find((s) => s.maskedKey === maskApiKey('keyDocC'))?.status).toBe('ACTIVE');
    });

    it('T4-SCEN-02: Rate-limited high-throughput burst paced smoothly across keys without dropping requests', async () => {
      const km = new KeyManager(['keyBurstPaced1', 'keyBurstPaced2'], {
        rpmPerKey: 15,
        enableRateLimiting: true,
      });

      const promises = Array.from({ length: 20 }, (_, i) =>
        km.executeWithFailover(async (k) => {
          return mockProvider.embedQuery(k, `rapid_search_query_${i}`);
        })
      );

      const resolved = await Promise.all(promises);
      expect(resolved.length).toBe(20);
      for (const vec of resolved) {
        expect(vec.length).toBe(768);
      }
    });

    it('T4-SCEN-03: Quota exhaustion and seamless recovery via dynamic key addition', async () => {
      const km = new KeyManager(['keyExhaustible'], { cooldownDurationMs: 60000, enableRateLimiting: false });

      // Hit quota limit on single key
      mockProvider.simulate429On('keyExhaustible', true);

      // In-flight call fails and key enters cooldown
      try {
        await km.executeWithFailover(async (k) => mockProvider.embedQuery(k, 'first request'));
      } catch (e) {
        // Expected pool failure
      }

      expect(km.getActiveKeyCount()).toBe(0);

      // User adds second key via Settings modal
      const addition = km.addKey('keyRecoveryToken');
      expect(addition.success).toBe(true);
      expect(km.getActiveKeyCount()).toBe(1);

      // Subsequent request completes immediately on new key
      const result = await km.executeWithFailover(async (k) => {
        return mockProvider.embedQuery(k, 'recovered request');
      });

      expect(result).toBeDefined();
      expect(mockProvider.getCallsForKey('keyRecoveryToken').length).toBe(1);
    });

    it('T4-SCEN-04: Resilience under intermittent key failures with zero mock vector pollution', async () => {
      const km = new KeyManager(['keyFlakyA', 'keySolidB'], {
        cooldownDurationMs: 60000,
        enableRateLimiting: false,
      });

      // KeyFlakyA fails twice
      mockProvider.simulate429On('keyFlakyA', true);

      const generatedVectors: number[][] = [];
      for (let i = 0; i < 6; i++) {
        const vec = await km.executeWithFailover(async (k) => {
          return mockProvider.embedQuery(k, `test_vector_${i}`);
        });
        generatedVectors.push(vec);
      }

      expect(generatedVectors.length).toBe(6);
      for (const vec of generatedVectors) {
        expect(vec.length).toBe(768);
        // Ensure vector is non-trivial normalized vector (not empty or mock hash)
        const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
        expect(magnitude).toBeCloseTo(1.0, 4);
      }
    });
  });

  // =========================================================================
  // TIER 4 (SERVICE LEVEL): ACTIVE SERVICE END-TO-END KEYMANAGER INTEGRATION
  // =========================================================================

  describe('Tier 4 (Service Level): Active Service End-to-End KeyManager Integration', () => {
    function createMockClientFactory(provider: ControlledGeminiProvider) {
      return (apiKey: string) => ({
        getGenerativeModel: ({ model, systemInstruction }: any) => ({
          batchEmbedContents: async ({ requests }: any) => {
            const chunks = requests.map((r: any, idx: number) => ({
              chunkId: `c_${idx}`,
              text: r.content.parts[0].text,
            }));
            const embeddings = await provider.embedChunks(apiKey, chunks);
            return { embeddings: embeddings.map((e) => ({ values: e.vector })) };
          },
          embedContent: async (text: string) => {
            const vector = await provider.embedQuery(apiKey, text);
            return { embedding: { values: vector } };
          },
          generateContent: async (prompt: string) => {
            const res = await provider.generateContent(apiKey, prompt);
            return {
              response: {
                text: () => res.text,
              },
            };
          },
        }),
      });
    }

    beforeEach(() => {
      cacheService.clear();
      mockProvider.reset();
      mockProvider.clearFailures();
    });

    afterEach(() => {
      embeddingService.setKeyManager(keyManager);
      llmService.setKeyManager(keyManager);
      embeddingService.setClientFactory(undefined as any);
      llmService.setClientFactory(undefined as any);
      sweepAllTempFilesSync(path.resolve(__dirname, '../../data'), 0);
    });

    it('T4-SVC-01: EmbeddingService.embedChunks increments KeyManager counters and triggers 429 failover to backup key', async () => {
      const keys = ['keyEmbedA_111', 'keyEmbedB_222'];
      const km = new KeyManager(keys, { cooldownDurationMs: 60000, enableRateLimiting: false });

      // Inject KeyManager and mock provider factory into EmbeddingService
      embeddingService.setKeyManager(km);
      embeddingService.setClientFactory(createMockClientFactory(mockProvider));

      // Simulate 429 on primary key
      mockProvider.simulate429On('keyEmbedA_111', true);

      const testChunks = [
        {
          chunkId: 'ch1',
          text: 'Quantum teleportation protocol analysis',
          metadata: { docId: 'doc1', filename: 'quant.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 40 },
        },
        {
          chunkId: 'ch2',
          text: 'Decoherence free subspaces in open quantum systems',
          metadata: { docId: 'doc1', filename: 'quant.txt', mimeType: 'text/plain', chunkIndex: 1, charStart: 41, charEnd: 91 },
        },
      ];

      const results = await embeddingService.embedChunks(testChunks as any);

      // Verify valid embedding output
      expect(results.length).toBe(2);
      expect(results[0].vector.length).toBe(768);
      expect(results[1].vector.length).toBe(768);

      // Verify provider calls: keyEmbedA attempted and failed, keyEmbedB succeeded
      expect(mockProvider.getCallsForKey('keyEmbedA_111').length).toBe(1);
      expect(mockProvider.getCallsForKey('keyEmbedB_222').length).toBe(1);

      // Verify KeyManager state & counters
      const statuses = km.getKeyStatuses();
      const statusA = statuses.find((s) => s.maskedKey === maskApiKey('keyEmbedA_111'));
      const statusB = statuses.find((s) => s.maskedKey === maskApiKey('keyEmbedB_222'));

      expect(statusA?.status).toBe('COOLDOWN');
      expect(statusA?.failedRequests).toBe(1);
      expect(statusA?.totalRequests).toBe(1);
      expect(statusA?.cooldownRemainingMs).toBeGreaterThan(50000);

      expect(statusB?.status).toBe('ACTIVE');
      expect(statusB?.totalRequests).toBe(1);
      expect(statusB?.failedRequests).toBe(0);
    });

    it('T4-SVC-02: EmbeddingService.embedQuery distributes across pool via round-robin and increments request counts', async () => {
      const keys = ['keyQueryAlpha', 'keyQueryBeta'];
      const km = new KeyManager(keys, { enableRateLimiting: false });

      embeddingService.setKeyManager(km);
      embeddingService.setClientFactory(createMockClientFactory(mockProvider));

      // Two distinct queries (bypassing cache)
      const vec1 = await embeddingService.embedQuery(`Query ${Date.now()}_A`);
      const vec2 = await embeddingService.embedQuery(`Query ${Date.now()}_B`);

      expect(vec1.length).toBe(768);
      expect(vec2.length).toBe(768);

      // Check round-robin distribution
      expect(mockProvider.getCallsForKey('keyQueryAlpha').length).toBe(1);
      expect(mockProvider.getCallsForKey('keyQueryBeta').length).toBe(1);

      const statuses = km.getKeyStatuses();
      expect(statuses[0].totalRequests).toBe(1);
      expect(statuses[1].totalRequests).toBe(1);
    });

    it('T4-SVC-03: LLMService.generateAnswer increments KeyManager counters and executes seamless 429 failover', async () => {
      const keys = ['keyLlmPrimary', 'keyLlmSecondary'];
      const km = new KeyManager(keys, { cooldownDurationMs: 60000, enableRateLimiting: false });

      llmService.setKeyManager(km);
      llmService.setClientFactory(createMockClientFactory(mockProvider));

      mockProvider.simulate429On('keyLlmPrimary', true);

      const contextChunks = [
        {
          chunkId: 'c1',
          text: 'The mitochondria generates ATP through oxidative phosphorylation.',
          score: 0.95,
          metadata: { docId: 'doc_cell', filename: 'bio.pdf', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 64 },
        },
      ];

      const response = await llmService.generateAnswer('How is ATP generated?', contextChunks as any);

      expect(response.answer).toBeDefined();
      expect(response.answer.length).toBeGreaterThan(0);

      // Verify key failover occurred
      const statuses = km.getKeyStatuses();
      const primaryStatus = statuses.find((s) => s.maskedKey === maskApiKey('keyLlmPrimary'));
      const secondaryStatus = statuses.find((s) => s.maskedKey === maskApiKey('keyLlmSecondary'));

      expect(primaryStatus?.status).toBe('COOLDOWN');
      expect(primaryStatus?.failedRequests).toBe(1);
      expect(primaryStatus?.totalRequests).toBe(1);

      expect(secondaryStatus?.status).toBe('ACTIVE');
      expect(secondaryStatus?.totalRequests).toBe(1);
      expect(secondaryStatus?.failedRequests).toBe(0);
    });

    it('T4-SVC-04: Full Q&A pipeline (Hybrid Search + LLM Answer) exercises end-to-end KeyManager telemetry', async () => {
      const keys = ['keyPipe1', 'keyPipe2', 'keyPipe3'];
      const km = new KeyManager(keys, { enableRateLimiting: false });

      embeddingService.setKeyManager(km);
      embeddingService.setClientFactory(createMockClientFactory(mockProvider));
      llmService.setKeyManager(km);
      llmService.setClientFactory(createMockClientFactory(mockProvider));

      // Call embedQuery (for search) followed by generateAnswer (for LLM)
      await embeddingService.embedQuery(`Pipeline Search ${Date.now()}`);
      await llmService.generateAnswer('Explain entropy', [
        {
          chunkId: 'c_entropy',
          text: 'Entropy is a measure of molecular disorder in thermodynamics.',
          score: 0.9,
          metadata: { docId: 'doc_phys', filename: 'physics.pdf', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 61 },
        },
      ] as any);

      const totalCalls = km.getKeyStatuses().reduce((sum, s) => sum + s.totalRequests, 0);
      expect(totalCalls).toBe(2);
    });

    it('T4-SVC-05: Quota exhaustion across all keys in EmbeddingService throws without mock vector corruption', async () => {
      const keys = ['keyExhaustedSolo'];
      const km = new KeyManager(keys, { cooldownDurationMs: 60000, enableRateLimiting: false });

      embeddingService.setKeyManager(km);
      embeddingService.setClientFactory(createMockClientFactory(mockProvider));

      mockProvider.simulate429On('keyExhaustedSolo', false); // Permanent 429

      await expect(
        embeddingService.embedChunks([
          {
            chunkId: 'fail_chunk',
            text: 'Should not create mock vector',
            metadata: { docId: 'd_fail', filename: 'fail.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 29 },
          } as any,
        ])
      ).rejects.toThrow(/cooldown|429|resource/i);

      // Verify key status
      expect(km.getKeyStatuses()[0].status).toBe('COOLDOWN');
      expect(km.getKeyStatuses()[0].failedRequests).toBe(1);

      // Verify cache was not corrupted
      expect(cacheService.getEmbedding('Should not create mock vector')).toBeNull();
    });
  });
});

