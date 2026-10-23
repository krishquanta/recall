import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/index';
import { GraphStore, graphStore } from '../../src/store/GraphStore';
import { AuditStore, auditStore } from '../../src/store/AuditStore';
import { AuditService, auditService, TopologicalInvariantError } from '../../src/services/AuditService';
import {
  RelationshipCurationService,
  relationshipCurationService,
} from '../../src/services/RelationshipCurationService';
import {
  RelationshipEdge,
  EntityNode,
  EvidenceRef,
  RelationType,
} from '../../src/types/graph';

describe('RelationshipCurationService & Curation REST API Test Suite', () => {
  const testDir = path.join(
    process.cwd(),
    `test-curation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const testAuditPath = path.join(testDir, 'audit_log.jsonl');
  const testGraphPath = path.join(testDir, 'graph.json');

  let localGraphStore: GraphStore;
  let localAuditStore: AuditStore;
  let localAuditService: AuditService;
  let localCurationService: RelationshipCurationService;

  const mockEvidence: EvidenceRef = {
    docId: 'doc_cell_biology',
    chunkId: 'chunk_101',
    filename: 'cell_biology.pdf',
    page: 45,
    exactQuote: 'Mitochondria generate ATP through oxidative phosphorylation.',
    charOffset: { start: 100, end: 161 },
  };

  const createBaseEdge = (id: string, s = 'ent_mito', t = 'ent_atp'): RelationshipEdge => ({
    id,
    sourceId: s,
    targetId: t,
    relationType: 'CAUSES',
    description: 'Mitochondria causes ATP generation',
    confidence: 0.9,
    evidence: mockEvidence,
    createdAt: 1000,
    curationStatus: 'proposed',
  });

  const setupEndpoints = (store: GraphStore, s = 'ent_mito', t = 'ent_atp') => {
    const nodeA: EntityNode = {
      id: s,
      name: 'Mitochondria',
      type: 'Concept',
      aliases: ['Chondriosome'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1000,
      updatedAt: 1000,
    };
    const nodeB: EntityNode = {
      id: t,
      name: 'ATP',
      type: 'Concept',
      aliases: ['Adenosine Triphosphate'],
      status: 'active',
      evidence: [mockEvidence],
      createdAt: 1000,
      updatedAt: 1000,
    };
    store.addEntity(nodeA);
    store.addEntity(nodeB);
  };

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    if (fs.existsSync(testAuditPath)) fs.unlinkSync(testAuditPath);
    if (fs.existsSync(testGraphPath)) fs.unlinkSync(testGraphPath);

    localGraphStore = new GraphStore(testGraphPath);
    localAuditStore = new AuditStore(testAuditPath);
    localAuditService = new AuditService(localAuditStore, localGraphStore);
    localCurationService = new RelationshipCurationService(localGraphStore, localAuditService);

    setupEndpoints(localGraphStore);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testAuditPath)) fs.unlinkSync(testAuditPath);
      if (fs.existsSync(testGraphPath)) fs.unlinkSync(testGraphPath);
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore transient cleanup races on Windows
    }
  });

  // =========================================================================
  // SUITE 1: Edge Acceptance
  // =========================================================================
  describe('1. Edge Acceptance (action: "accept")', () => {
    it('transitions proposed edge to verified and records curatedAt timestamp', async () => {
      const edge = createBaseEdge('edge_acc_1');
      localGraphStore.addEdge(edge);

      const beforeCurateTime = Date.now();
      const result = await localCurationService.curateEdge('edge_acc_1', {
        action: 'accept',
        reason: 'Confirmed by textbook',
      });

      expect(result.edge.curationStatus).toBe('verified');
      expect(result.edge.curatedAt).toBeGreaterThanOrEqual(beforeCurateTime);
      expect(result.edge.curationReason).toBe('Confirmed by textbook');

      // Check store persistence
      const inStore = localGraphStore.getEdge('edge_acc_1');
      expect(inStore?.curationStatus).toBe('verified');
      expect(inStore?.curationReason).toBe('Confirmed by textbook');
    });

    it('preserves exactQuote, docId, and offsets with zero alteration', async () => {
      const edge = createBaseEdge('edge_acc_prov');
      localGraphStore.addEdge(edge);

      const result = await localCurationService.curateEdge('edge_acc_prov', { action: 'accept' });
      expect(result.edge.evidence.docId).toBe(mockEvidence.docId);
      expect(result.edge.evidence.exactQuote).toBe(mockEvidence.exactQuote);
      expect(result.edge.evidence.charOffset).toEqual(mockEvidence.charOffset);
    });

    it('emits edge_curate_accept audit log record with valid diffs', async () => {
      const edge = createBaseEdge('edge_acc_audit');
      localGraphStore.addEdge(edge);

      const result = await localCurationService.curateEdge('edge_acc_audit', {
        action: 'accept',
        reason: 'Verified',
      });

      expect(result.auditEntry.action).toBe('edge_curate_accept');
      expect(result.auditEntry.targetId).toBe('edge_acc_audit');
      expect(result.auditEntry.beforeState.curationStatus).toBe('proposed');
      expect(result.auditEntry.afterState.curationStatus).toBe('verified');
      expect(result.auditEntry.sourceDocId).toBe(mockEvidence.docId);

      // Verify on disk
      const lines = fs.readFileSync(testAuditPath, 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.auditId).toBe(result.auditEntry.auditId);
    });

    it('records optional human curation reason in both edge and audit record', async () => {
      const edge = createBaseEdge('edge_acc_reason');
      localGraphStore.addEdge(edge);

      const result = await localCurationService.curateEdge('edge_acc_reason', {
        action: 'accept',
        reason: 'Verified against Chapter 4 Section 2',
      });

      expect(result.edge.curationReason).toBe('Verified against Chapter 4 Section 2');
      expect(result.auditEntry.reason).toBe('Verified against Chapter 4 Section 2');
    });

    it('supports direct convenience method acceptEdge', async () => {
      const edge = createBaseEdge('edge_acc_conv');
      localGraphStore.addEdge(edge);

      const accepted = await localCurationService.acceptEdge('edge_acc_conv', 'Quick accept');
      expect(accepted.curationStatus).toBe('verified');
      expect(accepted.curationReason).toBe('Quick accept');
    });
  });

  // =========================================================================
  // SUITE 2: Edge Rejection & Search Isolation
  // =========================================================================
  describe('2. Edge Rejection & Search Isolation (action: "reject")', () => {
    it('transitions edge status to rejected and stores rejection reason', async () => {
      const edge = createBaseEdge('edge_rej_1');
      localGraphStore.addEdge(edge);

      const result = await localCurationService.curateEdge('edge_rej_1', {
        action: 'reject',
        reason: 'Hallucinated relationship',
      });

      expect(result.edge.curationStatus).toBe('rejected');
      expect(result.edge.curationReason).toBe('Hallucinated relationship');
      expect(localGraphStore.getEdge('edge_rej_1')?.curationStatus).toBe('rejected');
    });

    it('soft-delete persistence: rejected edge remains in store for audit and visualization', async () => {
      const edge = createBaseEdge('edge_rej_persist');
      localGraphStore.addEdge(edge);

      await localCurationService.rejectEdge('edge_rej_persist', 'Soft delete check');

      const allEdges = localGraphStore.getAll().edges;
      expect(allEdges.some((e) => e.id === 'edge_rej_persist')).toBe(true);
      expect(allEdges.find((e) => e.id === 'edge_rej_persist')?.curationStatus).toBe('rejected');
    });

    it('search isolation: getSubgraph completely excludes rejected edges from traversal', async () => {
      const activeEdge = createBaseEdge('edge_active', 'ent_mito', 'ent_atp');
      const rejectedEdge = createBaseEdge('edge_spurious', 'ent_mito', 'ent_spurious');

      localGraphStore.addEntity({
        id: 'ent_spurious',
        name: 'Spurious Concept',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: 1000,
        updatedAt: 1000,
      });

      localGraphStore.addEdge(activeEdge);
      localGraphStore.addEdge(rejectedEdge);

      // Reject second edge
      await localCurationService.rejectEdge('edge_spurious', 'Reject for search test');

      // Query neighborhood of ent_mito
      const subgraph = localGraphStore.getSubgraph(['ent_mito'], 1);

      // Active edge included, rejected edge excluded
      expect(subgraph.edges.some((e) => e.id === 'edge_active')).toBe(true);
      expect(subgraph.edges.some((e) => e.id === 'edge_spurious')).toBe(false);
      // Spurious target node not reached through rejected edge
      expect(subgraph.nodes.some((n) => n.id === 'ent_spurious')).toBe(false);
    });

    it('getSubgraph with includeRejected: true includes rejected edges for visualization', async () => {
      const activeEdge = createBaseEdge('edge_active_vis', 'ent_mito', 'ent_atp');
      const rejectedEdge = createBaseEdge('edge_rej_vis', 'ent_mito', 'ent_spurious_vis');

      localGraphStore.addEntity({
        id: 'ent_spurious_vis',
        name: 'Spurious Vis Concept',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: 1000,
        updatedAt: 1000,
      });

      localGraphStore.addEdge(activeEdge);
      localGraphStore.addEdge(rejectedEdge);

      await localCurationService.rejectEdge('edge_rej_vis', 'Reject for vis test');

      const fullSubgraph = localGraphStore.getSubgraph(['ent_mito'], 1, { includeRejected: true });
      expect(fullSubgraph.edges.some((e) => e.id === 'edge_rej_vis')).toBe(true);
      expect(fullSubgraph.nodes.some((n) => n.id === 'ent_spurious_vis')).toBe(true);
    });

    it('emits edge_curate_reject audit record', async () => {
      const edge = createBaseEdge('edge_rej_audit');
      localGraphStore.addEdge(edge);

      await localCurationService.rejectEdge('edge_rej_audit', 'Audit reject');
      const history = await localAuditService.getEntries({ targetId: 'edge_rej_audit' });

      expect(history.length).toBe(1);
      expect(history[0].action).toBe('edge_curate_reject');
      expect(history[0].afterState.curationStatus).toBe('rejected');
    });

    it('supports direct convenience method rejectEdge', async () => {
      const edge = createBaseEdge('edge_rej_conv');
      localGraphStore.addEdge(edge);

      const rejected = await localCurationService.rejectEdge('edge_rej_conv', 'Quick reject');
      expect(rejected.curationStatus).toBe('rejected');
      expect(rejected.curationReason).toBe('Quick reject');
    });
  });

  // =========================================================================
  // SUITE 3: Edge Correction
  // =========================================================================
  describe('3. Edge Correction (action: "correct")', () => {
    it('modifies relationType and preserves originalRelationType on first correction', async () => {
      const edge = createBaseEdge('edge_cor_type');
      edge.relationType = 'DEFINES';
      localGraphStore.addEdge(edge);

      const res = await localCurationService.curateEdge('edge_cor_type', {
        action: 'correct',
        relationType: 'PART_OF',
        reason: 'Type fix',
      });

      expect(res.edge.relationType).toBe('PART_OF');
      expect(res.edge.originalRelationType).toBe('DEFINES');
      expect(res.edge.curationStatus).toBe('corrected');

      // Second correction maintains original DEFINES
      const res2 = await localCurationService.curateEdge('edge_cor_type', {
        action: 'correct',
        relationType: 'USES',
      });
      expect(res2.edge.relationType).toBe('USES');
      expect(res2.edge.originalRelationType).toBe('DEFINES');
    });

    it('inverts direction and rewires GraphStore incident indices correctly', async () => {
      const edge = createBaseEdge('edge_cor_invert', 'ent_mito', 'ent_atp');
      localGraphStore.addEdge(edge);

      // Prior index check
      const preMito = localGraphStore.getIncidentEdges('ent_mito');
      const preAtp = localGraphStore.getIncidentEdges('ent_atp');
      expect(preMito.outgoing.some((e) => e.id === 'edge_cor_invert')).toBe(true);
      expect(preAtp.incoming.some((e) => e.id === 'edge_cor_invert')).toBe(true);

      // Invert
      const res = await localCurationService.curateEdge('edge_cor_invert', {
        action: 'correct',
        invertDirection: true,
        reason: 'Swapping arrow direction',
      });

      expect(res.edge.sourceId).toBe('ent_atp');
      expect(res.edge.targetId).toBe('ent_mito');

      // Post index check: ent_atp now has outgoing, ent_mito has incoming
      const postMito = localGraphStore.getIncidentEdges('ent_mito');
      const postAtp = localGraphStore.getIncidentEdges('ent_atp');
      expect(postAtp.outgoing.some((e) => e.id === 'edge_cor_invert')).toBe(true);
      expect(postMito.incoming.some((e) => e.id === 'edge_cor_invert')).toBe(true);
      expect(postMito.outgoing.some((e) => e.id === 'edge_cor_invert')).toBe(false);
    });

    it('double direction inversion restores original endpoints', async () => {
      const edge = createBaseEdge('edge_dbl_inv', 'ent_mito', 'ent_atp');
      localGraphStore.addEdge(edge);

      await localCurationService.correctEdge('edge_dbl_inv', { invertDirection: true });
      const e1 = localGraphStore.getEdge('edge_dbl_inv');
      expect(e1?.sourceId).toBe('ent_atp');

      await localCurationService.correctEdge('edge_dbl_inv', { invertDirection: true });
      const e2 = localGraphStore.getEdge('edge_dbl_inv');
      expect(e2?.sourceId).toBe('ent_mito');
      expect(e2?.targetId).toBe('ent_atp');
    });

    it('updates edge description and records audit entry', async () => {
      const edge = createBaseEdge('edge_cor_desc');
      localGraphStore.addEdge(edge);

      const res = await localCurationService.correctEdge('edge_cor_desc', {
        description: 'New refined scientific description',
        reason: 'Improved clarity',
      });

      expect(res.description).toBe('New refined scientific description');
      expect(res.curationReason).toBe('Improved clarity');
    });

    it('supports direct convenience method correctEdge', async () => {
      const edge = createBaseEdge('edge_cor_conv');
      localGraphStore.addEdge(edge);

      const corrected = await localCurationService.correctEdge('edge_cor_conv', {
        relationType: 'PROVES',
        reason: 'Conv correct',
      });
      expect(corrected.relationType).toBe('PROVES');
      expect(corrected.curationStatus).toBe('corrected');
    });
  });

  // =========================================================================
  // SUITE 4: Atomic Rollback Integration
  // =========================================================================
  describe('4. Atomic Audit Rollback (AuditService.rollback)', () => {
    it('rolls back edge accept, restoring proposed curationStatus', async () => {
      const edge = createBaseEdge('edge_roll_acc');
      localGraphStore.addEdge(edge);

      const curateRes = await localCurationService.curateEdge('edge_roll_acc', { action: 'accept' });
      expect(localGraphStore.getEdge('edge_roll_acc')?.curationStatus).toBe('verified');

      const rollbackRes = await localAuditService.rollback(curateRes.auditEntry.auditId);
      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.targetId).toBe('edge_roll_acc');

      const restoredEdge = localGraphStore.getEdge('edge_roll_acc');
      expect(restoredEdge?.curationStatus).toBe('proposed');
    });

    it('rolls back edge rejection, re-enabling edge in getSubgraph search traversals', async () => {
      const edge = createBaseEdge('edge_roll_rej');
      localGraphStore.addEdge(edge);

      const curateRes = await localCurationService.curateEdge('edge_roll_rej', { action: 'reject' });
      expect(localGraphStore.getSubgraph(['ent_mito']).edges.length).toBe(0);

      // Rollback
      await localAuditService.rollback(curateRes.auditEntry.auditId);

      const restored = localGraphStore.getEdge('edge_roll_rej');
      expect(restored?.curationStatus).toBe('proposed');
      expect(localGraphStore.getSubgraph(['ent_mito']).edges.length).toBe(1);
    });

    it('rolls back direction inversion, restoring initial endpoints and rewiring indices', async () => {
      const edge = createBaseEdge('edge_roll_inv', 'ent_mito', 'ent_atp');
      localGraphStore.addEdge(edge);

      const curateRes = await localCurationService.curateEdge('edge_roll_inv', {
        action: 'correct',
        relationType: 'PART_OF',
        invertDirection: true,
      });

      expect(localGraphStore.getEdge('edge_roll_inv')?.sourceId).toBe('ent_atp');

      // Rollback mutation
      await localAuditService.rollback(curateRes.auditEntry.auditId);

      const restored = localGraphStore.getEdge('edge_roll_inv');
      expect(restored?.sourceId).toBe('ent_mito');
      expect(restored?.targetId).toBe('ent_atp');
      expect(restored?.relationType).toBe('CAUSES');

      // Indices rewired back
      const mitoInc = localGraphStore.getIncidentEdges('ent_mito');
      expect(mitoInc.outgoing.some((e) => e.id === 'edge_roll_inv')).toBe(true);
    });

    it('guards against double rollback of the same curation action', async () => {
      const edge = createBaseEdge('edge_roll_dbl');
      localGraphStore.addEdge(edge);

      const curateRes = await localCurationService.curateEdge('edge_roll_dbl', { action: 'accept' });
      await localAuditService.rollback(curateRes.auditEntry.auditId);

      await expect(
        localAuditService.rollback(curateRes.auditEntry.auditId)
      ).rejects.toThrow(/already been rolled back/i);
    });

    it('throws TopologicalInvariantError if restored endpoint is missing or merged', async () => {
      const edge = createBaseEdge('edge_roll_orphan', 'ent_mito', 'ent_orphan');
      localGraphStore.addEntity({
        id: 'ent_orphan',
        name: 'Orphan Node',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: 1000,
        updatedAt: 1000,
      });
      localGraphStore.addEdge(edge);

      const curateRes = await localCurationService.curateEdge('edge_roll_orphan', { action: 'accept' });

      // Delete endpoint node to violate topological invariant
      localGraphStore.deleteEntity('ent_orphan');

      await expect(
        localAuditService.rollback(curateRes.auditEntry.auditId)
      ).rejects.toThrow(TopologicalInvariantError);
    });
  });

  // =========================================================================
  // SUITE 5: Boundary & Error Handling
  // =========================================================================
  describe('5. Boundary Conditions & Error Handling', () => {
    it('throws error / returns 404 when curating non-existent edge', async () => {
      await expect(
        localCurationService.curateEdge('edge_non_existent', { action: 'accept' })
      ).rejects.toThrow(/not found/i);
    });

    it('throws validation error for invalid curation action', async () => {
      const edge = createBaseEdge('edge_err_action');
      localGraphStore.addEdge(edge);

      await expect(
        localCurationService.curateEdge('edge_err_action', { action: 'destroy' as any })
      ).rejects.toThrow(/invalid/i);
    });

    it('throws validation error for invalid relationType', async () => {
      const edge = createBaseEdge('edge_err_type');
      localGraphStore.addEdge(edge);

      await expect(
        localCurationService.curateEdge('edge_err_type', {
          action: 'correct',
          relationType: 'INVALID_TYPE' as any,
        })
      ).rejects.toThrow(/invalid/i);
    });

    it('throws error when edgeId is empty or whitespace', async () => {
      await expect(
        localCurationService.curateEdge('   ', { action: 'accept' })
      ).rejects.toThrow(/required/i);
    });

    it('handles extremely long curation reason (>5,000 characters) safely', async () => {
      const edge = createBaseEdge('edge_huge_reason');
      localGraphStore.addEdge(edge);

      const hugeReason = 'Detailed scientific explanation: '.repeat(200);
      const res = await localCurationService.curateEdge('edge_huge_reason', {
        action: 'accept',
        reason: hugeReason,
      });

      expect(res.edge.curationReason?.length).toBeGreaterThan(5000);
      expect(res.auditEntry.reason?.length).toBeGreaterThan(5000);
    });
  });

  // =========================================================================
  // SUITE 6: REST API Supertest Integration
  // =========================================================================
  describe('6. REST API Supertest Route Integration (POST /api/graph/relationships/:id/curate)', () => {
    const runtimeEdgeId = `edge_api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    beforeEach(() => {
      // Seed active graphStore used by express app
      setupEndpoints(graphStore, 'node_api_1', 'node_api_2');
      const edge: RelationshipEdge = {
        id: runtimeEdgeId,
        sourceId: 'node_api_1',
        targetId: 'node_api_2',
        relationType: 'DEFINES',
        description: 'Initial definition',
        confidence: 0.9,
        evidence: mockEvidence,
        createdAt: Date.now(),
        curationStatus: 'proposed',
      };
      graphStore.addEdge(edge);
    });

    it('POST /api/graph/relationships/:id/curate accepts edge and returns 200', async () => {
      const res = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({ action: 'accept', reason: 'API Accept Test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ok).toBe(true);
      expect(res.body.edge.id).toBe(runtimeEdgeId);
      expect(res.body.edge.curationStatus).toBe('verified');
      expect(res.body.auditEntry.action).toBe('edge_curate_accept');
    });

    it('POST /api/graph/relationships/:id/curate rejects edge and returns 200', async () => {
      const res = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({ action: 'reject', reason: 'API Reject Test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.edge.curationStatus).toBe('rejected');
    });

    it('POST /api/graph/relationships/:id/curate corrects edge type and inverts direction', async () => {
      const res = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({
          action: 'correct',
          relationType: 'PART_OF',
          invertDirection: true,
          reason: 'API Correct Invert Test',
        });

      expect(res.status).toBe(200);
      expect(res.body.edge.curationStatus).toBe('corrected');
      expect(res.body.edge.relationType).toBe('PART_OF');
      expect(res.body.edge.originalRelationType).toBe('DEFINES');
      expect(res.body.edge.sourceId).toBe('node_api_2');
      expect(res.body.edge.targetId).toBe('node_api_1');
    });

    it('POST /api/graph/curate/:id convenience alias works identically', async () => {
      const res = await request(app)
        .post(`/api/graph/curate/${runtimeEdgeId}`)
        .send({ action: 'accept', reason: 'Convenience Alias Test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.edge.curationStatus).toBe('verified');
    });

    it('POST returns 404 for unknown edge ID', async () => {
      const res = await request(app)
        .post('/api/graph/relationships/missing_uuid_9999/curate')
        .send({ action: 'accept' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('POST returns 400 for invalid action', async () => {
      const res = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({ action: 'disapprove' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/action/i);
    });

    it('POST returns 400 for invalid relationType in correct action', async () => {
      const res = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({ action: 'correct', relationType: 'NON_EXISTENT_RELATION' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/relationType/i);
    });

    it('full end-to-end cycle: Curate -> Query Audit -> Rollback via REST', async () => {
      // 1. Curate (Reject)
      const curateRes = await request(app)
        .post(`/api/graph/relationships/${runtimeEdgeId}/curate`)
        .send({ action: 'reject', reason: 'Accidental reject to revert' });
      expect(curateRes.status).toBe(200);
      const auditId = curateRes.body.auditEntry.auditId;

      // 2. Query Audit Log
      const auditRes = await request(app)
        .get(`/api/graph/audit-log?targetId=${runtimeEdgeId}`);
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.entries.some((e: any) => e.auditId === auditId)).toBe(true);

      // 3. Rollback via REST API
      const rollbackRes = await request(app)
        .post(`/api/graph/audit-log/${auditId}/rollback`)
        .send({ reason: 'Reverting accidental rejection' });
      expect(rollbackRes.status).toBe(200);
      expect(rollbackRes.body.success).toBe(true);

      // 4. Verify edge restored in graphStore
      const restored = graphStore.getEdge(runtimeEdgeId);
      expect(restored?.curationStatus).toBe('proposed');
    });
  });
});
