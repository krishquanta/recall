import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DeduplicationService } from '../../src/services/DeduplicationService';
import { GraphStore } from '../../src/store/GraphStore';
import { ReviewStore } from '../../src/store/ReviewStore';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { EvidenceRef } from '../../src/types';

describe('DeduplicationService Unit Tests', () => {
  const testDataDir = path.join(process.cwd(), 'test-data-dedup');
  const graphFile = path.join(testDataDir, 'graph.json');
  const reviewFile = path.join(testDataDir, 'review_queue.json');

  let graph: GraphStore;
  let reviews: ReviewStore;
  let embedder: EmbeddingService;
  let service: DeduplicationService;

  const mockEvidence: EvidenceRef = {
    docId: 'doc-1',
    chunkId: 'doc-1-0',
    filename: 'math.txt',
    exactQuote: 'Principal Component Analysis (PCA) is widely used.',
    charOffset: { start: 0, end: 51 },
  };

  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    if (fs.existsSync(graphFile)) fs.unlinkSync(graphFile);
    if (fs.existsSync(reviewFile)) fs.unlinkSync(reviewFile);

    graph = new GraphStore(graphFile);
    reviews = new ReviewStore(reviewFile);
    embedder = new EmbeddingService();
    service = new DeduplicationService(graph, reviews, embedder);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(graphFile)) fs.unlinkSync(graphFile);
      if (fs.existsSync(reviewFile)) fs.unlinkSync(reviewFile);
      if (fs.existsSync(testDataDir)) fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should normalize entity names properly', () => {
    expect(service.normalize('  Singular Value Decomposition! ')).toBe('singular value decomposition');
    expect(service.normalize('K-Means   Clustering')).toBe('k-means clustering');
  });

  it('should extract acronyms from names and parentheticals', () => {
    expect(service.extractAcronym('Singular Value Decomposition')).toBe('SVD');
    expect(service.extractAcronym('Principal Component Analysis (PCA)')).toBe('PCA');
    expect(service.extractAcronym('SVD')).toBe('SVD');
  });

  it('should resolve identical and alias entities via lexical matching', async () => {
    graph.addEntity({
      id: 'ent-pca',
      name: 'Principal Component Analysis',
      type: 'Method',
      aliases: ['PCA'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1,
      updatedAt: 1,
    });

    // Exact lexical match
    const res1 = await service.resolveEntity({
      name: 'principal component analysis',
      type: 'Method',
      evidence: mockEvidence,
    });
    expect(res1.status).toBe('existing');
    expect(res1.entityId).toBe('ent-pca');

    // Alias match
    const res2 = await service.resolveEntity({
      name: 'pca',
      type: 'Method',
      evidence: mockEvidence,
    });
    expect(res2.status).toBe('existing');
    expect(res2.entityId).toBe('ent-pca');
  });

  it('should resolve via acronym detection and register alias', async () => {
    graph.addEntity({
      id: 'ent-svd',
      name: 'Singular Value Decomposition',
      type: 'Method',
      aliases: [],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1,
      updatedAt: 1,
    });

    // Candidate is the acronym
    const res = await service.resolveEntity({
      name: 'SVD',
      type: 'Method',
      evidence: mockEvidence,
    });
    expect(res.status).toBe('existing');
    expect(res.entityId).toBe('ent-svd');

    const updated = graph.getEntity('ent-svd');
    expect(updated?.aliases).toContain('SVD');
  });

  it('should create new active entity when cosine similarity is low (< 0.78)', async () => {
    graph.addEntity({
      id: 'ent-1',
      name: 'Quantum Electrodynamics',
      type: 'Concept',
      aliases: [],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await service.resolveEntity({
      name: 'Photosynthesis in Plants',
      type: 'Concept',
      evidence: mockEvidence,
    });

    expect(res.status).toBe('new');
    expect(res.entityId).toBeDefined();

    const created = graph.getEntity(res.entityId);
    expect(created?.status).toBe('active');
    expect(created?.name).toBe('Photosynthesis in Plants');
  });

  it('should dispatch to ReviewQueue when similarity is uncertain (0.78 <= score < 0.92)', async () => {
    // Create custom embedder that returns controlled embeddings for deterministic testing
    const customEmbedder = new EmbeddingService();
    // Vector of 768 dimensions with first dimension = 1
    const baseVec = new Array(768).fill(0);
    baseVec[0] = 1;

    // Angle producing cosine similarity of ~0.85
    // vec2 = [0.85, sqrt(1 - 0.85^2), 0, ...]
    const uncertainVec = new Array(768).fill(0);
    uncertainVec[0] = 0.85;
    uncertainVec[1] = Math.sqrt(1 - 0.85 * 0.85);

    customEmbedder.embedQuery = async (text: string) => {
      if (text === 'Entity Target') return baseVec;
      if (text === 'Entity Candidate') return uncertainVec;
      return new Array(768).fill(0);
    };

    const mockGraph = new GraphStore(graphFile);
    const mockReviews = new ReviewStore(reviewFile);
    const customService = new DeduplicationService(mockGraph, mockReviews, customEmbedder);

    mockGraph.addEntity({
      id: 'ent-target',
      name: 'Entity Target',
      type: 'Concept',
      aliases: [],
      embedding: baseVec,
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await customService.resolveEntity({
      name: 'Entity Candidate',
      type: 'Concept',
      evidence: mockEvidence,
    });

    expect(res.status).toBe('provisional');
    expect(res.reviewItemId).toBeDefined();

    // Verify provisional node was created
    const provisional = mockGraph.getEntity(res.entityId);
    expect(provisional?.status).toBe('pending_review');

    // Verify item was enqueued in ReviewStore
    const pendingItems = mockReviews.getPending();
    expect(pendingItems.length).toBe(1);
    expect(pendingItems[0].id).toBe(res.reviewItemId);
    expect(pendingItems[0].similarityScore).toBeCloseTo(0.85, 2);
    expect(pendingItems[0].matchedEntity.id).toBe('ent-target');
  });

  it('should auto-merge when similarity is high (score >= 0.92)', async () => {
    const customEmbedder = new EmbeddingService();
    const baseVec = new Array(768).fill(0);
    baseVec[0] = 1;

    // High similarity: ~0.95
    const highVec = new Array(768).fill(0);
    highVec[0] = 0.95;
    highVec[1] = Math.sqrt(1 - 0.95 * 0.95);

    customEmbedder.embedQuery = async (text: string) => {
      if (text === 'Linear Regression') return baseVec;
      if (text === 'Simple Linear Regression') return highVec;
      return new Array(768).fill(0);
    };

    const mockGraph = new GraphStore(graphFile);
    const mockReviews = new ReviewStore(reviewFile);
    const customService = new DeduplicationService(mockGraph, mockReviews, customEmbedder);

    mockGraph.addEntity({
      id: 'ent-lr',
      name: 'Linear Regression',
      type: 'Method',
      aliases: [],
      embedding: baseVec,
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await customService.resolveEntity({
      name: 'Simple Linear Regression',
      type: 'Method',
      evidence: { ...mockEvidence, exactQuote: 'Simple Linear Regression models y = mx + b.' },
    });

    expect(res.status).toBe('existing');
    expect(res.entityId).toBe('ent-lr');

    const updated = mockGraph.getEntity('ent-lr');
    expect(updated?.aliases).toContain('Simple Linear Regression');
    expect(updated?.evidence.length).toBe(2);
  });

  it('should batch-embed unseen candidate entities across extraction batch in a single call', async () => {
    let batchCallCount = 0;
    const batchNames: string[] = [];

    const mockEmbedder = new EmbeddingService();
    mockEmbedder.embedBatch = async (names: string[]) => {
      batchCallCount++;
      batchNames.push(...names);
      return names.map((n) => mockEmbedder.generateMockEmbedding(n));
    };

    const mockGraph = new GraphStore(graphFile);
    const mockReviews = new ReviewStore(reviewFile);
    const batchService = new DeduplicationService(mockGraph, mockReviews, mockEmbedder);

    const candidates = [
      {
        name: `Batch Concept 1 ${Date.now()}`,
        type: 'Concept' as const,
        aliases: [],
        evidence: mockEvidence,
      },
      {
        name: `Batch Concept 2 ${Date.now()}`,
        type: 'Concept' as const,
        aliases: [],
        evidence: mockEvidence,
      },
      {
        name: `Batch Concept 3 ${Date.now()}`,
        type: 'Concept' as const,
        aliases: [],
        evidence: mockEvidence,
      },
    ];

    const nameToId = await batchService.resolveEntities(candidates);
    expect(nameToId.size).toBe(6); // 3 original + 3 lowercase
    expect(batchCallCount).toBe(1);
    expect(batchNames.length).toBe(3);
    expect(batchService.getBatchEmbeddingCallCount()).toBe(1);
  });
});
