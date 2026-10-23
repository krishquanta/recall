import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KeyManager, maskApiKey, isRateLimitError } from '../../src/services/KeyManager';

describe('KeyManager Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Key Configuration & Backward Compatibility', () => {
    it('should initialize with a single GEMINI_API_KEY for 100% backward compatibility', () => {
      process.env.GEMINI_API_KEY = 'AIzaSyLegacySingleKey1234X9Z';
      const km = new KeyManager();

      expect(km.getTotalKeyCount()).toBe(1);
      expect(km.getActiveKeyCount()).toBe(1);
      expect(km.getActiveKey()).toBe('AIzaSyLegacySingleKey1234X9Z');

      const statuses = km.getKeyStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].maskedKey).toBe('AIzaSy...4X9Z');
      expect(statuses[0].status).toBe('ACTIVE');
      expect(statuses[0].cooldownRemainingMs).toBe(0);
    });

    it('should parse comma-separated GEMINI_API_KEYS and trim whitespace', () => {
      process.env.GEMINI_API_KEYS = ' key-alpha , key-beta,   key-gamma  ';
      const km = new KeyManager();

      expect(km.getTotalKeyCount()).toBe(3);
      expect(km.getActiveKeyCount()).toBe(3);

      const keysRetrieved = [km.getActiveKey(), km.getActiveKey(), km.getActiveKey()];
      expect(keysRetrieved).toEqual(['key-alpha', 'key-beta', 'key-gamma']);
    });

    it('should ignore placeholder keys like your_key_here and empty tokens', () => {
      process.env.GEMINI_API_KEYS = 'your_key_here,  , key-valid, your_key_here ';
      const km = new KeyManager();

      expect(km.getTotalKeyCount()).toBe(1);
      expect(km.getActiveKey()).toBe('key-valid');
    });

    it('should prefer GEMINI_API_KEYS over GEMINI_API_KEY when both are set', () => {
      process.env.GEMINI_API_KEYS = 'key-multi-1, key-multi-2';
      process.env.GEMINI_API_KEY = 'key-legacy-fallback';
      const km = new KeyManager();

      expect(km.getTotalKeyCount()).toBe(2);
      expect(km.getActiveKey()).toBe('key-multi-1');
    });

    it('should accept initialKeys in constructor, overriding environment variables', () => {
      process.env.GEMINI_API_KEYS = 'env-key-1, env-key-2';
      const km = new KeyManager(['init-key-1', 'init-key-2', 'init-key-3']);

      expect(km.getTotalKeyCount()).toBe(3);
      expect(km.getActiveKey()).toBe('init-key-1');
    });

    it('should de-duplicate identical keys on initialization', () => {
      const km = new KeyManager(['duplicate-key', 'duplicate-key', 'unique-key']);
      expect(km.getTotalKeyCount()).toBe(2);
    });

    it('should throw an informative error if no keys are configured', () => {
      const km = new KeyManager([]);
      expect(() => km.getActiveKey()).toThrow(/No Gemini API keys configured/i);
    });
  });

  describe('Round-Robin Load Balancing', () => {
    it('should distribute requests evenly across all active keys in round-robin sequence', () => {
      const km = new KeyManager(['key-1', 'key-2', 'key-3']);

      const sequence = [];
      for (let i = 0; i < 9; i++) {
        sequence.push(km.getActiveKey());
      }

      expect(sequence).toEqual([
        'key-1',
        'key-2',
        'key-3',
        'key-1',
        'key-2',
        'key-3',
        'key-1',
        'key-2',
        'key-3',
      ]);
    });

    it('should skip keys currently in cooldown and resume round-robin among active ones', () => {
      const km = new KeyManager(['key-1', 'key-2', 'key-3']);

      // Put key-2 into cooldown
      km.recordCooldown('key-2', 60000);

      const sequence = [];
      for (let i = 0; i < 6; i++) {
        sequence.push(km.getActiveKey());
      }

      // key-2 must be skipped completely
      expect(sequence).toEqual(['key-1', 'key-3', 'key-1', 'key-3', 'key-1', 'key-3']);
      expect(sequence).not.toContain('key-2');
    });

    it('should throw when all keys are in cooldown', () => {
      const km = new KeyManager(['key-1', 'key-2']);
      km.recordCooldown('key-1', 60000);
      km.recordCooldown('key-2', 60000);

      expect(() => km.getActiveKey()).toThrow(/All Gemini API keys are currently in cooldown/i);
    });
  });

  describe('Dynamic Key Addition (addKey)', () => {
    it('should dynamically add a new key and return success with unique keyId', () => {
      const km = new KeyManager(['initial-key']);
      expect(km.getTotalKeyCount()).toBe(1);

      const result = km.addKey('AIzaSyDynamicAddedKey9999');
      expect(result.success).toBe(true);
      expect(result.keyId).toBeDefined();
      expect(typeof result.keyId).toBe('string');
      expect(km.getTotalKeyCount()).toBe(2);

      // Verify the new key is immediately part of round-robin rotation
      expect(km.getActiveKey()).toBe('initial-key');
      expect(km.getActiveKey()).toBe('AIzaSyDynamicAddedKey9999');
    });

    it('should reject duplicate keys gracefully', () => {
      const km = new KeyManager(['key-exists']);
      const result = km.addKey('key-exists');

      expect(result.success).toBe(false);
      expect(result.keyId).toBeDefined();
      expect(km.getTotalKeyCount()).toBe(1);
    });

    it('should reject empty or placeholder keys', () => {
      const km = new KeyManager(['key-exists']);
      expect(km.addKey('')).toEqual({ success: false, keyId: '' });
      expect(km.addKey('   ')).toEqual({ success: false, keyId: '' });
      expect(km.addKey('your_key_here')).toEqual({ success: false, keyId: '' });
      expect(km.getTotalKeyCount()).toBe(1);
    });
  });

  describe('Key Status Telemetry (getKeyStatuses)', () => {
    it('should report comprehensive status including maskedKey, cooldown, and request stats', () => {
      const km = new KeyManager(['AIzaSyProductionKey12345678904X9Z']);
      const [initial] = km.getKeyStatuses();

      expect(initial.maskedKey).toBe('AIzaSy...4X9Z');
      expect(initial.status).toBe('ACTIVE');
      expect(initial.cooldownRemainingMs).toBe(0);
      expect(initial.totalRequests).toBe(0);
      expect(initial.failedRequests).toBe(0);
      expect(initial.lastUsedTimestamp).toBeNull();

      // Record a success
      km.recordSuccess('AIzaSyProductionKey12345678904X9Z');
      const [afterSuccess] = km.getKeyStatuses();
      expect(afterSuccess.totalRequests).toBe(1);
      expect(afterSuccess.failedRequests).toBe(0);
      expect(afterSuccess.lastUsedTimestamp).not.toBeNull();

      // Record a cooldown
      km.recordCooldown('AIzaSyProductionKey12345678904X9Z', 30000);
      const [afterCooldown] = km.getKeyStatuses();
      expect(afterCooldown.status).toBe('COOLDOWN');
      expect(afterCooldown.cooldownRemainingMs).toBeGreaterThan(0);
      expect(afterCooldown.totalRequests).toBe(2);
      expect(afterCooldown.failedRequests).toBe(1);
    });

    it('should accurately mask various key lengths', () => {
      expect(maskApiKey('AIzaSy1234567894X9Z')).toBe('AIzaSy...4X9Z');
      expect(maskApiKey('12345')).toBe('***');
      expect(maskApiKey('12345678')).toBe('123...78');
      expect(maskApiKey('')).toBe('');
    });
  });

  describe('Automatic 429 Failover (executeWithFailover)', () => {
    it('should execute operation and return result on healthy key', async () => {
      const km = new KeyManager(['healthy-key']);
      const result = await km.executeWithFailover(async (key) => {
        return `response-using-${key}`;
      });

      expect(result).toBe('response-using-healthy-key');
      const [status] = km.getKeyStatuses();
      expect(status.totalRequests).toBe(1);
      expect(status.failedRequests).toBe(0);
      expect(status.status).toBe('ACTIVE');
    });

    it('should catch 429 error, place key into 60s cooldown, and immediately retry on next healthy key', async () => {
      const km = new KeyManager(['failing-key', 'healthy-key']);
      const executedKeys: string[] = [];

      const result = await km.executeWithFailover(async (key) => {
        executedKeys.push(key);
        if (key === 'failing-key') {
          const err: any = new Error('429 Too Many Requests: Resource has been exhausted');
          err.status = 429;
          throw err;
        }
        return `success-with-${key}`;
      });

      expect(executedKeys).toEqual(['failing-key', 'healthy-key']);
      expect(result).toBe('success-with-healthy-key');

      const statuses = km.getKeyStatuses();
      const failingStatus = statuses[0];
      const healthyStatus = statuses[1];

      expect(failingStatus.status).toBe('COOLDOWN');
      expect(failingStatus.cooldownRemainingMs).toBeGreaterThan(50000);
      expect(failingStatus.failedRequests).toBe(1);

      expect(healthyStatus?.status).toBe('ACTIVE');
      expect(healthyStatus?.cooldownRemainingMs).toBe(0);
      expect(healthyStatus?.totalRequests).toBe(1);
      expect(healthyStatus?.failedRequests).toBe(0);
    });

    it('should handle RESOURCE_EXHAUSTED and rate limit phrases as failover triggers', async () => {
      const testCases = [
        'RESOURCE_EXHAUSTED',
        'ResourceExhausted: quota exceeded',
        'rate limit exceeded for project',
        'quota exceeded for metric Queries per minute',
      ];

      for (const errorPhrase of testCases) {
        const km = new KeyManager(['key-a', 'key-b']);
        let attempts = 0;

        const result = await km.executeWithFailover(async (key) => {
          attempts++;
          if (attempts === 1) {
            throw new Error(errorPhrase);
          }
          return `recovered-with-${key}`;
        });

        expect(result).toBe('recovered-with-key-b');
        expect(km.getKeyStatuses()[0].status).toBe('COOLDOWN');
      }
    });

    it('should throw an error when all keys in the pool fail with 429', async () => {
      const km = new KeyManager(['key-1', 'key-2']);

      await expect(
        km.executeWithFailover(async (key) => {
          const err: any = new Error('429 Rate Limit');
          err.status = 429;
          throw err;
        })
      ).rejects.toThrow(/All Gemini API keys are currently in cooldown/i);

      const statuses = km.getKeyStatuses();
      expect(statuses.every((s) => s.status === 'COOLDOWN')).toBe(true);
    });

    it('should not mark cooldown or retry across keys on non-rate-limit errors (e.g. 400 Bad Request)', async () => {
      const km = new KeyManager(['key-1', 'key-2']);
      let callCount = 0;

      await expect(
        km.executeWithFailover(async (key) => {
          callCount++;
          throw new Error('400 Bad Request: prompt contains invalid argument');
        })
      ).rejects.toThrow(/400 Bad Request/i);

      // Must fail immediately without retrying on key-2
      expect(callCount).toBe(1);

      const statuses = km.getKeyStatuses();
      // Neither key should be placed into cooldown
      expect(statuses[0].status).toBe('ACTIVE');
      expect(statuses[1].status).toBe('ACTIVE');
      expect(statuses[0].failedRequests).toBe(1);
    });
  });

  describe('Cooldown Expiration & Automatic Restoration', () => {
    it('should automatically restore key to ACTIVE status once cooldown duration passes', async () => {
      // Create KeyManager with short 50ms cooldown duration
      const km = new KeyManager(['key-short-cooldown'], { cooldownDurationMs: 50 });

      km.recordCooldown('key-short-cooldown', 50);
      expect(km.getKeyStatuses()[0].status).toBe('COOLDOWN');
      expect(() => km.getActiveKey()).toThrow(/All Gemini API keys are currently in cooldown/i);

      // Wait 60ms for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(km.getKeyStatuses()[0].status).toBe('ACTIVE');
      expect(km.getKeyStatuses()[0].cooldownRemainingMs).toBe(0);
      expect(km.getActiveKey()).toBe('key-short-cooldown');
    });
  });

  describe('Adaptive Token-Bucket Rate Limiter', () => {
    it('should initialize token bucket with 15 tokens per key by default', () => {
      const km = new KeyManager(['key-1']);
      expect(km.getTokens('key-1')).toBe(15);
      expect(km.getTokens()).toBe(15);
    });

    it('should scale throughput proportionally as keys are added (N * 15 capacity)', () => {
      const km = new KeyManager(['key-1', 'key-2']);
      expect(km.getTokens()).toBe(30);

      km.addKey('key-3');
      expect(km.getTokens()).toBe(45);
    });

    it('should allow instant burst consumption up to bucket capacity without waiting', async () => {
      const km = new KeyManager(['burst-key'], { rpmPerKey: 15 });

      // Acquire 15 tokens rapidly
      for (let i = 0; i < 15; i++) {
        await km.acquireToken();
      }

      // Tokens should now be depleted (< 1)
      expect(km.getTokens('burst-key')).toBeLessThan(1);
    });

    it('should wait and replenish tokens when bucket is depleted', async () => {
      let virtualNow = 1_000_000;
      let sleptMs = 0;
      const customSleep = async (ms: number) => {
        sleptMs += ms;
        virtualNow += ms;
      };
      const nowFn = () => virtualNow;

      // 60 RPM = 1 token/sec refill
      const km = new KeyManager(['test-refill-key'], {
        rpmPerKey: 60,
        sleepFn: customSleep,
        nowFn,
      });

      // Deplete all 60 tokens
      for (let i = 0; i < 60; i++) {
        await km.acquireToken();
      }

      // Next token acquisition should trigger sleep to wait for replenishment
      await km.acquireToken();
      expect(sleptMs).toBeGreaterThan(0);
      expect(km.getTokens('test-refill-key')).toBeLessThan(1);
    });
  });

  describe('isRateLimitError Helper', () => {
    it('should correctly identify various rate limit error representations', () => {
      expect(isRateLimitError({ status: 429 })).toBe(true);
      expect(isRateLimitError({ statusCode: 429 })).toBe(true);
      expect(isRateLimitError({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
      expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRateLimitError(new Error('ResourceExhausted: quota limit reached'))).toBe(true);
      expect(isRateLimitError('Error: rate limit exceeded')).toBe(true);
      expect(isRateLimitError(new Error('Syntax error'))).toBe(false);
      expect(isRateLimitError(new Error('404 Not Found'))).toBe(false);
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });
  });
});
