import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ResearchImportService } from '../../src/services/ResearchImportService';
import { AuditService } from '../../src/services/AuditService';
import { GraphStore } from '../../src/store/GraphStore';
import { MetadataStore } from '../../src/store/MetadataStore';
import { VectorStore } from '../../src/store/VectorStore';
import { KeywordIndex } from '../../src/store/KeywordIndex';
import { ContradictionStore } from '../../src/store/ContradictionStore';
import { AuditStore } from '../../src/store/AuditStore';
import { ChunkingService } from '../../src/services/ChunkingService';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { ResearchProposalStore } from '../../src/store/ResearchProposalStore';
import { ResearchProposal, EntityNode } from '../../src/types';

describe('ResearchImportService Integration & Rollback Tests', () => {
  const testDir = path.join(process.cwd(), 'test-data-import');
  const graphFile = path.join(testDir, 'graph.json');
  const metadataFile = path.join(testDir, 'metadata.json');
  const vectorFile = path.join(testDir, 'vectors.json');
  const contraFile = path.join(testDir, 'contradictions.json');
  const auditFile = path.join(testDir, 'audit_log.jsonl');
  const uploadsDir = path.join(testDir, 'uploads');

  let graphStore: GraphStore;
  let metadataStore: MetadataStore;
  let vectorStore: VectorStore;
  let keywordIndex: KeywordIndex;
  let contradictionStore: ContradictionStore;
  let auditStore: AuditStore;
  let auditService: AuditService;
  let proposalStore: ResearchProposalStore;
  let importService: ResearchImportService;

  beforeEach(() => {
    process.env.UPLOAD_DIR = uploadsDir;
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    if (fs.existsSync(graphFile)) fs.unlinkSync(graphFile);
    if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);
    if (fs.existsSync(vectorFile)) fs.unlinkSync(vectorFile);
    if (fs.existsSync(contraFile)) fs.unlinkSync(contraFile);
    if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);

    graphStore = new GraphStore(graphFile);
    metadataStore = new MetadataStore(metadataFile);
    vectorStore = new VectorStore(vectorFile);
    keywordIndex = new KeywordIndex();
    contradictionStore = new ContradictionStore(contraFile);
    auditStore = new AuditStore(auditFile);

    auditService = new AuditService(
      auditStore,
      graphStore,
      metadataStore,
      vectorStore,
      keywordIndex,
      contradictionStore
    );

    proposalStore = new ResearchProposalStore();

    importService = new ResearchImportService(
      graphStore,
      metadataStore,
      vectorStore,
      keywordIndex,
      contradictionStore,
      auditService,
      new ChunkingService(),
      new EmbeddingService(),
      proposalStore
    );
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const createMockProposal = (overrides?: Partial<ResearchProposal>): ResearchProposal => {
    const propId = 'prop_test_123';
    return {
      id: propId,
      status: 'PENDING_REVIEW',
      createdAt: new Date().toISOString(),
      report: {
        id: 'rep_123',
        taskId: 'task_123',
        question: 'Dijkstra asymptotic complexity bounds',
        summary: 'Dijkstra with Fibonacci heaps achieves O(E + V log V).',
        detailedAnalysis: 'Analysis of min-heap versus Fibonacci heap priority queues.',
        whatChangedAndWhy: 'Resolved longstanding conflict between textbook editions.',
        sources: [
          {
            id: 'src_wiki_1',
            title: "Dijkstra's algorithm",
            url: 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm',
            domain: 'en.wikipedia.org',
            retrievedAt: new Date().toISOString(),
            snippet: 'Dijkstra algorithm finds shortest paths.',
            fullText: "Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V).",
          },
        ],
        generatedAt: new Date().toISOString(),
      },
      proposedEntities: [
        {
          tempId: 'temp_ent_1',
          name: "Dijkstra's Algorithm",
          type: 'Method',
          description: 'Shortest path graph search algorithm.',
          evidenceQuote: "Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V).",
          sourceUrl: 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm',
          sourceId: 'src_wiki_1',
          accepted: true,
        },
        {
          tempId: 'temp_ent_2',
          name: 'Fibonacci Heap',
          type: 'Concept',
          description: 'Priority queue data structure with O(1) amortized decrease-key.',
          evidenceQuote: "Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V).",
          sourceUrl: 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm',
          sourceId: 'src_wiki_1',
          accepted: true,
        },
      ],
      proposedRelations: [
        {
          tempId: 'temp_rel_1',
          sourceEntityName: "Dijkstra's Algorithm",
          targetEntityName: 'Fibonacci Heap',
          relationType: 'USES',
          description: 'uses as priority queue for min-vertex extraction',
          evidenceQuote: "Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V).",
          sourceUrl: 'https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm',
          sourceId: 'src_wiki_1',
          accepted: true,
        },
      ],
      proposedResolutions: [],
      ...overrides,
    };
  };

  it('imports proposal: generates dossier, indexes vectors, creates graph elements, and records audit', async () => {
    const proposal = createMockProposal();
    proposalStore.set(proposal);

    const result = await importService.importProposal(
      proposal.id,
      ['temp_ent_1', 'temp_ent_2'],
      ['temp_rel_1'],
      []
    );

    expect(result.success).toBe(true);
    expect(result.importedEntitiesCount).toBe(2);
    expect(result.importedRelationsCount).toBe(1);

    // 1. Dossier file created in uploadsDir
    const expectedFilePath = path.join(uploadsDir, `research_${proposal.id.replace(/^prop_/, '')}.md`);
    expect(fs.existsSync(expectedFilePath)).toBe(true);
    const dossierContent = fs.readFileSync(expectedFilePath, 'utf-8');
    expect(dossierContent).toContain('Executive Summary');
    expect(dossierContent).toContain("Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V)");

    // 2. MetadataStore entry created with sourceType: 'web'
    const doc = metadataStore.get(result.researchDocId);
    expect(doc).toBeDefined();
    expect(doc?.sourceType).toBe('web');
    expect(doc?.sourceUrl).toBe('https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm');

    // 3. VectorStore and KeywordIndex have indexed chunks
    const allVectors = vectorStore.getAll();
    const docVectors = allVectors.filter((v) => v.metadata.docId === result.researchDocId);
    expect(docVectors.length).toBeGreaterThanOrEqual(1);

    // 4. GraphStore has entities and edges with valid EvidenceRef
    const entity1 = graphStore.findEntityByName("Dijkstra's Algorithm");
    const entity2 = graphStore.findEntityByName('Fibonacci Heap');
    expect(entity1).toBeDefined();
    expect(entity2).toBeDefined();

    const incident = graphStore.getIncidentEdges(entity1!.id);
    expect(incident.outgoing.length).toBe(1);
    expect(incident.outgoing[0].targetId).toBe(entity2!.id);
    expect(incident.outgoing[0].evidence.docId).toBe(result.researchDocId);
    expect(incident.outgoing[0].curationStatus).toBe('proposed');

    // 5. AuditStore has research_import entry
    const auditEntry = auditStore.getById(result.auditEventId);
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.action).toBe('research_import');
    expect(auditEntry?.targetType).toBe('research');
  });

  it('performs entity name deduplication when matching existing graph entity', async () => {
    // Pre-populate existing entity in graph
    const preExistingEntity: EntityNode = {
      id: 'ent_existing_dijkstra',
      name: "Dijkstra's Algorithm",
      type: 'Method',
      aliases: ['Dijkstra Algorithm'],
      status: 'active',
      evidence: [],
      createdAt: Date.now() - 50000,
      updatedAt: Date.now() - 50000,
    };
    graphStore.addEntity(preExistingEntity);

    const proposal = createMockProposal();
    proposalStore.set(proposal);

    const result = await importService.importProposal(
      proposal.id,
      ['temp_ent_1', 'temp_ent_2'],
      ['temp_rel_1'],
      []
    );

    // Should only have created 1 NEW entity ("Fibonacci Heap"), while merging into existing Dijkstra
    expect(result.importedEntitiesCount).toBe(1);

    const allGraph = graphStore.getAll();
    const dijkstraNodes = allGraph.nodes.filter(
      (n) => n.name.toLowerCase() === "dijkstra's algorithm".toLowerCase()
    );
    expect(dijkstraNodes.length).toBe(1);
    expect(dijkstraNodes[0].id).toBe('ent_existing_dijkstra');
    // Evidence augmented
    expect(dijkstraNodes[0].evidence?.length).toBeGreaterThan(0);
  });

  it('executes atomic rollback of research_import, reverting graph, document, chunks, and file', async () => {
    // Create an active contradiction first
    const contra = contradictionStore.create({
      claimIdA: 'cA',
      claimIdB: 'cB',
      docIdA: 'dA',
      docIdB: 'dB',
      entityId: 'ent_dijkstra',
      entityName: "Dijkstra's Algorithm",
      quoteA: 'O(V^2)',
      quoteB: 'O(E + V log V)',
      filenameA: 'A.txt',
      filenameB: 'B.txt',
      type: 'divergent_quantities',
      severity: 'high',
      explanation: 'Dispute over complexity',
    });

    const proposal = createMockProposal({
      proposedResolutions: [
        {
          contradictionId: contra.id,
          resolutionType: 'UPDATED_CONSENSUS',
          explanation: 'Fibonacci heaps achieve O(E + V log V)',
          winningClaimEvidenceQuote: "Dijkstra's algorithm with a Fibonacci heap runs in O(E + V log V).",
          accepted: true,
        },
      ],
    });
    proposalStore.set(proposal);

    // Import
    const importResult = await importService.importProposal(
      proposal.id,
      ['temp_ent_1', 'temp_ent_2'],
      ['temp_rel_1'],
      [contra.id]
    );

    // Verify contradiction was resolved
    expect(contradictionStore.getAlert(contra.id)?.status).not.toBe('active');

    // Rollback via auditService
    const rollbackResult = await auditService.rollback(
      importResult.auditEventId,
      'User requested undo of research import'
    );

    expect(rollbackResult.success).toBe(true);

    // 1. Entities and edges removed from GraphStore
    expect(graphStore.findEntityByName('Fibonacci Heap')).toBeUndefined();
    expect(graphStore.getAll().edges.length).toBe(0);

    // 2. Chunks removed from VectorStore
    const docVectors = vectorStore.getAll().filter((v) => v.metadata.docId === importResult.researchDocId);
    expect(docVectors.length).toBe(0);

    // 3. Document removed from MetadataStore
    expect(metadataStore.get(importResult.researchDocId)).toBeUndefined();

    // 4. Dossier file deleted from uploadsDir
    const expectedFilePath = path.join(uploadsDir, `research_${proposal.id.replace(/^prop_/, '')}.md`);
    expect(fs.existsSync(expectedFilePath)).toBe(false);

    // 5. Contradiction restored to 'active'
    expect(contradictionStore.getAlert(contra.id)?.status).toBe('active');

    // 6. Rollback audit entry exists
    const auditEntries = auditStore.getAll();
    const rollbackEntry = auditEntries.find((e) => e.action === 'rollback');
    expect(rollbackEntry).toBeDefined();
    expect(rollbackEntry?.rollbackRefId).toBe(importResult.auditEventId);
  });

  it('executes atomic rollback when existing entity was augmented, preserving entity and removing dossier evidence', async () => {
    // Pre-populate existing entity
    const existing = {
      id: 'ent_existing',
      name: "Dijkstra's Algorithm",
      type: 'Method' as const,
      aliases: [],
      status: 'active' as const,
      evidence: [{ docId: 'doc_orig', chunkId: 'c1', filename: 'orig.pdf', exactQuote: 'quote' }],
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
    };
    graphStore.addEntity(existing);

    const proposal = createMockProposal();
    proposalStore.set(proposal);

    const importResult = await importService.importProposal(
      proposal.id,
      ['temp_ent_1', 'temp_ent_2'],
      ['temp_rel_1'],
      []
    );

    // Verify existing entity was augmented
    const updatedEntity = graphStore.findEntityByName("Dijkstra's Algorithm");
    expect(updatedEntity?.evidence?.length).toBe(2);

    // Rollback
    await auditService.rollback(importResult.auditEventId);

    // Existing entity must still exist, but evidence pointing to researchDocId must be gone
    const rolledBackEntity = graphStore.findEntityByName("Dijkstra's Algorithm");
    expect(rolledBackEntity).toBeDefined();
    expect(rolledBackEntity?.id).toBe('ent_existing');
    expect(rolledBackEntity?.evidence?.length).toBe(1);
    expect(rolledBackEntity?.evidence?.[0].docId).toBe('doc_orig');

    // New entity Fibonacci Heap must be completely removed
    expect(graphStore.findEntityByName('Fibonacci Heap')).toBeUndefined();
  });
});
