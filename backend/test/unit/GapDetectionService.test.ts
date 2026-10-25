import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GapDetectionService } from '../../src/services/GapDetectionService';
import { GraphStore } from '../../src/store/GraphStore';
import { ContradictionStore } from '../../src/store/ContradictionStore';
import { MetadataStore } from '../../src/store/MetadataStore';
import { EntityNode, ClaimNode, RelationshipEdge } from '../../src/types';

describe('GapDetectionService Unit Tests', () => {
  const testDir = path.join(process.cwd(), 'test-data-gaps');
  const graphFile = path.join(testDir, 'graph.json');
  const contradictionFile = path.join(testDir, 'contradictions.json');
  const metadataFile = path.join(testDir, 'metadata.json');

  let graphStore: GraphStore;
  let contradictionStore: ContradictionStore;
  let metadataStore: MetadataStore;
  let gapService: GapDetectionService;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    if (fs.existsSync(graphFile)) fs.unlinkSync(graphFile);
    if (fs.existsSync(contradictionFile)) fs.unlinkSync(contradictionFile);
    if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);

    graphStore = new GraphStore(graphFile);
    contradictionStore = new ContradictionStore(contradictionFile);
    metadataStore = new MetadataStore(metadataFile);

    gapService = new GapDetectionService(graphStore, contradictionStore, metadataStore);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(graphFile)) fs.unlinkSync(graphFile);
      if (fs.existsSync(contradictionFile)) fs.unlinkSync(contradictionFile);
      if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('detects active contradictions and assigns high priority scores', () => {
    contradictionStore.create({
      claimIdA: 'claim_1',
      claimIdB: 'claim_2',
      docIdA: 'doc_1',
      docIdB: 'doc_2',
      entityId: 'ent_dijkstra',
      entityName: "Dijkstra's Algorithm",
      quoteA: 'Dijkstra runs in O(V^2)',
      quoteB: 'Dijkstra with Fibonacci heaps runs in O(E + V log V)',
      filenameA: 'slide1.pdf',
      filenameB: 'textbook.pdf',
      type: 'divergent_quantities',
      severity: 'high',
      explanation: 'Time complexity conflict for Fibonacci heap implementation',
      reconciliationHint: 'Fibonacci heap amortized complexity',
    });

    const gaps = gapService.findUnresolvedContradictions();
    expect(gaps.length).toBe(1);
    expect(gaps[0].type).toBe('CONTRADICTION');
    expect(gaps[0].priorityScore).toBeGreaterThanOrEqual(0.95);
    expect(gaps[0].targetEntityIds).toContain('ent_dijkstra');
    expect(gaps[0].suggestedQuestion).toContain('Fibonacci heap amortized complexity');
  });

  it('detects stale claims and formulates update research prompts', () => {
    const staleClaim: ClaimNode = {
      id: 'claim_stale_1',
      claimText: 'Pluto is classified as the ninth planet of the solar system.',
      subject: 'Pluto Classification',
      subjectEntityId: 'ent_pluto',
      modality: 'Fact',
      confidence: 0.9,
      isStale: true,
      stalenessReason: 'Superseded by IAU 2006 reclassification',
      createdAt: Date.now() - 100000,
      updatedAt: Date.now() - 50000,
    };

    graphStore.addClaim(staleClaim);

    const gaps = gapService.findStaleClaims();
    expect(gaps.length).toBe(1);
    expect(gaps[0].type).toBe('STALE_CLAIM');
    expect(gaps[0].priorityScore).toBe(0.75);
    expect(gaps[0].targetEntityIds).toContain('ent_pluto');
    expect(gaps[0].suggestedQuestion).toContain('Pluto Classification');
  });

  it('detects isolated entities with degree < 2', () => {
    const isolatedNode: EntityNode = {
      id: 'ent_orphan_1',
      name: 'Simulated Annealing',
      type: 'Method',
      aliases: ['SA'],
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    graphStore.addEntity(isolatedNode);

    const connectedNodeA: EntityNode = {
      id: 'ent_conn_a',
      name: 'Gradient Descent',
      type: 'Method',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const connectedNodeB: EntityNode = {
      id: 'ent_conn_b',
      name: 'Loss Function',
      type: 'Concept',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const connectedNodeC: EntityNode = {
      id: 'ent_conn_c',
      name: 'Learning Rate',
      type: 'Property',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    graphStore.addEntity(connectedNodeA);
    graphStore.addEntity(connectedNodeB);
    graphStore.addEntity(connectedNodeC);

    // Add 2 edges to connectedNodeA (degree = 2)
    const edge1: RelationshipEdge = {
      id: 'e1',
      sourceId: 'ent_conn_a',
      targetId: 'ent_conn_b',
      relationType: 'USES',
      description: 'minimizes',
      confidence: 0.9,
      curationStatus: 'accepted',
      createdAt: Date.now(),
    };
    const edge2: RelationshipEdge = {
      id: 'e2',
      sourceId: 'ent_conn_a',
      targetId: 'ent_conn_c',
      relationType: 'USES',
      description: 'scaled by',
      confidence: 0.9,
      curationStatus: 'accepted',
      createdAt: Date.now(),
    };
    graphStore.addEdge(edge1);
    graphStore.addEdge(edge2);

    const gaps = gapService.findIsolatedEntities(2);
    const isolatedIds = gaps.map((g) => g.targetEntityIds[0]);

    expect(isolatedIds).toContain('ent_orphan_1');
    expect(isolatedIds).not.toContain('ent_conn_a'); // degree 2, not isolated
    expect(gaps[0].priorityScore).toBe(0.45);
  });

  it('detects single-source claims (weak grounding)', () => {
    const singleSourceEntity: EntityNode = {
      id: 'ent_single_src',
      name: 'Transformer Architecture',
      type: 'Concept',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    graphStore.addEntity(singleSourceEntity);

    // Both claims originate from the exact same docId "doc_vaswani"
    graphStore.addClaim({
      id: 'claim_t1',
      claimText: 'Self-attention allows parallelization',
      subject: 'Transformer Parallelization',
      subjectEntityId: 'ent_single_src',
      modality: 'Fact',
      confidence: 0.95,
      evidence: {
        docId: 'doc_vaswani',
        chunkId: 'doc_vaswani-1',
        filename: 'attention.pdf',
        exactQuote: 'Self-attention enables massive parallel computation.',
        charOffset: { start: 0, end: 40 },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    graphStore.addClaim({
      id: 'claim_t2',
      claimText: 'Positional encodings inject sequence order',
      subject: 'Positional Encoding',
      subjectEntityId: 'ent_single_src',
      modality: 'Definition',
      confidence: 0.95,
      evidence: {
        docId: 'doc_vaswani',
        chunkId: 'doc_vaswani-2',
        filename: 'attention.pdf',
        exactQuote: 'Positional encodings are added to input embeddings.',
        charOffset: { start: 0, end: 40 },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const gaps = gapService.findSingleSourceClaims();
    expect(gaps.length).toBe(1);
    expect(gaps[0].type).toBe('WEAK_GROUNDING');
    expect(gaps[0].targetEntityIds).toContain('ent_single_src');
    expect(gaps[0].priorityScore).toBe(0.55);
  });

  it('detectGaps aggregates and correctly ranks gaps by priorityScore descending', () => {
    // 1. High priority contradiction (0.98)
    contradictionStore.create({
      claimIdA: 'cA',
      claimIdB: 'cB',
      docIdA: 'dA',
      docIdB: 'dB',
      entityId: 'ent_contra',
      entityName: 'Conflict Concept',
      quoteA: 'Fact A',
      quoteB: 'Fact B',
      filenameA: 'A.txt',
      filenameB: 'B.txt',
      type: 'direct_negation',
      severity: 'high',
      explanation: 'Direct contradiction',
    });

    // 2. Medium priority stale claim (0.75)
    graphStore.addClaim({
      id: 'c_stale',
      claimText: 'Old theory',
      subject: 'Old Theory Subject',
      subjectEntityId: 'ent_stale',
      modality: 'Fact',
      confidence: 0.8,
      isStale: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 3. Isolated node (0.45)
    graphStore.addEntity({
      id: 'ent_iso',
      name: 'Lonely Node',
      type: 'Concept',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const rankedGaps = gapService.detectGaps();
    expect(rankedGaps.length).toBeGreaterThanOrEqual(3);

    // Verify descending order
    for (let i = 0; i < rankedGaps.length - 1; i++) {
      expect(rankedGaps[i].priorityScore).toBeGreaterThanOrEqual(rankedGaps[i + 1].priorityScore);
    }

    expect(rankedGaps[0].type).toBe('CONTRADICTION');
    expect(rankedGaps[1].type).toBe('STALE_CLAIM');
  });

  it('formulateQuestionForGap returns coherent natural language question prompts', () => {
    const q1 = gapService.formulateQuestionForGap({
      id: 'g1',
      type: 'CONTRADICTION',
      title: 'Time Complexity Conflict',
      description: 'Conflict in O bounds',
      suggestedQuestion: 'What is the exact asymptotic complexity of Dijkstra with heaps?',
      priorityScore: 0.95,
      targetEntityIds: ['e1'],
      detectedAt: new Date().toISOString(),
    });
    expect(q1).toBe('What is the exact asymptotic complexity of Dijkstra with heaps?');

    const q2 = gapService.formulateQuestionForGap({
      id: 'g2',
      type: 'STALE_CLAIM',
      title: 'Moore Law Scaling',
      description: 'Stale projection',
      suggestedQuestion: '',
      priorityScore: 0.75,
      targetEntityIds: ['e2'],
      detectedAt: new Date().toISOString(),
    });
    expect(q2).toContain('Moore Law Scaling');
  });
});
