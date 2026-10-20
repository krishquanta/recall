import MiniSearch from 'minisearch';
import { Chunk, RankedChunk } from '../types';

export class KeywordIndex {
  private miniSearch: MiniSearch<Chunk>;
  private chunks: Map<string, Chunk> = new Map();

  constructor() {
    this.miniSearch = new MiniSearch<Chunk>({
      idField: 'chunkId',
      fields: ['text'],
      storeFields: ['chunkId', 'text', 'metadata'],
      searchOptions: {
        boost: { text: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  public addChunks(chunks: Chunk[]): void {
    const chunksToAdd: Chunk[] = [];
    for (const chunk of chunks) {
      if (this.chunks.has(chunk.chunkId)) {
        try {
          this.miniSearch.remove(chunk);
        } catch {
          // ignore
        }
      }
      this.chunks.set(chunk.chunkId, chunk);
      chunksToAdd.push(chunk);
    }
    if (chunksToAdd.length > 0) {
      this.miniSearch.addAll(chunksToAdd);
    }
  }

  public deleteByDocId(docId: string): void {
    const toRemove: Chunk[] = [];
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.metadata.docId === docId) {
        toRemove.push(chunk);
      }
    }
    for (const chunk of toRemove) {
      this.chunks.delete(chunk.chunkId);
      try {
        this.miniSearch.remove(chunk);
      } catch {
        // ignore
      }
    }
  }

  public search(query: string, docIds?: string[], topK = 10): RankedChunk[] {
    if (!query.trim() || this.chunks.size === 0) return [];

    const filterFn =
      docIds && docIds.length > 0
        ? (result: any) => {
            const chunk = this.chunks.get(result.id);
            return chunk ? docIds.includes(chunk.metadata.docId) : false;
          }
        : undefined;

    const results = this.miniSearch.search(query, {
      filter: filterFn,
    });

    if (results.length === 0) return [];

    const maxScore = results[0]?.score || 1;

    return results.slice(0, topK).map((res) => {
      const chunk = this.chunks.get(res.id) || (res as any);
      return {
        chunkId: res.id,
        text: chunk.text,
        metadata: chunk.metadata,
        score: maxScore > 0 ? Math.min(1, Math.max(0, res.score / maxScore)) : 0,
      };
    });
  }

  public getChunksByDocId(docId: string): Chunk[] {
    const list: Chunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.metadata.docId === docId) {
        list.push(chunk);
      }
    }
    return list.sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
  }

  public clear(): void {
    this.chunks.clear();
    this.miniSearch.removeAll();
  }
}

export const keywordIndex = new KeywordIndex();
