import { Chunk, RankedChunk } from '../types';
import { embeddingService } from './EmbeddingService';
import { vectorStore } from '../store/VectorStore';
import { keywordIndex } from '../store/KeywordIndex';

export class SearchService {
  /**
   * Executes a hybrid search combining vector semantic similarity and BM25 full-text search.
   * @param query The search query string
   * @param docIds Optional document IDs to filter by (empty means all documents)
   * @param topK Number of top results to return (default: 8)
   * @param alpha Balance factor: 1.0 = pure vector, 0.0 = pure BM25, 0.6 = default hybrid
   */
  public async hybridSearch(
    query: string,
    docIds?: string[],
    topK = 8,
    alpha = 0.6
  ): Promise<RankedChunk[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const candidateLimit = Math.max(topK * 3, 20);

    // 1. Vector Search
    let vectorResults: RankedChunk[] = [];
    try {
      const queryVector = await embeddingService.embedQuery(trimmed);
      vectorResults = vectorStore.query(queryVector, candidateLimit, docIds);
    } catch (err) {
      console.warn(`Vector search error:`, err);
    }

    // 2. BM25 Keyword Search
    let keywordResults: RankedChunk[] = [];
    try {
      keywordResults = keywordIndex.search(trimmed, docIds, candidateLimit);
    } catch (err) {
      console.warn(`Keyword search error:`, err);
    }

    // 3. Score Fusion
    const mergedMap = new Map<
      string,
      {
        chunk: Chunk;
        vectorScore: number;
        bm25Score: number;
      }
    >();

    for (const vRes of vectorResults) {
      mergedMap.set(vRes.chunkId, {
        chunk: {
          chunkId: vRes.chunkId,
          text: vRes.text,
          metadata: vRes.metadata,
        },
        vectorScore: vRes.score,
        bm25Score: 0,
      });
    }

    for (const kRes of keywordResults) {
      const existing = mergedMap.get(kRes.chunkId);
      if (existing) {
        existing.bm25Score = kRes.score;
      } else {
        mergedMap.set(kRes.chunkId, {
          chunk: {
            chunkId: kRes.chunkId,
            text: kRes.text,
            metadata: kRes.metadata,
          },
          vectorScore: 0,
          bm25Score: kRes.score,
        });
      }
    }

    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const ranked: RankedChunk[] = [];

    for (const entry of mergedMap.values()) {
      const combinedScore =
        clampedAlpha * entry.vectorScore + (1 - clampedAlpha) * entry.bm25Score;

      ranked.push({
        chunkId: entry.chunk.chunkId,
        text: entry.chunk.text,
        metadata: entry.chunk.metadata,
        score: Number(combinedScore.toFixed(4)),
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, topK);
  }
}

export const searchService = new SearchService();
