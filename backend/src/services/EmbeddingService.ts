import { GoogleGenerativeAI } from '@google/generative-ai';
import { Chunk, EmbeddedChunk } from '../types';
import { cacheService } from './CacheService';
import { keyManager, KeyManager } from './KeyManager';

export class EmbeddingService {
  private readonly vectorDim = 768;
  private genAICache = new Map<string, GoogleGenerativeAI>();
  private keyMgr: KeyManager;
  private clientFactory?: (apiKey: string) => any;

  constructor(
    km: KeyManager = keyManager,
    genAIFactory?: (apiKey: string) => any
  ) {
    this.keyMgr = km;
    this.clientFactory = genAIFactory;
  }

  public setKeyManager(km: KeyManager): void {
    this.keyMgr = km;
  }

  public setClientFactory(factory: (apiKey: string) => any): void {
    this.clientFactory = factory;
    this.genAICache.clear();
  }

  /**
   * Retrieves or creates a GoogleGenerativeAI instance for a given API key.
   */
  private getGenAI(apiKey: string): any {
    if (this.clientFactory) {
      return this.clientFactory(apiKey);
    }
    let instance = this.genAICache.get(apiKey);
    if (!instance) {
      instance = new GoogleGenerativeAI(apiKey);
      this.genAICache.set(apiKey, instance);
    }
    return instance;
  }

  /**
   * Returns true if no Gemini API keys are configured in the pool or environment.
   * When true, operates in offline/mock mode using deterministic pseudo-semantic vectors.
   */
  public isMockMode(): boolean {
    if (process.env.NODE_ENV === 'test' && !this.clientFactory) {
      return true;
    }
    if (this.keyMgr.getTotalKeyCount() === 0) {
      const single = process.env.GEMINI_API_KEY;
      const multi = process.env.GEMINI_API_KEYS;
      if (
        (single && single.trim() && single.trim() !== 'your_key_here') ||
        (multi && multi.trim())
      ) {
        this.keyMgr.reset();
      }
    }
    return this.keyMgr.getTotalKeyCount() === 0;
  }

  /**
   * Generates a deterministic 768-dim normalized pseudo-semantic vector from text.
   * Uses hashing of character trigrams and word tokens to simulate term overlap and semantic distribution.
   */
  public generateMockEmbedding(text: string): number[] {
    const vector = new Array(this.vectorDim).fill(0);
    const cleaned = (text || '').toLowerCase().trim();
    if (!cleaned) {
      vector[0] = 1;
      return vector;
    }

    // Hash word tokens
    const words = cleaned.split(/\W+/).filter(Boolean);
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash << 5) - hash + word.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.vectorDim;
      const sign = (hash & 1) === 0 ? 1 : -1;
      vector[idx] += sign * (1 + Math.min(5, word.length * 0.2));
    }

    // Hash character trigrams for subword/typo tolerance
    for (let i = 0; i < cleaned.length - 2; i++) {
      const trigram = cleaned.slice(i, i + 3);
      let hash = 5381;
      for (let j = 0; j < 3; j++) {
        hash = (hash << 5) + hash + trigram.charCodeAt(j);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.vectorDim;
      const sign = (hash & 1) === 0 ? 0.5 : -0.5;
      vector[idx] += sign;
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < this.vectorDim; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.vectorDim; i++) {
        vector[i] /= norm;
      }
    } else {
      vector[0] = 1;
    }

    return vector;
  }

  /**
   * Embeds a batch of raw texts with two-tier cache lookup and KeyManager auto-failover.
   * Automatically groups up to 100 texts per Gemini API call.
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const results: Array<number[] | null> = new Array(texts.length).fill(null);
    const textToIndices = new Map<string, number[]>();

    // 1. Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const cached = cacheService.getEmbedding(text);
      if (cached) {
        results[i] = cached;
      } else {
        const list = textToIndices.get(text) || [];
        list.push(i);
        textToIndices.set(text, list);
      }
    }

    if (textToIndices.size === 0) {
      return results as number[][];
    }

    const uniqueMissingTexts = Array.from(textToIndices.keys());
    const newEntriesToCache: Array<{ text: string; vector: number[] }> = [];

    // 2. Offline / Mock mode (only when zero keys configured)
    if (this.isMockMode()) {
      for (const text of uniqueMissingTexts) {
        const vector = this.generateMockEmbedding(text);
        newEntriesToCache.push({ text, vector });
        const indices = textToIndices.get(text)!;
        for (const idx of indices) {
          results[idx] = vector;
        }
      }
      await cacheService.setEmbeddingBatch(newEntriesToCache);
      return results as number[][];
    }

    // 3. Process missing texts in batches of up to 100 via KeyManager failover
    const batchSize = 100;
    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';

    for (let i = 0; i < uniqueMissingTexts.length; i += batchSize) {
      const batchTexts = uniqueMissingTexts.slice(i, i + batchSize);

      const response = await this.keyMgr.executeWithFailover(async (apiKey) => {
        const genAI = this.getGenAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        return await model.batchEmbedContents({
          requests: batchTexts.map((text) => ({
            content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] },
          })),
        });
      });

      if (response && response.embeddings && response.embeddings.length === batchTexts.length) {
        for (let j = 0; j < batchTexts.length; j++) {
          const text = batchTexts[j];
          const vector = response.embeddings[j].values;
          newEntriesToCache.push({ text, vector });
          const indices = textToIndices.get(text)!;
          for (const idx of indices) {
            results[idx] = vector;
          }
        }
      } else {
        throw new Error(
          `Unexpected Gemini batch embedding response: expected ${batchTexts.length} embeddings, received ${
            response?.embeddings?.length ?? 0
          }`
        );
      }
    }

    if (newEntriesToCache.length > 0) {
      await cacheService.setEmbeddingBatch(newEntriesToCache);
    }

    return results as number[][];
  }

  /**
   * Embeds chunks with two-tier cache lookup and KeyManager auto-failover.
   * Maps chunks to texts, calls embedBatch, and preserves chunkId association.
   */
  public async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    if (!chunks || chunks.length === 0) return [];

    const texts = chunks.map((c) => c.text);
    const vectors = await this.embedBatch(texts);

    return chunks.map((c, idx) => ({
      chunkId: c.chunkId,
      vector: vectors[idx],
    }));
  }

  /**
   * Embeds a single query string with two-tier cache lookup and KeyManager auto-failover.
   */
  public async embedQuery(query: string): Promise<number[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      return new Array(this.vectorDim).fill(0);
    }

    const cached = cacheService.getEmbedding(trimmed);
    if (cached) {
      return cached;
    }

    if (this.isMockMode()) {
      const vector = this.generateMockEmbedding(trimmed);
      await cacheService.setEmbedding(trimmed, vector);
      return vector;
    }

    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';
    const vector = await this.keyMgr.executeWithFailover(async (apiKey) => {
      const genAI = this.getGenAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.embedContent(trimmed.slice(0, 8000));
      if (!response.embedding?.values) {
        throw new Error('Gemini embedContent returned response without embedding values');
      }
      return response.embedding.values;
    });

    await cacheService.setEmbedding(trimmed, vector);
    return vector;
  }
}

export const embeddingService = new EmbeddingService();
