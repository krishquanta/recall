import { GoogleGenerativeAI } from '@google/generative-ai';
import { Chunk, EmbeddedChunk } from '../types';

export class EmbeddingService {
  private genAI: GoogleGenerativeAI | null = null;
  private readonly vectorDim = 768;

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() && apiKey !== 'your_key_here') {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      }
    }
  }

  private getGenAI(): GoogleGenerativeAI | null {
    if (process.env.NODE_ENV === 'test') {
      return null;
    }
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() && apiKey !== 'your_key_here') {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      }
    }
    return this.genAI;
  }

  /**
   * Generates a deterministic 768-dim normalized pseudo-semantic vector from text.
   * Uses hashing of character trigrams and word tokens to simulate term overlap and semantic distribution.
   */
  public generateMockEmbedding(text: string): number[] {
    const vector = new Array(this.vectorDim).fill(0);
    const cleaned = text.toLowerCase().trim();
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
        hash = ((hash << 5) + hash) + trigram.charCodeAt(j);
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

  public async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) return [];

    const genAI = this.getGenAI();
    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';

    if (!genAI) {
      return chunks.map((c) => ({
        chunkId: c.chunkId,
        vector: this.generateMockEmbedding(c.text),
      }));
    }

    const results: EmbeddedChunk[] = [];
    const batchSize = 100; // Gemini API max batch size

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const response = await model.batchEmbedContents({
          requests: batch.map((c) => ({
            content: { role: 'user', parts: [{ text: c.text.slice(0, 8000) }] },
          })),
        });

        if (response.embeddings && response.embeddings.length === batch.length) {
          for (let j = 0; j < batch.length; j++) {
            results.push({
              chunkId: batch[j].chunkId,
              vector: response.embeddings[j].values,
            });
          }
        } else {
          // Fallback for this batch if response format is unexpected
          for (const c of batch) {
            results.push({
              chunkId: c.chunkId,
              vector: this.generateMockEmbedding(c.text),
            });
          }
        }
      } catch (err: any) {
        console.warn(`Gemini batch embedding error, falling back to mock vectors:`, err?.message || err);
        for (const c of batch) {
          results.push({
            chunkId: c.chunkId,
            vector: this.generateMockEmbedding(c.text),
          });
        }
      }
    }

    return results;
  }

  public async embedQuery(query: string): Promise<number[]> {
    if (!query.trim()) {
      return new Array(this.vectorDim).fill(0);
    }

    const genAI = this.getGenAI();
    const modelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';

    if (!genAI) {
      return this.generateMockEmbedding(query);
    }

    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const response = await model.embedContent(query.slice(0, 8000));
      if (response.embedding?.values) {
        return response.embedding.values;
      }
    } catch (err: any) {
      console.warn(`Gemini query embedding error, falling back to mock vector:`, err?.message || err);
    }

    return this.generateMockEmbedding(query);
  }
}

export const embeddingService = new EmbeddingService();
