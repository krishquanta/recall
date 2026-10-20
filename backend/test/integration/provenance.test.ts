import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { graphStore } from '../../src/store/GraphStore';
import { reviewStore } from '../../src/store/ReviewStore';
import { reviewQueueService } from '../../src/services/ReviewQueueService';
import { extractAndStoreGraphForChunks } from '../../src/routes/graph';
import { Chunk } from '../../src/types';

describe('Provenance & Definition of Done Integration Tests', () => {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const graphPath = path.join(dataDir, 'graph.json');
  const reviewPath = path.join(dataDir, 'review_queue.json');

  const sampleChunks: Chunk[] = [
    {
      chunkId: 'doc-linalg-0',
      text: 'In linear algebra, Singular Value Decomposition (SVD) is a factorization of a real or complex matrix that generalizes the eigendecomposition of a square normal matrix. Principal Component Analysis (PCA) uses Singular Value Decomposition to compute the principal components of a dataset. Matrix Factorization is a fundamental concept in data analysis.',
      metadata: {
        docId: 'doc-linalg',
        filename: 'linear_algebra.txt',
        mimeType: 'text/plain',
        chunkIndex: 0,
        lineStart: 1,
        charStart: 0,
        charEnd: 337,
      },
    },
    {
      chunkId: 'doc-geom-0',
      text: 'The Pythagorean Theorem states that in a right-angled triangle, the square of the hypotenuse is equal to the sum of the squares of the other two sides. Euclidean Geometry defines the principles of flat space. The Pythagorean Theorem proves geometric relations between perpendicular vectors.',
      metadata: {
        docId: 'doc-geom',
        filename: 'geometry.txt',
        mimeType: 'text/plain',
        chunkIndex: 0,
        lineStart: 1,
        charStart: 0,
        charEnd: 284,
      },
    },
    {
      chunkId: 'doc-ml-0',
      text: 'Gradient Descent is an optimization algorithm used to train machine learning models. Linear Regression uses Gradient Descent to minimize the mean squared error loss function.',
      metadata: {
        docId: 'doc-ml',
        filename: 'machine_learning.txt',
        mimeType: 'text/plain',
        chunkIndex: 0,
        lineStart: 1,
        charStart: 0,
        charEnd: 177,
      },
    },
  ];

  beforeEach(() => {
    graphStore.clear();
    reviewStore.clear();
  });

  afterEach(() => {
    graphStore.clear();
    reviewStore.clear();
  });

  it('Strict DoD Check: 100% of extracted edges must have verifiable verbatim quotes in source chunks', async () => {
    // 1. Ingest sample multi-format chunks through the extraction and storage pipeline
    const stats = await extractAndStoreGraphForChunks(sampleChunks);
    expect(stats.entitiesCount).toBeGreaterThan(0);
    expect(stats.edgesCount).toBeGreaterThan(0);
    expect(stats.claimsCount).toBeGreaterThan(0);

    const graph = graphStore.getAll();
    expect(graph.edges.length).toBeGreaterThan(0);

    // Map chunkId to source text
    const chunkMap = new Map<string, string>(sampleChunks.map((c) => [c.chunkId, c.text]));

    // 2. Strict Definition of Done Assertion 1:
    // Every single edge MUST have a valid evidence reference, non-empty exactQuote, and valid docId
    const allEdgesHaveEvidence = graph.edges.every(
      (edge) =>
        Boolean(edge.evidence) &&
        Boolean(edge.evidence.exactQuote) &&
        edge.evidence.exactQuote.trim().length > 0 &&
        Boolean(edge.evidence.docId) &&
        Boolean(edge.evidence.chunkId)
    );
    expect(allEdgesHaveEvidence).toBe(true);

    // 3. Strict Definition of Done Assertion 2:
    // For EVERY edge, its exactQuote MUST strictly be a substring of the source chunk's text
    for (const edge of graph.edges) {
      const sourceChunkText = chunkMap.get(edge.evidence.chunkId);
      expect(sourceChunkText).toBeDefined();

      const quote = edge.evidence.exactQuote;
      expect(quote).toBeTruthy();
      expect(sourceChunkText!.includes(quote)).toBe(true);

      // Verify character offsets if present
      if (edge.evidence.charOffset) {
        const { start, end } = edge.evidence.charOffset;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(sourceChunkText!.length);
        expect(sourceChunkText!.substring(start, end)).toBe(quote);
      }
    }

    // 4. Strict Definition of Done Assertion 3:
    // Every single claim MUST also be strictly grounded with a verbatim quote in source chunk
    for (const claim of graph.claims) {
      const sourceChunkText = chunkMap.get(claim.evidence.chunkId);
      expect(sourceChunkText).toBeDefined();

      const quote = claim.evidence.exactQuote;
      expect(quote).toBeTruthy();
      expect(sourceChunkText!.includes(quote)).toBe(true);
    }
  });

  it('End-to-end integration: Review queue resolution correctly updates graph and repoints edges', async () => {
    // Seed target entity
    const targetId = 'target-svd';
    graphStore.addEntity({
      id: targetId,
      name: 'Singular Value Decomposition',
      type: 'Concept',
      aliases: ['SVD'],
      status: 'active',
      evidence: [
        {
          docId: 'doc-1',
          chunkId: 'doc-1-0',
          filename: 'doc1.txt',
          exactQuote: 'SVD is widely used in linear algebra.',
        },
      ],
      createdAt: 100,
      updatedAt: 100,
    });

    // Seed candidate entity with pending_review status
    const candidateId = 'cand-svd-factorization';
    graphStore.addEntity({
      id: candidateId,
      name: 'Singular Value Factorization',
      type: 'Concept',
      aliases: [],
      status: 'pending_review',
      evidence: [
        {
          docId: 'doc-2',
          chunkId: 'doc-2-0',
          filename: 'doc2.txt',
          exactQuote: 'Singular Value Factorization is applied to rectangular matrices.',
        },
      ],
      createdAt: 200,
      updatedAt: 200,
    });

    // Add an edge pointing to candidate
    graphStore.addEdge({
      id: 'edge-to-candidate',
      sourceId: targetId,
      targetId: candidateId,
      relationType: 'EQUIVALENT_TO',
      description: 'SVD is equivalent to Singular Value Factorization',
      confidence: 0.88,
      evidence: {
        docId: 'doc-2',
        chunkId: 'doc-2-0',
        filename: 'doc2.txt',
        exactQuote: 'Singular Value Factorization is applied to rectangular matrices.',
      },
      createdAt: 200,
    });

    // Add another entity with an edge to candidate
    const otherId = 'other-matrix';
    graphStore.addEntity({
      id: otherId,
      name: 'Rectangular Matrix',
      type: 'Concept',
      aliases: [],
      status: 'active',
      evidence: [],
      createdAt: 200,
      updatedAt: 200,
    });

    graphStore.addEdge({
      id: 'edge-from-other',
      sourceId: otherId,
      targetId: candidateId,
      relationType: 'USES',
      description: 'Rectangular Matrix uses Singular Value Factorization',
      confidence: 0.85,
      evidence: {
        docId: 'doc-2',
        chunkId: 'doc-2-0',
        filename: 'doc2.txt',
        exactQuote: 'Singular Value Factorization is applied to rectangular matrices.',
      },
      createdAt: 200,
    });

    // Enqueue candidate in review store
    const item = reviewStore.enqueue({
      candidateEntity: {
        id: candidateId,
        name: 'Singular Value Factorization',
        type: 'Concept',
        evidence: {
          docId: 'doc-2',
          chunkId: 'doc-2-0',
          filename: 'doc2.txt',
          exactQuote: 'Singular Value Factorization is applied to rectangular matrices.',
        },
      },
      matchedEntity: {
        id: targetId,
        name: 'Singular Value Decomposition',
        type: 'Concept',
        aliases: ['SVD'],
      },
      similarityScore: 0.88,
    });

    // Resolve review item with 'merge'
    await reviewQueueService.resolve(item.id, 'merge');

    // Assert candidate is marked as merged
    const candidateAfter = graphStore.getEntity(candidateId);
    expect(candidateAfter?.status).toBe('merged');
    expect(candidateAfter?.mergedIntoId).toBe(targetId);

    // Assert target consolidated aliases and evidence
    const targetAfter = graphStore.getEntity(targetId);
    expect(targetAfter?.aliases).toContain('Singular Value Factorization');
    expect(targetAfter?.evidence.length).toBe(2);

    // Assert edge from other entity was repointed from candidateId to targetId
    const repointedEdge = graphStore.getAll().edges.find((e) => e.id === 'edge-from-other');
    expect(repointedEdge).toBeDefined();
    expect(repointedEdge?.targetId).toBe(targetId);

    // Assert review item status is updated to accepted
    const resolvedItem = reviewStore.get(item.id);
    expect(resolvedItem?.status).toBe('accepted');
    expect(resolvedItem?.resolvedAt).toBeDefined();
  });
});
