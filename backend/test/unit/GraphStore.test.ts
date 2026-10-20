import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GraphStore } from '../../src/store/GraphStore';
import { EntityNode, RelationshipEdge, ClaimNode, EvidenceRef } from '../../src/types';

describe('GraphStore Unit Tests', () => {
  const testDataDir = path.join(process.cwd(), 'test-data-graph');
  const testFilePath = path.join(testDataDir, 'graph.json');
  let store: GraphStore;

  const mockEvidence: EvidenceRef = {
    docId: 'doc-1',
    chunkId: 'doc-1-0',
    filename: 'linear_algebra.txt',
    lineStart: 1,
    exactQuote: 'Singular Value Decomposition (SVD) is a fundamental matrix factorization.',
    charOffset: { start: 0, end: 72 },
  };

  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    store = new GraphStore(testFilePath);
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(testDataDir)) {
      try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('should add, retrieve by id and retrieve by name or alias', () => {
    const entity: EntityNode = {
      id: 'ent-1',
      name: 'Singular Value Decomposition',
      type: 'Concept',
      aliases: ['SVD'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.addEntity(entity);

    const byId = store.getEntity('ent-1');
    expect(byId).toBeDefined();
    expect(byId?.name).toBe('Singular Value Decomposition');

    const byName = store.getEntityByName('singular value decomposition');
    expect(byName).toBeDefined();
    expect(byName?.id).toBe('ent-1');

    const byAlias = store.getEntityByName('svd');
    expect(byAlias).toBeDefined();
    expect(byAlias?.id).toBe('ent-1');
  });

  it('should add and query edges and claims with incident edges', () => {
    const ent1: EntityNode = {
      id: 'ent-1',
      name: 'PCA',
      type: 'Method',
      aliases: ['Principal Component Analysis'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ent2: EntityNode = {
      id: 'ent-2',
      name: 'SVD',
      type: 'Method',
      aliases: [],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.addEntity(ent1);
    store.addEntity(ent2);

    const edge: RelationshipEdge = {
      id: 'edge-1',
      sourceId: 'ent-1',
      targetId: 'ent-2',
      relationType: 'USES',
      description: 'PCA uses SVD for computation',
      confidence: 0.95,
      evidence: mockEvidence,
      createdAt: Date.now(),
    };
    store.addEdge(edge);

    const claim: ClaimNode = {
      id: 'claim-1',
      subjectEntityId: 'ent-1',
      claimText: 'PCA reduces dimensionality',
      modality: 'Fact',
      confidence: 0.9,
      evidence: mockEvidence,
      createdAt: Date.now(),
    };
    store.addClaim(claim);

    const incident1 = store.getIncidentEdges('ent-1');
    expect(incident1.outgoing.length).toBe(1);
    expect(incident1.outgoing[0].id).toBe('edge-1');
    expect(incident1.incoming.length).toBe(0);

    const incident2 = store.getIncidentEdges('ent-2');
    expect(incident2.incoming.length).toBe(1);
    expect(incident2.incoming[0].id).toBe('edge-1');

    const claims = store.getClaimsForEntity('ent-1');
    expect(claims.length).toBe(1);
    expect(claims[0].claimText).toBe('PCA reduces dimensionality');
  });

  it('should correctly traverse subgraph with depth', () => {
    const nodeA: EntityNode = { id: 'A', name: 'Node A', type: 'Concept', aliases: [], status: 'active', evidence: [], createdAt: 0, updatedAt: 0 };
    const nodeB: EntityNode = { id: 'B', name: 'Node B', type: 'Concept', aliases: [], status: 'active', evidence: [], createdAt: 0, updatedAt: 0 };
    const nodeC: EntityNode = { id: 'C', name: 'Node C', type: 'Concept', aliases: [], status: 'active', evidence: [], createdAt: 0, updatedAt: 0 };

    store.addEntity(nodeA);
    store.addEntity(nodeB);
    store.addEntity(nodeC);

    store.addEdge({ id: 'e1', sourceId: 'A', targetId: 'B', relationType: 'PREREQUISITE_FOR', description: 'A before B', confidence: 1, evidence: mockEvidence, createdAt: 0 });
    store.addEdge({ id: 'e2', sourceId: 'B', targetId: 'C', relationType: 'PREREQUISITE_FOR', description: 'B before C', confidence: 1, evidence: mockEvidence, createdAt: 0 });

    // Depth 1 from A
    const sub1 = store.getSubgraph(['A'], 1);
    const nodeIds1 = sub1.nodes.map((n) => n.id).sort();
    expect(nodeIds1).toEqual(['A', 'B']);
    expect(sub1.edges.map((e) => e.id)).toEqual(['e1']);

    // Depth 2 from A
    const sub2 = store.getSubgraph(['A'], 2);
    const nodeIds2 = sub2.nodes.map((n) => n.id).sort();
    expect(nodeIds2).toEqual(['A', 'B', 'C']);
    expect(sub2.edges.length).toBe(2);
  });

  it('should merge entities, repoint incident edges and consolidate evidence and aliases', async () => {
    const candidate: EntityNode = {
      id: 'ent-cand',
      name: 'Singular Value Factorization',
      type: 'Concept',
      aliases: ['SVF'],
      status: 'pending_review',
      evidence: [{ ...mockEvidence, exactQuote: 'Singular Value Factorization is useful.' }],
      createdAt: 100,
      updatedAt: 100,
    };

    const target: EntityNode = {
      id: 'ent-target',
      name: 'Singular Value Decomposition',
      type: 'Concept',
      aliases: ['SVD'],
      status: 'active',
      evidence: [{ ...mockEvidence, exactQuote: 'SVD is a matrix method.' }],
      createdAt: 50,
      updatedAt: 50,
    };

    const other: EntityNode = {
      id: 'ent-other',
      name: 'Matrix Rank',
      type: 'Property',
      aliases: [],
      status: 'active',
      evidence: [],
      createdAt: 50,
      updatedAt: 50,
    };

    store.addEntity(candidate);
    store.addEntity(target);
    store.addEntity(other);

    // Edge from other to candidate
    store.addEdge({
      id: 'e-in',
      sourceId: 'ent-other',
      targetId: 'ent-cand',
      relationType: 'RELATED_TO',
      description: 'Rank relates to SVF',
      confidence: 0.9,
      evidence: mockEvidence,
      createdAt: 100,
    });

    // Edge from candidate to other
    store.addEdge({
      id: 'e-out',
      sourceId: 'ent-cand',
      targetId: 'ent-other',
      relationType: 'USES',
      description: 'SVF uses Rank',
      confidence: 0.9,
      evidence: mockEvidence,
      createdAt: 100,
    });

    // Claim on candidate
    store.addClaim({
      id: 'c-1',
      subjectEntityId: 'ent-cand',
      claimText: 'SVF decomposes rank r matrices',
      modality: 'Fact',
      confidence: 0.9,
      evidence: mockEvidence,
      createdAt: 100,
    });

    // Perform merge
    store.mergeEntities('ent-cand', 'ent-target');

    // 1. Candidate is marked as merged
    const candAfter = store.getEntity('ent-cand');
    expect(candAfter?.status).toBe('merged');
    expect(candAfter?.mergedIntoId).toBe('ent-target');

    // 2. Target aliases contains candidate name and its aliases
    const targetAfter = store.getEntity('ent-target');
    expect(targetAfter?.aliases).toContain('Singular Value Factorization');
    expect(targetAfter?.aliases).toContain('SVF');
    expect(targetAfter?.aliases).toContain('SVD');

    // 3. Evidence is combined
    expect(targetAfter?.evidence.length).toBe(2);

    // 4. Edges are repointed
    const edgeIn = store.getAll().edges.find((e) => e.id === 'e-in');
    expect(edgeIn?.targetId).toBe('ent-target');

    const edgeOut = store.getAll().edges.find((e) => e.id === 'e-out');
    expect(edgeOut?.sourceId).toBe('ent-target');

    // 5. Claims are repointed
    const claim = store.getAll().claims.find((c) => c.id === 'c-1');
    expect(claim?.subjectEntityId).toBe('ent-target');
  });

  it('should atomically persist and reload data correctly', async () => {
    const ent: EntityNode = {
      id: 'p-1',
      name: 'Eigenvectors',
      type: 'Concept',
      aliases: ['characteristic vectors'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 12345,
      updatedAt: 12345,
    };
    store.addEntity(ent);
    store.addEdge({
      id: 'edge-p',
      sourceId: 'p-1',
      targetId: 'p-1',
      relationType: 'DEFINES',
      description: 'self relation',
      confidence: 0.9,
      evidence: mockEvidence,
      createdAt: 12345,
    });

    await store.save();

    // Instantiate new store from same file
    const newStore = new GraphStore(testFilePath);
    const loadedEnt = newStore.getEntity('p-1');
    expect(loadedEnt).toBeDefined();
    expect(loadedEnt?.name).toBe('Eigenvectors');
    expect(loadedEnt?.aliases).toContain('characteristic vectors');
    expect(newStore.getAll().edges.length).toBe(1);
  });
});
