import { v4 as uuidv4 } from 'uuid';

export interface KeyStatus {
  keyId: string;
  maskedKey: string;
  status: 'ACTIVE' | 'COOLDOWN';
  cooldownRemainingMs: number;
  totalRequests: number;
  failedRequests: number;
  lastUsedTimestamp: number | null;
}

export interface KeyManagerOptions {
  rpmPerKey?: number; // default 15
  cooldownDurationMs?: number; // default 60000
  enableRateLimiting?: boolean; // default true
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

interface KeyEntry {
  id: string;
  rawKey: string;
  maskedKey: string;
  cooldownUntil: number; // timestamp in ms; 0 if not cooling
  totalRequests: number;
  failedRequests: number;
  lastUsedTimestamp: number | null;
  // Token bucket state
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

/**
 * Masks an API key for safe display (e.g. AIzaSy...4X9Z).
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 6) {
    return '***';
  }
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

/**
 * Determines whether an error is a 429 rate limit or quota exhaustion error.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (obj.status === 429 || obj.statusCode === 429) return true;
    if (obj.status === 'RESOURCE_EXHAUSTED' || obj.statusText === 'Too Many Requests') return true;
    if (obj.code === 429 || obj.code === 'RESOURCE_EXHAUSTED') return true;
    if (obj.error && typeof obj.error === 'object') {
      const inner = obj.error as Record<string, unknown>;
      if (inner.code === 429 || inner.status === 'RESOURCE_EXHAUSTED') return true;
    }
  }
  const str = String((err as any)?.message || (err as any)?.statusText || err || '');
  const lower = str.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resourceexhausted') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit') ||
    lower.includes('quota')
  );
}

export class KeyManager {
  private keys: KeyEntry[] = [];
  private currentIndex: number = 0;
  private options: Required<KeyManagerOptions>;

  constructor(initialKeys?: string[], options?: KeyManagerOptions) {
    this.options = {
      rpmPerKey: options?.rpmPerKey ?? 15,
      cooldownDurationMs: options?.cooldownDurationMs ?? 60000,
      enableRateLimiting: options?.enableRateLimiting ?? true,
      sleepFn: options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
      nowFn: options?.nowFn ?? (() => Date.now()),
    };

    if (initialKeys && initialKeys.length > 0) {
      this.initFromList(initialKeys);
    } else {
      this.loadFromEnv();
    }
  }

  private now(): number {
    return this.options.nowFn();
  }

  private initFromList(keyList: string[]): void {
    const seen = new Set<string>();
    for (const raw of keyList) {
      if (!raw || typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed || trimmed === 'your_key_here' || seen.has(trimmed)) continue;
      seen.add(trimmed);
      this.addKeyEntry(trimmed);
    }
  }

  private loadFromEnv(): void {
    const multiEnv = process.env.GEMINI_API_KEYS;
    if (multiEnv && multiEnv.trim()) {
      const parsed = multiEnv.split(',').map((k) => k.trim());
      this.initFromList(parsed);
      return;
    }

    const singleEnv = process.env.GEMINI_API_KEY;
    if (singleEnv && singleEnv.trim() && singleEnv.trim() !== 'your_key_here') {
      this.initFromList([singleEnv.trim()]);
    }
  }

  private addKeyEntry(rawKey: string): string {
    const id = uuidv4();
    const capacity = this.options.rpmPerKey;
    const refillRate = capacity / 60; // 0.25 tokens/s for 15 RPM

    this.keys.push({
      id,
      rawKey,
      maskedKey: maskApiKey(rawKey),
      cooldownUntil: 0,
      totalRequests: 0,
      failedRequests: 0,
      lastUsedTimestamp: null,
      tokens: capacity,
      lastRefill: this.now(),
      capacity,
      refillRate,
    });
    return id;
  }

  private refillTokens(entry: KeyEntry): void {
    const now = this.now();
    const elapsedSec = (now - entry.lastRefill) / 1000;
    if (elapsedSec > 0) {
      entry.tokens = Math.min(entry.capacity, entry.tokens + elapsedSec * entry.refillRate);
      entry.lastRefill = now;
    }
  }

  /**
   * Returns the next active key via round-robin.
   * Throws if no keys configured or if all keys are currently in cooldown.
   */
  public getActiveKey(): string {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys configured');
    }

    const now = this.now();
    const activeEntries = this.keys.filter((k) => k.cooldownUntil <= now);
    if (activeEntries.length === 0) {
      const minCooldown = Math.min(...this.keys.map((k) => Math.max(0, k.cooldownUntil - now)));
      throw new Error(`All Gemini API keys are currently in cooldown. Earliest available in ${minCooldown}ms`);
    }

    const startIndex = this.currentIndex % this.keys.length;
    let selectedEntry: KeyEntry | null = null;

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (startIndex + i) % this.keys.length;
      const entry = this.keys[idx];
      if (entry.cooldownUntil <= now) {
        selectedEntry = entry;
        this.currentIndex = (idx + 1) % this.keys.length;
        break;
      }
    }

    if (!selectedEntry) {
      selectedEntry = activeEntries[0];
      const idx = this.keys.indexOf(selectedEntry);
      if (idx !== -1) {
        this.currentIndex = (idx + 1) % this.keys.length;
      }
    }

    selectedEntry.lastUsedTimestamp = now;
    return selectedEntry.rawKey;
  }

  /**
   * Records a successful request for a key.
   */
  public recordSuccess(key: string): void {
    const entry = this.keys.find((k) => k.rawKey === key || k.id === key);
    if (entry) {
      entry.totalRequests++;
      entry.lastUsedTimestamp = this.now();
    }
  }

  /**
   * Records a failed request (non-rate limit) for a key.
   */
  public recordFailure(key: string): void {
    const entry = this.keys.find((k) => k.rawKey === key || k.id === key);
    if (entry) {
      entry.totalRequests++;
      entry.failedRequests++;
      entry.lastUsedTimestamp = this.now();
    }
  }

  /**
   * Places a key into cooldown (default 60 seconds).
   */
  public recordCooldown(key: string, cooldownDurationMs?: number): void {
    const duration = cooldownDurationMs ?? this.options.cooldownDurationMs;
    const entry = this.keys.find((k) => k.rawKey === key || k.id === key);
    if (entry) {
      entry.totalRequests++;
      entry.failedRequests++;
      entry.cooldownUntil = this.now() + duration;
      entry.lastUsedTimestamp = this.now();
    }
  }

  /**
   * Proactive token-bucket rate limiter.
   * Acquires a token from an active key, waiting if necessary.
   */
  public async acquireToken(): Promise<void> {
    if (!this.options.enableRateLimiting || this.keys.length === 0) {
      return;
    }

    while (true) {
      const now = this.now();
      const activeEntries = this.keys.filter((k) => k.cooldownUntil <= now);
      if (activeEntries.length === 0) {
        const minWait = Math.min(...this.keys.map((k) => Math.max(0, k.cooldownUntil - now)));
        if (minWait > 0) {
          await this.options.sleepFn(minWait);
          continue;
        }
      }

      for (const entry of activeEntries) {
        this.refillTokens(entry);
      }

      // Check if any active key has >= 1 token
      const startIndex = this.currentIndex % this.keys.length;
      let chosenEntry: KeyEntry | null = null;

      for (let i = 0; i < this.keys.length; i++) {
        const idx = (startIndex + i) % this.keys.length;
        const candidate = this.keys[idx];
        if (candidate.cooldownUntil <= now && candidate.tokens >= 1) {
          chosenEntry = candidate;
          break;
        }
      }

      if (chosenEntry) {
        chosenEntry.tokens -= 1;
        return;
      }

      // Compute minimum wait time until at least one active key has 1 token
      let minWaitMs = Infinity;
      for (const entry of activeEntries) {
        const needed = 1 - entry.tokens;
        const waitSec = needed / entry.refillRate;
        const waitMs = Math.ceil(waitSec * 1000);
        if (waitMs < minWaitMs) {
          minWaitMs = waitMs;
        }
      }

      if (minWaitMs === Infinity || minWaitMs <= 0) {
        minWaitMs = 50;
      }

      await this.options.sleepFn(minWaitMs);
    }
  }

  /**
   * Executes an operation with automatic failover across active keys on 429/ResourceExhausted.
   */
  public async executeWithFailover<T>(operation: (key: string) => Promise<T>): Promise<T> {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys configured');
    }

    const attemptedKeys = new Set<string>();

    while (true) {
      const now = this.now();
      const candidateKeys = this.keys.filter(
        (k) => k.cooldownUntil <= now && !attemptedKeys.has(k.rawKey)
      );

      if (candidateKeys.length === 0) {
        const allInCooldown = this.keys.every((k) => k.cooldownUntil > now);
        if (allInCooldown) {
          throw new Error('All Gemini API keys are currently in cooldown');
        }
        throw new Error('All available Gemini API keys have been attempted and failed');
      }

      if (this.options.enableRateLimiting) {
        await this.acquireToken();
      }

      // Pick round-robin candidate
      let selectedEntry: KeyEntry | null = null;
      const startIndex = this.currentIndex % this.keys.length;

      for (let i = 0; i < this.keys.length; i++) {
        const idx = (startIndex + i) % this.keys.length;
        const entry = this.keys[idx];
        if (candidateKeys.some((c) => c.id === entry.id)) {
          selectedEntry = entry;
          this.currentIndex = (idx + 1) % this.keys.length;
          break;
        }
      }

      if (!selectedEntry) {
        selectedEntry = candidateKeys[0];
        const idx = this.keys.indexOf(selectedEntry);
        if (idx !== -1) {
          this.currentIndex = (idx + 1) % this.keys.length;
        }
      }

      const currentKey = selectedEntry.rawKey;
      attemptedKeys.add(currentKey);

      try {
        const result = await operation(currentKey);
        this.recordSuccess(currentKey);
        return result;
      } catch (err: any) {
        if (isRateLimitError(err)) {
          this.recordCooldown(currentKey, this.options.cooldownDurationMs);
          // Immediately retry with the next available key
          continue;
        } else {
          this.recordFailure(currentKey);
          throw err;
        }
      }
    }
  }

  /**
   * Dynamically adds a new key to the pool.
   */
  public addKey(newKey: string): { success: boolean; keyId: string } {
    if (!newKey || typeof newKey !== 'string') {
      return { success: false, keyId: '' };
    }
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === 'your_key_here') {
      return { success: false, keyId: '' };
    }

    const existing = this.keys.find((k) => k.rawKey === trimmed);
    if (existing) {
      return { success: false, keyId: existing.id };
    }

    const keyId = this.addKeyEntry(trimmed);
    return { success: true, keyId };
  }

  /**
   * Returns the statuses of all keys in the pool.
   */
  public getKeyStatuses(): KeyStatus[] {
    const now = this.now();
    return this.keys.map((entry) => {
      const isCooling = entry.cooldownUntil > now;
      const cooldownRemainingMs = isCooling ? Math.max(0, entry.cooldownUntil - now) : 0;
      return {
        keyId: entry.id,
        maskedKey: entry.maskedKey,
        status: isCooling ? ('COOLDOWN' as const) : ('ACTIVE' as const),
        cooldownRemainingMs,
        totalRequests: entry.totalRequests,
        failedRequests: entry.failedRequests,
        lastUsedTimestamp: entry.lastUsedTimestamp,
      };
    });
  }

  public getActiveKeyCount(): number {
    const now = this.now();
    return this.keys.filter((k) => k.cooldownUntil <= now).length;
  }

  public getTotalKeyCount(): number {
    return this.keys.length;
  }

  public getTokens(key?: string): number {
    if (key) {
      const entry = this.keys.find((k) => k.rawKey === key || k.id === key);
      if (!entry) return 0;
      this.refillTokens(entry);
      return entry.tokens;
    }
    const now = this.now();
    return this.keys
      .filter((k) => k.cooldownUntil <= now)
      .reduce((sum, entry) => {
        this.refillTokens(entry);
        return sum + entry.tokens;
      }, 0);
  }

  public reset(newKeys?: string[]): void {
    this.keys = [];
    this.currentIndex = 0;
    if (newKeys) {
      this.initFromList(newKeys);
    } else {
      this.loadFromEnv();
    }
  }
}

export const keyManager = new KeyManager();
