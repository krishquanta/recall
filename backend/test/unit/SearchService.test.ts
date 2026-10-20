import { describe, it, expect, beforeEach } from 'vitest';
import { vectorStore } from '../../src/store/VectorStore';
import { keywordIndex } from '../../src/store/KeywordIndex';
import { searchService } from '../../src/services/SearchService';
import { embeddingService } from '../../src/services/EmbeddingService';
import { Chunk } from '../../src/types';

describe('Search and Indexing', () => {
  const testChunks: Chunk[] = [
    {
      chunkId: 'doc-clt-0',
      text: 'The central limit theorem states that the sample mean converges to a normal distribution.',
      metadata: {
        docId: 'doc-clt',
        filename: 'stats.pdf',
        mimeType: 'application/pdf',
        chunkIndex: 0,
        page: 1,
        charStart: 0,
        charEnd: 90,
      },
    },
    {
      chunkId: 'doc-ml-0',
      text: 'Convolutional neural networks are specifically effective for image classification tasks.',
      metadata: {
        docId: 'doc-ml',
        filename: 'ml.md',
        mimeType: 'text/markdown',
        chunkIndex: 0,
        lineStart: 1,
        charStart: 0,
        charEnd: 88,
      },
    },
  ];

  beforeEach(async () => {
    vectorStore.clear();
    keywordIndex.clear();

    const embedded = await embeddingService.embedChunks(testChunks);
    await vectorStore.upsertBatch(
      testChunks.map((c, i) => ({
        chunkId: c.chunkId,
        text: c.text,
        metadata: c.metadata,
        vector: embedded[i].vector,
      }))
    );
    keywordIndex.addChunks(testChunks);
  });

  it('BM25 Keyword search finds relevant chunks', () => {
    const results = keywordIndex.search('normal distribution');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('doc-clt-0');
  });

  it('Vector similarity search ranks semantic queries', async () => {
    const queryVector = await embeddingService.embedQuery('What is the central limit theorem?');
    const results = vectorStore.query(queryVector, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('doc-clt-0');
  });

  it('Hybrid search returns fused rankings and respects doc filtering', async () => {
    const results = await searchService.hybridSearch('neural networks image', undefined, 5, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('doc-ml-0');
    expect(results[0].score).toBeGreaterThan(0);

    // Test docIds filter
    const filtered = await searchService.hybridSearch('neural networks', ['doc-clt'], 5);
    expect(filtered.every((c) => c.metadata.docId === 'doc-clt')).toBe(true);
    expect(filtered.some((c) => c.metadata.docId === 'doc-ml')).toBe(false);
  });
});
