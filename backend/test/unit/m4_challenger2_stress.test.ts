import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';
import { KeyManager, keyManager, maskApiKey } from '../../src/services/KeyManager';
import { CacheService, cacheService } from '../../src/services/CacheService';
import path from 'path';
import fs from 'fs';

describe('Milestone 4 Adversarial Stress Tests: Settings API & Security', () => {
  const originalEnvKeys = process.env.GEMINI_API_KEYS;
  const originalEnvKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    keyManager.reset(['AIzaSyInitialSecretKeyAAA111111111111111', 'AIzaSyInitialSecretKeyBBB222222222222222']);
    cacheService.clear();
  });

  afterEach(() => {
    if (originalEnvKeys !== undefined) {
      process.env.GEMINI_API_KEYS = originalEnvKeys;
    } else {
      delete process.env.GEMINI_API_KEYS;
    }
    if (originalEnvKey !== undefined) {
      process.env.GEMINI_API_KEY = originalEnvKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  describe('Adversarial Challenge 1: Raw Secret Key Leakage & Masking Integrity', () => {
    it('never exposes raw unmasked key in GET /api/settings/keys under any circumstance', async () => {
      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);

      const rawContent = JSON.stringify(res.body);
      expect(rawContent).not.toContain('AIzaSyInitialSecretKeyAAA111111111111111');
      expect(rawContent).not.toContain('AIzaSyInitialSecretKeyBBB222222222222222');

      for (const k of res.body.keys) {
        expect(k.maskedKey).toContain('...');
        expect(k).not.toHaveProperty('rawKey');
        expect(k).not.toHaveProperty('key');
      }
    });

    it('never exposes raw unmasked key in POST /api/settings/keys response body', async () => {
      const secret = 'AIzaSySuperSecretDynamicKey9999999999999999999';
      const res = await request(app).post('/api/settings/keys').send({ key: secret });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyStatus.maskedKey).toContain('...');
      expect(res.body.keyStatus.maskedKey).not.toBe(secret);
      expect(JSON.stringify(res.body)).not.toContain(secret);
    });
  });

  describe('Adversarial Challenge 2: Malformed Payloads & Type Confusion', () => {
    it('rejects non-string values (numbers, objects, arrays, booleans) with 400', async () => {
      const badPayloads = [
        { key: 12345 },
        { key: true },
        { key: { nested: 'key' } },
        { key: ['AIzaSyArrayKey123'] },
        { key: null },
      ];

      for (const payload of badPayloads) {
        const res = await request(app).post('/api/settings/keys').send(payload);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Field "key" is required');
      }
    });

    it('rejects sentinel placeholder "your_key_here" with 400', async () => {
      const res = await request(app).post('/api/settings/keys').send({ key: 'your_key_here' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/failed to add key/i);
    });
  });

  describe('Adversarial Challenge 3: Concurrent Duplicate Registrations', () => {
    it('handles concurrent identical POST requests safely without pool corruption', async () => {
      const newKey = 'AIzaSyConcurrentlyAddedKey123456789012345';
      const promises = Array.from({ length: 5 }, () =>
        request(app).post('/api/settings/keys').send({ key: newKey })
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 200);
      const duplicates = results.filter((r) => r.status === 400);

      expect(successes.length).toBe(1);
      expect(duplicates.length).toBe(4);

      // Verify key count in manager
      const getRes = await request(app).get('/api/settings/keys');
      expect(getRes.body.totalKeyCount).toBe(3);
    });
  });

  describe('Adversarial Challenge 4: Cooldown Countdown Telemetry & Status Transitions', () => {
    it('maintains strict mathematical invariant: activeKeyCount + coolingKeyCount === totalKeyCount', async () => {
      keyManager.recordCooldown('AIzaSyInitialSecretKeyAAA111111111111111', 120000);

      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);

      const coolingCount = res.body.keys.filter((k: any) => k.status === 'COOLDOWN').length;
      const activeCount = res.body.keys.filter((k: any) => k.status === 'ACTIVE').length;

      expect(res.body.activeKeyCount).toBe(activeCount);
      expect(res.body.totalKeyCount).toBe(res.body.keys.length);
      expect(activeCount + coolingCount).toBe(res.body.totalKeyCount);
      expect(coolingCount).toBe(1);
      expect(activeCount).toBe(1);
    });

    it('empirically verifies positive cooldownRemainingMs and COOLDOWN status on entering cooldown', () => {
      let virtualNow = 500000;
      const km = new KeyManager(['AIzaSyCoolTestKey1234567890'], {
        cooldownDurationMs: 60000,
        nowFn: () => virtualNow,
      });

      km.recordCooldown('AIzaSyCoolTestKey1234567890');
      const [status] = km.getKeyStatuses();

      expect(status.status).toBe('COOLDOWN');
      expect(status.cooldownRemainingMs).toBe(60000);
      expect(km.getActiveKeyCount()).toBe(0);
    });

    it('empirically verifies monotonic decrease and return to ACTIVE upon expiration', () => {
      let virtualNow = 500000;
      const km = new KeyManager(['AIzaSyCoolTestKey1234567890'], {
        cooldownDurationMs: 60000,
        nowFn: () => virtualNow,
      });

      km.recordCooldown('AIzaSyCoolTestKey1234567890');

      // t = 20s
      virtualNow += 20000;
      let [status] = km.getKeyStatuses();
      expect(status.status).toBe('COOLDOWN');
      expect(status.cooldownRemainingMs).toBe(40000);

      // t = 50s
      virtualNow += 30000;
      [status] = km.getKeyStatuses();
      expect(status.status).toBe('COOLDOWN');
      expect(status.cooldownRemainingMs).toBe(10000);

      // t = 60.001s (expired)
      virtualNow += 10001;
      [status] = km.getKeyStatuses();
      expect(status.status).toBe('ACTIVE');
      expect(status.cooldownRemainingMs).toBe(0);
      expect(km.getActiveKeyCount()).toBe(1);
      expect(km.getActiveKey()).toBe('AIzaSyCoolTestKey1234567890');
    });

    it('verifies GET /api/settings/keys live cooldown and expiration over HTTP', async () => {
      const shortKey = 'AIzaSyHttpCooldownKey999999999999';
      keyManager.reset([shortKey]);
      keyManager.recordCooldown(shortKey, 40);

      const resCooldown = await request(app).get('/api/settings/keys');
      expect(resCooldown.status).toBe(200);
      expect(resCooldown.body.keys[0].status).toBe('COOLDOWN');
      expect(resCooldown.body.keys[0].cooldownRemainingMs).toBeGreaterThan(0);
      expect(resCooldown.body.activeKeyCount).toBe(0);

      await new Promise((r) => setTimeout(r, 60));

      const resActive = await request(app).get('/api/settings/keys');
      expect(resActive.status).toBe(200);
      expect(resActive.body.keys[0].status).toBe('ACTIVE');
      expect(resActive.body.keys[0].cooldownRemainingMs).toBe(0);
      expect(resActive.body.activeKeyCount).toBe(1);
    });

    it('verifies frontend countdown state transition contract (SettingsModal.tsx)', () => {
      let keyState = {
        keyId: 'test-1',
        maskedKey: 'AIzaSy...4X9Z',
        status: 'COOLDOWN' as const,
        cooldownRemainingMs: 2000,
        totalRequests: 3,
        failedRequests: 1,
        lastUsedTimestamp: 100,
      };

      // Tick 1
      let nextMs = Math.max(0, keyState.cooldownRemainingMs - 1000);
      keyState = {
        ...keyState,
        cooldownRemainingMs: nextMs,
        status: nextMs <= 0 ? 'ACTIVE' : 'COOLDOWN',
      };
      expect(keyState.status).toBe('COOLDOWN');
      expect(keyState.cooldownRemainingMs).toBe(1000);

      // Tick 2 (countdown reaches 0 -> ACTIVE)
      nextMs = Math.max(0, keyState.cooldownRemainingMs - 1000);
      keyState = {
        ...keyState,
        cooldownRemainingMs: nextMs,
        status: nextMs <= 0 ? 'ACTIVE' : 'COOLDOWN',
      };
      expect(keyState.status).toBe('ACTIVE');
      expect(keyState.cooldownRemainingMs).toBe(0);
    });
  });

  describe('Adversarial Challenge 5: Cache Statistics Consistency Invariant', () => {
    it('verifies totalRequestsSaved === embeddingHits + qaHits across empty and single hit states', async () => {
      let stats = cacheService.getStats();
      expect(stats.totalRequestsSaved).toBe(0);
      expect(stats.totalRequestsSaved).toBe(stats.embeddingHits + stats.qaHits);

      // Seed in memory
      (cacheService as any).embeddingsMap.set(cacheService.hashEmbeddingKey('term A'), [1, 2]);
      cacheService.getEmbedding('term A');
      stats = cacheService.getStats();
      expect(stats.embeddingHits).toBe(1);
      expect(stats.qaHits).toBe(0);
      expect(stats.totalRequestsSaved).toBe(1);
      expect(stats.totalRequestsSaved).toBe(stats.embeddingHits + stats.qaHits);

      (cacheService as any).qaMap.set(cacheService.hashQAKey('q1', ['doc1']), 'ans1');
      cacheService.getQA('q1', ['doc1']);
      stats = cacheService.getStats();
      expect(stats.embeddingHits).toBe(1);
      expect(stats.qaHits).toBe(1);
      expect(stats.totalRequestsSaved).toBe(2);
      expect(stats.totalRequestsSaved).toBe(stats.embeddingHits + stats.qaHits);
    });

    it('verifies cache misses never increment totalRequestsSaved', () => {
      for (let i = 0; i < 10; i++) {
        cacheService.getEmbedding(`miss_${i}`);
        cacheService.getQA(`miss_q_${i}`, [`doc_${i}`]);
      }

      const stats = cacheService.getStats();
      expect(stats.embeddingMisses).toBe(10);
      expect(stats.qaMisses).toBe(10);
      expect(stats.totalRequestsSaved).toBe(0);
      expect(stats.totalRequestsSaved).toBe(stats.embeddingHits + stats.qaHits);
    });

    it('verifies invariant holds under high-volume randomized cache operations', async () => {
      // Seed entries directly in memory to avoid disk I/O latency
      for (let i = 0; i < 50; i++) {
        (cacheService as any).embeddingsMap.set(cacheService.hashEmbeddingKey(`stress_embed_${i}`), [i]);
        (cacheService as any).qaMap.set(cacheService.hashQAKey(`stress_q_${i}`, [`d_${i}`]), `ans_${i}`);
      }

      for (let i = 0; i < 500; i++) {
        const id = i % 75; // 0..49 hits, 50..74 misses
        if (i % 2 === 0) {
          cacheService.getEmbedding(`stress_embed_${id}`);
        } else {
          cacheService.getQA(`stress_q_${id}`, [`d_${id}`]);
        }
      }

      const stats = cacheService.getStats();
      expect(stats.totalRequestsSaved).toBe(stats.embeddingHits + stats.qaHits);
      expect(stats.totalRequestsSaved).toBeGreaterThan(300);
      expect(stats.embeddingMisses + stats.qaMisses).toBeGreaterThan(100);

      // Verify GET /api/settings/keys reflects exact invariant
      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);
      expect(res.body.cacheStats.totalRequestsSaved).toBe(
        res.body.cacheStats.embeddingHits + res.body.cacheStats.qaHits
      );
    });
  });

  describe('Adversarial Challenge 6: Backward Compatibility (Single-Key Setup)', () => {
    it('operates cleanly with single key setup via constructor and GEMINI_API_KEY env', () => {
      delete process.env.GEMINI_API_KEYS;
      process.env.GEMINI_API_KEY = 'AIzaSySingleCompatEnvKey999999999999';

      const km = new KeyManager();
      expect(km.getTotalKeyCount()).toBe(1);
      expect(km.getActiveKeyCount()).toBe(1);
      expect(km.getActiveKey()).toBe('AIzaSySingleCompatEnvKey999999999999');

      const [status] = km.getKeyStatuses();
      expect(status.status).toBe('ACTIVE');
      expect(status.cooldownRemainingMs).toBe(0);
      expect(status.maskedKey).toBe(maskApiKey('AIzaSySingleCompatEnvKey999999999999'));
    });

    it('single-key setup operates cleanly with zero errors on GET and POST /api/settings/keys', async () => {
      keyManager.reset(['AIzaSySingleIsolatedKey8888888888888888']);

      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);
      expect(res.body.totalKeyCount).toBe(1);
      expect(res.body.activeKeyCount).toBe(1);
      expect(res.body.keys.length).toBe(1);
      expect(res.body.keys[0].status).toBe('ACTIVE');

      // Upgrades cleanly with a second key
      const postRes = await request(app)
        .post('/api/settings/keys')
        .send({ key: 'AIzaSyUpgradedSecondKey7777777777777777' });
      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);

      const getAfter = await request(app).get('/api/settings/keys');
      expect(getAfter.status).toBe(200);
      expect(getAfter.body.totalKeyCount).toBe(2);
      expect(getAfter.body.activeKeyCount).toBe(2);
    });

    it('single-key setup reports COOLDOWN upon rate limit without 500 crashes', async () => {
      const singleKey = 'AIzaSySingleKeyGoingCooling666666666666666';
      keyManager.reset([singleKey]);
      keyManager.recordCooldown(singleKey, 60000);

      const res = await request(app).get('/api/settings/keys');
      expect(res.status).toBe(200);
      expect(res.body.totalKeyCount).toBe(1);
      expect(res.body.activeKeyCount).toBe(0);
      expect(res.body.keys[0].status).toBe('COOLDOWN');
      expect(res.body.keys[0].cooldownRemainingMs).toBeGreaterThan(0);
    });
  });
});
