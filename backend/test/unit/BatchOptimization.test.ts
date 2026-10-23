import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Chunk, ExtractedGraphPayload, ValidatedEntity, EvidenceRef } from '../../src/types';
import { partitionChunksIntoWindows, estimateTokens, extractAndStoreGraphForChunks } from '../../src/routes/graph';
import { graphExtractionService } from '../../src/services/GraphExtractionService';
import { ProvenanceValidator } from '../../src/services/ProvenanceValidator';
import { DeduplicationService } from '../../src/services/DeduplicationService';
import { GraphStore, graphStore } from '../../src/store/GraphStore';
import { ReviewStore, reviewStore } from '../../src/store/ReviewStore';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { cacheService } from '../../src/services/CacheService';

describe('Milestone 3: Request Batching & Call Reduction Unit Tests', () => {
  const testDir = path.join(process.cwd(), 'test-data-batch-opt');
  const graphPath = path.join(testDir, 'graph.json');
  const reviewPath = path.join(testDir, 'review_queue.json');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    graphStore.clear();
    reviewStore.clear();
    graphExtractionService.resetCallCount();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(graphPath)) fs.unlinkSync(graphPath);
      if (fs.existsSync(reviewPath)) fs.unlinkSync(reviewPath);
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // 1. Multi-Chunk Window Partitioning
  // =========================================================================

  describe('Multi-Chunk Window Partitioning (R3)', () => {
    it('estimates tokens accurately using word counts (~1.3 tokens per word)', () => {
      const text100Words = new Array(100).fill('academic').join(' ');
      const estimated = estimateTokens(text100Words);
      expect(estimated).toBe(130);
      expect(estimateTokens('')).toBe(0);
    });

    it('combines 4 adjacent 500-token chunks into a single 2,000-token window (75% call reduction)', () => {
      const chunks: Chunk[] = Array.from({ length: 4 }, (_, i) => ({
        chunkId: `doc-1-chunk-${i}`,
        text: `Section ${i}: ${new Array(380).fill(`word${i}`).join(' ')}. Key concept ${i} is defined.`,
        metadata: {
          docId: 'doc-1',
          filename: 'doc1.txt',
          mimeType: 'text/plain',
          chunkIndex: i,
          charStart: i * 2000,
          charEnd: (i + 1) * 2000,
        },
      }));

      const windows = partitionChunksIntoWindows(chunks, 2000, 2, 4);

      // All 4 chunks grouped into 1 window
      expect(windows.length).toBe(1);
      expect(windows[0].length).toBe(4);
      expect(windows[0][0].chunkId).toBe('doc-1-chunk-0');
      expect(windows[0][3].chunkId).toBe('doc-1-chunk-3');

      // 4 chunks -> 1 extraction call = 75% reduction
      const individualCalls = chunks.length;
      const windowedCalls = windows.length;
      const reduction = (individualCalls - windowedCalls) / individualCalls;
      expect(reduction).toBe(0.75);
    });

    it('partitions 8 chunks into 2 windows of 4 chunks each (75% call reduction)', () => {
      const chunks: Chunk[] = Array.from({ length: 8 }, (_, i) => ({
        chunkId: `doc-math-${i}`,
        text: `Mathematical chunk ${i} describing algebraic structures and theorems. ${new Array(300).fill('term').join(' ')}`,
        metadata: {
          docId: 'doc-math',
          filename: 'math.txt',
          mimeType: 'text/plain',
          chunkIndex: i,
          charStart: i * 1500,
          charEnd: (i + 1) * 1500,
        },
      }));

      const windows = partitionChunksIntoWindows(chunks, 2000, 2, 4);

      expect(windows.length).toBe(2);
      expect(windows[0].length).toBe(4);
      expect(windows[1].length).toBe(4);

      // 8 calls reduced to 2 calls = 75% reduction
      const reduction = (8 - 2) / 8;
      expect(reduction).toBe(0.75);
    });

    it('groups 3 chunks into 1 window and 2 chunks into 1 window (60-67% call reduction)', () => {
      const chunks3: Chunk[] = Array.from({ length: 3 }, (_, i) => ({
        chunkId: `doc-3-${i}`,
        text: `Content for chunk ${i} with moderate length. ${new Array(200).fill('data').join(' ')}`,
        metadata: { docId: 'doc-3', filename: 'f.txt', mimeType: 'text/plain', chunkIndex: i, charStart: 0, charEnd: 100 },
      }));

      const windows3 = partitionChunksIntoWindows(chunks3, 2000, 2, 4);
      expect(windows3.length).toBe(1);
      expect(windows3[0].length).toBe(3);
      expect((3 - 1) / 3).toBeCloseTo(0.667, 2);

      const chunks2: Chunk[] = chunks3.slice(0, 2);
      const windows2 = partitionChunksIntoWindows(chunks2, 2000, 2, 4);
      expect(windows2.length).toBe(1);
      expect(windows2[0].length).toBe(2);
      expect((2 - 1) / 2).toBe(0.5);
    });

    it('respects document boundaries and separates chunks from different documents', () => {
      const chunks: Chunk[] = [
        {
          chunkId: 'docA-0',
          text: 'Document A chunk 0 discussing linear algebra concepts.',
          metadata: { docId: 'docA', filename: 'docA.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 54 },
        },
        {
          chunkId: 'docA-1',
          text: 'Document A chunk 1 discussing matrix operations.',
          metadata: { docId: 'docA', filename: 'docA.txt', mimeType: 'text/plain', chunkIndex: 1, charStart: 0, charEnd: 48 },
        },
        {
          chunkId: 'docB-0',
          text: 'Document B chunk 0 discussing machine learning gradient descent.',
          metadata: { docId: 'docB', filename: 'docB.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 64 },
        },
      ];

      const windows = partitionChunksIntoWindows(chunks, 2000, 2, 4);
      expect(windows.length).toBe(2);
      expect(windows[0].map((c) => c.chunkId)).toEqual(['docA-0', 'docA-1']);
      expect(windows[1].map((c) => c.chunkId)).toEqual(['docB-0']);
    });
  });

  // =========================================================================
  // 2. Multi-Chunk Window Extraction & Strict Verbatim Provenance Anchoring
  // =========================================================================

  describe('Multi-Chunk Extraction & Verbatim Provenance Anchoring (R3)', () => {
    it('extractWindow processes multiple chunks in 1 call, reducing extraction calls by 75%', async () => {
      const chunks: Chunk[] = Array.from({ length: 4 }, (_, i) => ({
        chunkId: `c-${i}`,
        text: `Linear Algebra chapter ${i} describes mathematical structures and matrix algorithms.`,
        metadata: { docId: 'doc-test', filename: 'test.txt', mimeType: 'text/plain', chunkIndex: i, charStart: 0, charEnd: 100 },
      }));

      graphExtractionService.resetCallCount();

      // Calling extractWindow on the 4-chunk window
      const result = await graphExtractionService.extractWindow(chunks);
      expect(result).toBeDefined();
      expect(graphExtractionService.getExtractionCallCount()).toBe(1);

      // Verify call reduction against individual extraction
      const unbatchedCalls = 4;
      const batchedCalls = graphExtractionService.getExtractionCallCount();
      const reductionRate = (unbatchedCalls - batchedCalls) / unbatchedCalls;
      expect(reductionRate).toBe(0.75); // 75% reduction!
    });

    it('preserves exact verbatim quote anchoring to individual source chunks in a multi-chunk window', () => {
      const chunk0: Chunk = {
        chunkId: 'window-chunk-0',
        text: 'Singular Value Decomposition (SVD) is a factorization of a real or complex matrix that generalizes eigendecomposition.',
        metadata: {
          docId: 'doc-window',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 0,
          page: 1,
          lineStart: 5,
          charStart: 0,
          charEnd: 118,
        },
      };

      const chunk1: Chunk = {
        chunkId: 'window-chunk-1',
        text: 'Principal Component Analysis (PCA) uses Singular Value Decomposition to compute the principal components of data.',
        metadata: {
          docId: 'doc-window',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 1,
          page: 2,
          lineStart: 12,
          charStart: 119,
          charEnd: 232,
        },
      };

      const chunk2: Chunk = {
        chunkId: 'window-chunk-2',
        text: 'Gradient Descent is an optimization algorithm used to minimize empirical risk in machine learning.',
        metadata: {
          docId: 'doc-window',
          filename: 'algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: 2,
          page: 3,
          lineStart: 25,
          charStart: 233,
          charEnd: 331,
        },
      };

      const windowChunks = [chunk0, chunk1, chunk2];

      const rawPayload: ExtractedGraphPayload = {
        entities: [
          {
            name: 'Singular Value Decomposition',
            type: 'Concept',
            aliases: ['SVD'],
            mentionQuote: 'Singular Value Decomposition (SVD) is a factorization of a real or complex matrix that generalizes eigendecomposition.',
          },
          {
            name: 'Principal Component Analysis',
            type: 'Method',
            aliases: ['PCA'],
            mentionQuote: 'Principal Component Analysis (PCA) uses Singular Value Decomposition to compute the principal components of data.',
          },
          {
            name: 'Gradient Descent',
            type: 'Method',
            aliases: [],
            mentionQuote: 'Gradient Descent is an optimization algorithm used to minimize empirical risk in machine learning.',
          },
        ],
        claims: [
          {
            subjectEntityName: 'Singular Value Decomposition',
            claimText: 'SVD generalizes eigendecomposition.',
            modality: 'Fact',
            confidence: 0.95,
            exactQuote: 'Singular Value Decomposition (SVD) is a factorization of a real or complex matrix that generalizes eigendecomposition.',
          },
          {
            subjectEntityName: 'Gradient Descent',
            claimText: 'Gradient Descent is an optimization algorithm.',
            modality: 'Fact',
            confidence: 0.9,
            exactQuote: 'Gradient Descent is an optimization algorithm used to minimize empirical risk in machine learning.',
          },
        ],
        relationships: [
          {
            sourceEntityName: 'Principal Component Analysis',
            targetEntityName: 'Singular Value Decomposition',
            relationType: 'USES',
            description: 'PCA uses SVD to compute principal components',
            confidence: 0.92,
            exactQuote: 'Principal Component Analysis (PCA) uses Singular Value Decomposition to compute the principal components of data.',
          },
        ],
      };

      const validated = ProvenanceValidator.validateAndAnchorWindow(windowChunks, rawPayload);

      // Verify entity anchoring to specific chunks
      const entSVD = validated.entities.find((e) => e.name === 'Singular Value Decomposition');
      expect(entSVD).toBeDefined();
      expect(entSVD?.evidence.chunkId).toBe('window-chunk-0');
      expect(entSVD?.evidence.page).toBe(1);
      expect(entSVD?.evidence.lineStart).toBe(5);
      expect(chunk0.text.substring(entSVD!.evidence.charOffset!.start, entSVD!.evidence.charOffset!.end)).toBe(
        entSVD?.evidence.exactQuote
      );

      const entPCA = validated.entities.find((e) => e.name === 'Principal Component Analysis');
      expect(entPCA).toBeDefined();
      expect(entPCA?.evidence.chunkId).toBe('window-chunk-1');
      expect(entPCA?.evidence.page).toBe(2);
      expect(entPCA?.evidence.lineStart).toBe(12);
      expect(chunk1.text.substring(entPCA!.evidence.charOffset!.start, entPCA!.evidence.charOffset!.end)).toBe(
        entPCA?.evidence.exactQuote
      );

      const entGD = validated.entities.find((e) => e.name === 'Gradient Descent');
      expect(entGD).toBeDefined();
      expect(entGD?.evidence.chunkId).toBe('window-chunk-2');
      expect(entGD?.evidence.page).toBe(3);
      expect(chunk2.text.substring(entGD!.evidence.charOffset!.start, entGD!.evidence.charOffset!.end)).toBe(
        entGD?.evidence.exactQuote
      );

      // Verify relationship anchoring
      expect(validated.relationships.length).toBe(1);
      const rel = validated.relationships[0];
      expect(rel.evidence.chunkId).toBe('window-chunk-1');
      expect(rel.evidence.page).toBe(2);
      expect(chunk1.text.substring(rel.evidence.charOffset!.start, rel.evidence.charOffset!.end)).toBe(
        rel.evidence.exactQuote
      );

      // Verify claim anchoring
      expect(validated.claims.length).toBe(2);
      const claim0 = validated.claims.find((c) => c.subjectEntityName === 'Singular Value Decomposition');
      expect(claim0?.evidence.chunkId).toBe('window-chunk-0');

      const claim1 = validated.claims.find((c) => c.subjectEntityName === 'Gradient Descent');
      expect(claim1?.evidence.chunkId).toBe('window-chunk-2');
    });

    it('strictly discards ungrounded entities, claims, and relations not found in any chunk', () => {
      const chunk: Chunk = {
        chunkId: 'chunk-strict',
        text: 'The Fourier Transform decomposes a function into its constituent frequencies.',
        metadata: { docId: 'doc-fourier', filename: 'fourier.txt', mimeType: 'text/plain', chunkIndex: 0, charStart: 0, charEnd: 79 },
      };

      const hallucinatedPayload: ExtractedGraphPayload = {
        entities: [
          {
            name: 'Invented Concept',
            type: 'Concept',
            mentionQuote: 'This sentence does not exist anywhere in the text.',
          },
        ],
        claims: [
          {
            subjectEntityName: 'Invented Concept',
            claimText: 'Invented claim',
            modality: 'Fact',
            confidence: 0.99,
            exactQuote: 'Completely made up text.',
          },
        ],
        relationships: [
          {
            sourceEntityName: 'Invented Concept',
            targetEntityName: 'Another Fake',
            relationType: 'CAUSES',
            description: 'Fake relation',
            confidence: 0.99,
            exactQuote: 'Hallucinated relationship quote.',
          },
        ],
      };

      const validated = ProvenanceValidator.validateAndAnchorWindow([chunk], hallucinatedPayload);
      expect(validated.entities.length).toBe(0);
      expect(validated.claims.length).toBe(0);
      expect(validated.relationships.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. Batch Entity Embedding in Deduplication
  // =========================================================================

  describe('Batch Entity Embedding in Deduplication (R3)', () => {
    it('aggregates candidate entity embeddings into a single batch call reducing embedding calls by >90%', async () => {
      const mockGraph = new GraphStore(graphPath);
      const mockReviews = new ReviewStore(reviewPath);
      const mockEmbedder = new EmbeddingService();

      let embedBatchInvocations = 0;
      let totalNamesBatchEmbedded = 0;

      mockEmbedder.embedBatch = async (names: string[]): Promise<number[][]> => {
        embedBatchInvocations++;
        totalNamesBatchEmbedded += names.length;
        return names.map((n) => mockEmbedder.generateMockEmbedding(n));
      };

      const spyEmbedQuery = vi.spyOn(mockEmbedder, 'embedQuery');

      const dedupService = new DeduplicationService(mockGraph, mockReviews, mockEmbedder);

      // Create 15 distinct candidate entities across an extraction batch
      const candidates: ValidatedEntity[] = Array.from({ length: 15 }, (_, i) => ({
        name: `Unique Concept ${i} in Mathematics ${Date.now()}`,
        type: 'Concept',
        aliases: [],
        evidence: {
          docId: 'doc-batch',
          chunkId: `chunk-${i}`,
          filename: 'batch.txt',
          exactQuote: `Quote for concept ${i}`,
        },
      }));

      const nameToId = await dedupService.resolveEntities(candidates);

      // Verify all candidates resolved
      expect(nameToId.size).toBe(30); // 15 original + 15 lowercased
      for (const c of candidates) {
        expect(nameToId.has(c.name)).toBe(true);
      }

      // Verify embedBatch was called exactly ONCE for all 15 entities
      expect(embedBatchInvocations).toBe(1);
      expect(totalNamesBatchEmbedded).toBe(15);

      // embedQuery should NOT have been called individually for each entity
      expect(spyEmbedQuery).toHaveBeenCalledTimes(0);

      // Baseline unbatched: 15 individual calls. Batched: 1 call.
      const unbatchedCalls = 15;
      const batchedCalls = embedBatchInvocations;
      const reduction = (unbatchedCalls - batchedCalls) / unbatchedCalls;
      expect(reduction).toBeGreaterThanOrEqual(0.9); // >= 90% reduction!
    });

    it('filters out cached entities via cacheService and skips them in batch embed call', async () => {
      const mockGraph = new GraphStore(graphPath);
      const mockReviews = new ReviewStore(reviewPath);
      const mockEmbedder = new EmbeddingService();

      const batchCallReceivedNames: string[] = [];
      mockEmbedder.embedBatch = async (names: string[]): Promise<number[][]> => {
        batchCallReceivedNames.push(...names);
        return names.map((n) => mockEmbedder.generateMockEmbedding(n));
      };

      const dedupService = new DeduplicationService(mockGraph, mockReviews, mockEmbedder);

      // Pre-seed 3 unique entities into cacheService
      const testNonce = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const cachedNames = [`Cached Alpha ${testNonce}`, `Cached Beta ${testNonce}`, `Cached Gamma ${testNonce}`];
      for (const name of cachedNames) {
        await cacheService.setEmbedding(name, mockEmbedder.generateMockEmbedding(name));
      }

      // 6 candidates: 3 cached, 3 uncached
      const uncachedNames = [`Uncached Delta ${testNonce}`, `Uncached Epsilon ${testNonce}`, `Uncached Zeta ${testNonce}`];
      const allNames = [...cachedNames, ...uncachedNames];

      const candidates: ValidatedEntity[] = allNames.map((name, i) => ({
        name,
        type: 'Concept',
        aliases: [],
        evidence: {
          docId: 'doc-cache-test',
          chunkId: `chunk-${i}`,
          filename: 'cache_test.txt',
          exactQuote: `Exact quote for ${name}`,
        },
      }));

      await dedupService.resolveEntities(candidates);

      // Verify ONLY the 3 uncached names were passed to embedBatch
      expect(batchCallReceivedNames.length).toBe(3);
      for (const uncached of uncachedNames) {
        expect(batchCallReceivedNames).toContain(uncached);
      }
      for (const cached of cachedNames) {
        expect(batchCallReceivedNames).not.toContain(cached);
      }
    });

    it('caches newly computed batch embeddings in cacheService', async () => {
      const mockGraph = new GraphStore(graphPath);
      const mockReviews = new ReviewStore(reviewPath);
      const mockEmbedder = new EmbeddingService();

      const uniqueBatchName = `Brand New Entity ${Date.now()}`;
      mockEmbedder.embedBatch = async (names: string[]) => {
        return names.map((n) => mockEmbedder.generateMockEmbedding(n));
      };

      const dedupService = new DeduplicationService(mockGraph, mockReviews, mockEmbedder);

      // Confirm not yet in cache
      expect(cacheService.getEmbedding(uniqueBatchName)).toBeNull();

      const candidates: ValidatedEntity[] = [
        {
          name: uniqueBatchName,
          type: 'Concept',
          evidence: {
            docId: 'doc-new',
            chunkId: 'chunk-0',
            filename: 'new.txt',
            exactQuote: 'Quote',
          },
        },
      ];

      await dedupService.resolveEntities(candidates);

      // Confirm now present in cache
      const cachedVector = cacheService.getEmbedding(uniqueBatchName);
      expect(cachedVector).toBeDefined();
      expect(Array.isArray(cachedVector)).toBe(true);
      expect(cachedVector!.length).toBe(768);
    });

    it('splits large batches into slices of up to 100 names per call', async () => {
      const mockGraph = new GraphStore(graphPath);
      const mockReviews = new ReviewStore(reviewPath);
      const mockEmbedder = new EmbeddingService();

      const batchSizes: number[] = [];
      mockEmbedder.embedBatch = async (names: string[]) => {
        batchSizes.push(names.length);
        return names.map((n) => mockEmbedder.generateMockEmbedding(n));
      };

      const dedupService = new DeduplicationService(mockGraph, mockReviews, mockEmbedder);

      // 145 unique candidate entities
      const largeCandidates: ValidatedEntity[] = Array.from({ length: 145 }, (_, i) => ({
        name: `Large Scale Entity ${i} ${Date.now()}`,
        type: 'Concept',
        evidence: {
          docId: 'doc-large',
          chunkId: `chunk-${i}`,
          filename: 'large.txt',
          exactQuote: `Quote ${i}`,
        },
      }));

      await dedupService.resolveEntities(largeCandidates);

      // Sliced into 2 calls: 100 in first, 45 in second
      expect(batchSizes.length).toBe(2);
      expect(batchSizes[0]).toBe(100);
      expect(batchSizes[1]).toBe(45);

      // 145 individual calls reduced to 2 calls = 98.6% reduction
      const reduction = (145 - 2) / 145;
      expect(reduction).toBeGreaterThanOrEqual(0.9);
    });
  });

  // =========================================================================
  // 4. End-to-End Extraction & Storage Pipeline with Batching
  // =========================================================================

  describe('End-to-End Extraction & Storage Pipeline (R3)', () => {
    it('executes end-to-end ingestion on 12-chunk document with 75% extraction reduction and 100% provenance anchoring', async () => {
      // Create 12 adjacent chunks for a document
      const chunks: Chunk[] = Array.from({ length: 12 }, (_, i) => ({
        chunkId: `full-doc-chunk-${i}`,
        text: `Chapter ${i} discusses fundamental theorem ${i} in computational linear algebra. Singular Value Decomposition is applied in Section ${i}. Principal Component Analysis is utilized in Subsection ${i}.`,
        metadata: {
          docId: 'full-doc-12',
          filename: 'computational_algebra.txt',
          mimeType: 'text/plain',
          chunkIndex: i,
          page: Math.floor(i / 2) + 1,
          lineStart: i * 10 + 1,
          charStart: i * 200,
          charEnd: (i + 1) * 200,
        },
      }));

      graphExtractionService.resetCallCount();

      // Ingest the 12 chunks
      const stats = await extractAndStoreGraphForChunks(chunks);

      expect(stats.entitiesCount).toBeGreaterThan(0);
      expect(stats.edgesCount).toBeGreaterThan(0);
      expect(stats.claimsCount).toBeGreaterThan(0);

      // 12 chunks partitioned into windows of 4 chunks each -> exactly 3 extraction calls!
      // Unbatched: 12 extraction calls. Batched: 3 calls -> 75% reduction!
      expect(graphExtractionService.getExtractionCallCount()).toBe(3);
      const callReduction = (12 - graphExtractionService.getExtractionCallCount()) / 12;
      expect(callReduction).toBe(0.75);

      // Verify 100% provenance anchoring
      const graph = graphStore.getAll();
      expect(graph.edges.length).toBeGreaterThan(0);

      const chunkMap = new Map<string, string>(chunks.map((c) => [c.chunkId, c.text]));

      for (const edge of graph.edges) {
        expect(edge.evidence).toBeDefined();
        expect(edge.evidence.docId).toBe('full-doc-12');
        expect(edge.evidence.chunkId).toBeDefined();

        const sourceText = chunkMap.get(edge.evidence.chunkId);
        expect(sourceText).toBeDefined();
        expect(sourceText!.includes(edge.evidence.exactQuote)).toBe(true);

        if (edge.evidence.charOffset) {
          const { start, end } = edge.evidence.charOffset;
          expect(sourceText!.substring(start, end)).toBe(edge.evidence.exactQuote);
        }
      }

      for (const claim of graph.claims) {
        expect(claim.evidence).toBeDefined();
        const sourceText = chunkMap.get(claim.evidence.chunkId);
        expect(sourceText).toBeDefined();
        expect(sourceText!.includes(claim.evidence.exactQuote)).toBe(true);
      }
    });
  });
});
