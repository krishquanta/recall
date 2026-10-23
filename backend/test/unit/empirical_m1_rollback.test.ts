import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/index';
import { AuditStore } from '../../src/store/AuditStore';
import {
  AuditService,
  TopologicalInvariantError,
  AuditEntryAlreadyRolledBackError,
} from '../../src/services/AuditService';
import { GraphStore } from '../../src/store/GraphStore';
import { RelationshipEdge, EntityNode } from '../../src/types';

describe('EMPIRICAL CHALLENGER: Milestone 1 Atomic Rollback Engine Stress Harness', () => {
  const testDir = path.join(
    process.cwd(),
    `empirical-stress-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const testAuditPath = path.join(testDir, 'audit_log.jsonl');
  const testGraphPath = path.join(testDir, 'graph.json');

  let localAuditStore: AuditStore;
  let localGraphStore: GraphStore;
  let localAuditService: AuditService;

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    if (fs.existsSync(testAuditPath)) fs.unlinkSync(testAuditPath);
    if (fs.existsSync(testGraphPath)) fs.unlinkSync(testGraphPath);

    localAuditStore = new AuditStore(testAuditPath);
    localGraphStore = new GraphStore(testGraphPath);
    localAuditService = new AuditService(localAuditStore, localGraphStore);
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

  // Helper to create basic entity nodes
  const createNode = (id: string, name: string, status: 'active' | 'merged' = 'active'): EntityNode => ({
    id,
    name,
    type: 'Concept',
    aliases: [],
    status,
    evidence: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // =========================================================================
  // 1. Relationship Creation Rollback
  // =========================================================================
  describe('1. Relationship creation rollback', () => {
    it('deletes the newly created edge and thoroughly purges incident adjacency index', async () => {
      // Setup graph topology: Nodes A, B, C, D
      localGraphStore.addEntity(createNode('node-A', 'Node Alpha'));
      localGraphStore.addEntity(createNode('node-B', 'Node Beta'));
      localGraphStore.addEntity(createNode('node-C', 'Node Gamma'));
      localGraphStore.addEntity(createNode('node-D', 'Node Delta'));

      // Existing adjacent edges (to verify surrounding topology is preserved)
      const edgeAC: RelationshipEdge = {
        id: 'edge-A-C',
        sourceId: 'node-A',
        targetId: 'node-C',
        relationType: 'PREREQUISITE_FOR',
        description: 'A is required for C',
        confidence: 0.95,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
        curationStatus: 'verified',
      };
      const edgeDB: RelationshipEdge = {
        id: 'edge-D-B',
        sourceId: 'node-D',
        targetId: 'node-B',
        relationType: 'INFLUENCES',
        description: 'D influences B',
        confidence: 0.88,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
        curationStatus: 'verified',
      };
      localGraphStore.addEdge(edgeAC);
      localGraphStore.addEdge(edgeDB);

      // Edge to be created and rolled back
      const edgeNew: RelationshipEdge = {
        id: 'edge-A-B-new',
        sourceId: 'node-A',
        targetId: 'node-B',
        relationType: 'CAUSES',
        description: 'A causes B',
        confidence: 0.82,
        evidence: { docId: 'doc-1', chunkId: 'c2', exactQuote: 'q2', filename: 'f' },
        createdAt: Date.now(),
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(edgeNew);

      // Verify initial state
      expect(localGraphStore.getEdge('edge-A-B-new')).toBeDefined();
      const incAInitial = localGraphStore.getIncidentEdges('node-A');
      const incBInitial = localGraphStore.getIncidentEdges('node-B');
      expect(incAInitial.outgoing.map((e) => e.id).sort()).toEqual(['edge-A-B-new', 'edge-A-C'].sort());
      expect(incBInitial.incoming.map((e) => e.id).sort()).toEqual(['edge-A-B-new', 'edge-D-B'].sort());

      // Record mutation
      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_created',
        targetType: 'relationship',
        targetId: edgeNew.id,
        beforeState: null,
        afterState: edgeNew,
        sourceDocId: 'doc-1',
        reason: 'AI extracted relationship',
      });

      // Execute rollback
      const result = await localAuditService.rollback(auditEntry.auditId);

      // Assertions
      expect(result.success).toBe(true);
      expect(result.restoredAuditId).toBe(auditEntry.auditId);
      expect(result.targetId).toBe(edgeNew.id);

      // Verify edge is completely absent from store
      expect(localGraphStore.getEdge('edge-A-B-new')).toBeUndefined();

      // Verify incident adjacency index cleanup
      const incAPost = localGraphStore.getIncidentEdges('node-A');
      const incBPost = localGraphStore.getIncidentEdges('node-B');
      expect(incAPost.outgoing.map((e) => e.id)).toEqual(['edge-A-C']);
      expect(incBPost.incoming.map((e) => e.id)).toEqual(['edge-D-B']);

      // Ensure inverse audit log entry was appended
      expect(result.actionLogged.action).toBe('rollback');
      expect(result.actionLogged.rollbackRefId).toBe(auditEntry.auditId);
      expect(result.actionLogged.beforeState).toEqual(edgeNew);
      expect(result.actionLogged.afterState).toBeNull();

      // Ensure original audit entry is marked rolledBack
      const marked = await localAuditService.getEntryById(auditEntry.auditId);
      expect(marked?.rolledBack).toBe(true);
      expect(marked?.rolledBackBy).toBe(result.actionLogged.auditId);
    });
  });

  // =========================================================================
  // 2. Relationship Curation Rollback
  // =========================================================================
  describe('2. Relationship curation rollback', () => {
    it('restores original curationStatus, relationType, direction, and incident indices on correction rollback', async () => {
      localGraphStore.addEntity(createNode('node-X', 'Entity X'));
      localGraphStore.addEntity(createNode('node-Y', 'Entity Y'));

      const originalEdge: RelationshipEdge = {
        id: 'edge-xy',
        sourceId: 'node-X',
        targetId: 'node-Y',
        relationType: 'DEFINES',
        description: 'X defines Y',
        confidence: 0.9,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: 1000,
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(originalEdge);

      // Verify initial incident indices
      expect(localGraphStore.getIncidentEdges('node-X').outgoing.map((e) => e.id)).toEqual(['edge-xy']);
      expect(localGraphStore.getIncidentEdges('node-Y').incoming.map((e) => e.id)).toEqual(['edge-xy']);

      // User performs a compound curation: invert direction, alter relationType, update status & reason
      const correctedEdge: RelationshipEdge = {
        ...originalEdge,
        sourceId: 'node-Y', // Inverted direction
        targetId: 'node-X',
        relationType: 'PREVENTS', // Changed type
        curationStatus: 'corrected',
        curatedAt: 2000,
        curationReason: 'Direction was reversed in text',
        originalRelationType: 'DEFINES',
      };
      localGraphStore.updateEdge(originalEdge.id, correctedEdge);

      // Verify updated incident indices before rollback
      expect(localGraphStore.getIncidentEdges('node-Y').outgoing.map((e) => e.id)).toEqual(['edge-xy']);
      expect(localGraphStore.getIncidentEdges('node-X').incoming.map((e) => e.id)).toEqual(['edge-xy']);
      expect(localGraphStore.getIncidentEdges('node-X').outgoing).toEqual([]);
      expect(localGraphStore.getIncidentEdges('node-Y').incoming).toEqual([]);

      // Record curation audit entry
      const auditEntry = await localAuditService.recordMutation({
        action: 'edge_curate_correct',
        targetType: 'relationship',
        targetId: originalEdge.id,
        beforeState: originalEdge,
        afterState: correctedEdge,
        reason: 'User inverted direction and corrected relationType',
      });

      // Rollback the curation
      const rollbackResult = await localAuditService.rollback(auditEntry.auditId);
      expect(rollbackResult.success).toBe(true);

      // Verify GraphStore state is restored exactly
      const restored = localGraphStore.getEdge(originalEdge.id);
      expect(restored).toBeDefined();
      expect(restored?.sourceId).toBe('node-X');
      expect(restored?.targetId).toBe('node-Y');
      expect(restored?.relationType).toBe('DEFINES');
      expect(restored?.curationStatus).toBe('proposed');
      expect(restored?.curationReason).toBeUndefined();

      // Verify incident adjacency indices are restored
      expect(localGraphStore.getIncidentEdges('node-X').outgoing.map((e) => e.id)).toEqual(['edge-xy']);
      expect(localGraphStore.getIncidentEdges('node-Y').incoming.map((e) => e.id)).toEqual(['edge-xy']);
      expect(localGraphStore.getIncidentEdges('node-Y').outgoing).toEqual([]);
      expect(localGraphStore.getIncidentEdges('node-X').incoming).toEqual([]);
    });

    it('restores original curationStatus on accept and reject rollbacks', async () => {
      localGraphStore.addEntity(createNode('n1', 'N1'));
      localGraphStore.addEntity(createNode('n2', 'N2'));

      const edge: RelationshipEdge = {
        id: 'edge-acc-rej',
        sourceId: 'n1',
        targetId: 'n2',
        relationType: 'USES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: 1000,
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(edge);

      // 1. Accept curation
      const verifiedEdge = { ...edge, curationStatus: 'verified' as const, curatedAt: 1500 };
      localGraphStore.updateEdge(edge.id, verifiedEdge);
      const acceptAudit = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: edge,
        afterState: verifiedEdge,
      });

      await localAuditService.rollback(acceptAudit.auditId);
      expect(localGraphStore.getEdge(edge.id)?.curationStatus).toBe('proposed');

      // 2. Reject curation
      const rejectedEdge = { ...edge, curationStatus: 'rejected' as const, curatedAt: 2500 };
      localGraphStore.updateEdge(edge.id, rejectedEdge);
      const rejectAudit = await localAuditService.recordMutation({
        action: 'edge_curate_reject',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: edge,
        afterState: rejectedEdge,
      });

      await localAuditService.rollback(rejectAudit.auditId);
      expect(localGraphStore.getEdge(edge.id)?.curationStatus).toBe('proposed');
    });
  });

  // =========================================================================
  // 3. Cascading Rollback Involution: Rollback(Rollback(X)) == X
  // =========================================================================
  describe('3. Cascading rollback involution: Rollback(Rollback(X)) == X', () => {
    it(
      'CHALLENGER FAILURE FINDING 1: entryX is not reactivated because markRolledBack clobbers rollbackRefId',
      async () => {
        localGraphStore.addEntity(createNode('n-inv-1', 'Inv 1'));
        localGraphStore.addEntity(createNode('n-inv-2', 'Inv 2'));

        const state0: RelationshipEdge = {
          id: 'edge-involution',
          sourceId: 'n-inv-1',
          targetId: 'n-inv-2',
          relationType: 'CAUSES',
          description: 'Initial State 0',
          confidence: 0.8,
          evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
          createdAt: 1000,
          curationStatus: 'proposed',
        };
        localGraphStore.addEdge(state0);

        const state1: RelationshipEdge = {
          ...state0,
          sourceId: 'n-inv-2',
          targetId: 'n-inv-1',
          relationType: 'PREVENTS',
          curationStatus: 'corrected',
          curatedAt: 2000,
        };
        localGraphStore.updateEdge(state0.id, state1);

        const auditX = await localAuditService.recordMutation({
          action: 'edge_curate_correct',
          targetType: 'relationship',
          targetId: state0.id,
          beforeState: state0,
          afterState: state1,
          reason: 'Curation mutation X',
        });

        // 1. First Rollback: Rollback(X) -> restores State 0
        const rb1 = await localAuditService.rollback(auditX.auditId);
        expect(rb1.success).toBe(true);
        expect(localGraphStore.getEdge(state0.id)).toEqual(state0);

        // 2. Second Rollback: Rollback(Rollback(X)) -> restores State 1
        const rb2 = await localAuditService.rollback(rb1.actionLogged.auditId);
        expect(rb2.success).toBe(true);
        expect(localGraphStore.getEdge(state0.id)).toEqual(state1);

        // EXPECTED BY SPECIFICATION: entryX should be reactivated (unmarked rolledBack: false)
        // BUG EMPIRICALLY CONFIRMED: entryXReactivated.rolledBack is true because markRolledBack clobbers rollbackRefId!
        const entryXReactivated = await localAuditService.getEntryById(auditX.auditId);
        expect(entryXReactivated?.rolledBack).toBe(false);
      }
    );

    it('satisfies algebraic involution property for relationship creation', async () => {
      localGraphStore.addEntity(createNode('s-cr', 'Source Cr'));
      localGraphStore.addEntity(createNode('t-cr', 'Target Cr'));

      const edgeCreated: RelationshipEdge = {
        id: 'edge-cr-inv',
        sourceId: 's-cr',
        targetId: 't-cr',
        relationType: 'CONTAINS',
        description: 'New edge',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: 1000,
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(edgeCreated);

      const auditCreated = await localAuditService.recordMutation({
        action: 'relationship_created',
        targetType: 'relationship',
        targetId: edgeCreated.id,
        beforeState: null,
        afterState: edgeCreated,
      });

      // Rollback(creation) -> deletes edge
      const rb1 = await localAuditService.rollback(auditCreated.auditId);
      expect(localGraphStore.getEdge(edgeCreated.id)).toBeUndefined();

      // Rollback(Rollback(creation)) -> recreates edge!
      const rb2 = await localAuditService.rollback(rb1.actionLogged.auditId);
      expect(rb2.success).toBe(true);
      expect(localGraphStore.getEdge(edgeCreated.id)).toEqual(edgeCreated);
    });

    it(
      'CHALLENGER FAILURE FINDING 2: Rollback(Rollback(deletion)) fails to delete edge because beforeState === null is ignored in applyReversionInMemory',
      async () => {
        localGraphStore.addEntity(createNode('s-del', 'Source Del'));
        localGraphStore.addEntity(createNode('t-del', 'Target Del'));

        const edgeDel: RelationshipEdge = {
          id: 'edge-del-inv',
          sourceId: 's-del',
          targetId: 't-del',
          relationType: 'CONTAINS',
          description: 'Deleted edge',
          confidence: 0.9,
          evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
          createdAt: 1000,
          curationStatus: 'proposed',
        };
        localGraphStore.addEdge(edgeDel);

        // Simulate deletion
        localGraphStore.deleteEdge(edgeDel.id);
        const auditDel = await localAuditService.recordMutation({
          action: 'relationship_deleted',
          targetType: 'relationship',
          targetId: edgeDel.id,
          beforeState: edgeDel,
          afterState: null,
        });

        // Rollback(deletion) -> restores edge
        const rb1 = await localAuditService.rollback(auditDel.auditId);
        expect(localGraphStore.getEdge(edgeDel.id)).toBeDefined();

        // Rollback(Rollback(deletion)) -> should re-delete edge
        const rb2 = await localAuditService.rollback(rb1.actionLogged.auditId);
        expect(rb2.success).toBe(true);

        const edgeAfterRollbackRollback = localGraphStore.getEdge(edgeDel.id);
        // EXPECTED BY SPECIFICATION: edge should be deleted again (undefined)
        // BUG EMPIRICALLY CONFIRMED: edge remains in graphStore because applyReversionInMemory only checks if (beforeState)
        expect(edgeAfterRollbackRollback).toBeUndefined();
      }
    );
  });

  // =========================================================================
  // 4. Blocked Duplicate Rollback
  // =========================================================================
  describe('4. Blocked duplicate rollback', () => {
    it('throws AuditEntryAlreadyRolledBackError when attempting duplicate rollback in service', async () => {
      localGraphStore.addEntity(createNode('node-dup-1', 'Dup 1'));
      localGraphStore.addEntity(createNode('node-dup-2', 'Dup 2'));

      const edge: RelationshipEdge = {
        id: 'edge-dup-test',
        sourceId: 'node-dup-1',
        targetId: 'node-dup-2',
        relationType: 'USES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(edge);

      const entry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: edge,
        afterState: { ...edge, curationStatus: 'verified' },
      });

      // First rollback succeeds
      const firstRollback = await localAuditService.rollback(entry.auditId);
      expect(firstRollback.success).toBe(true);

      // Second rollback throws AuditEntryAlreadyRolledBackError
      await expect(localAuditService.rollback(entry.auditId)).rejects.toThrow(
        AuditEntryAlreadyRolledBackError
      );
      await expect(localAuditService.rollback(entry.auditId)).rejects.toThrow(
        /already been rolled back/i
      );
    });

    it('rejects duplicate rollback via REST API with HTTP 400', async () => {
      // Use active app endpoint
      const res1 = await request(app)
        .post('/api/graph/audit-log/any-mock-id/rollback')
        .send({ reason: 'Revert test' });
      // Non-existent entry returns 404
      expect(res1.status).toBe(404);

      // Now create an actual entry in runtime auditStore and test duplicate rollback
      const { auditService: runtimeAuditService } = await import('../../src/services/AuditService');
      const entry = await runtimeAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-http-dup',
        beforeState: { id: 'edge-http-dup', curationStatus: 'proposed' },
        afterState: { id: 'edge-http-dup', curationStatus: 'verified' },
      });

      // First API rollback -> 200
      const apiRes1 = await request(app)
        .post(`/api/graph/audit-log/${entry.auditId}/rollback`)
        .send({ reason: 'First API rollback' });
      expect(apiRes1.status).toBe(200);
      expect(apiRes1.body.success).toBe(true);

      // Duplicate API rollback -> 400
      const apiRes2 = await request(app)
        .post(`/api/graph/audit-log/${entry.auditId}/rollback`)
        .send({ reason: 'Second duplicate API rollback' });
      expect(apiRes2.status).toBe(400);
      expect(apiRes2.body.error).toMatch(/already been rolled back/i);
    });

    it('guards against concurrent race condition on duplicate rollback via AsyncMutex', async () => {
      localGraphStore.addEntity(createNode('s-race', 'Source Race'));
      localGraphStore.addEntity(createNode('t-race', 'Target Race'));

      const edge: RelationshipEdge = {
        id: 'edge-race',
        sourceId: 's-race',
        targetId: 't-race',
        relationType: 'USES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
        curationStatus: 'proposed',
      };
      localGraphStore.addEdge(edge);

      const entry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: edge,
        afterState: { ...edge, curationStatus: 'verified' },
      });

      // Launch 10 concurrent rollback requests for the same auditId
      const promises = Array.from({ length: 10 }, () =>
        localAuditService.rollback(entry.auditId)
      );

      const settled = await Promise.allSettled(promises);

      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed, and exactly 9 must fail with AuditEntryAlreadyRolledBackError
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(9);

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason.name).toBe('AuditEntryAlreadyRolledBackError');
          expect(rej.reason.message).toMatch(/already been rolled back/i);
        }
      }
    });
  });

  // =========================================================================
  // 5. Topological Invariant Enforcement
  // =========================================================================
  describe('5. Topological invariant enforcement', () => {
    it('blocks restoring an edge when source endpoint node was deleted with ERR_ORPHAN_SOURCE_NODE', async () => {
      localGraphStore.addEntity(createNode('node-live-target', 'Target Live'));

      const edgeOrphanSource: RelationshipEdge = {
        id: 'edge-orphan-source',
        sourceId: 'node-deleted-source', // Missing from store
        targetId: 'node-live-target',
        relationType: 'CAUSES',
        description: 'Broken edge',
        confidence: 0.85,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edgeOrphanSource.id,
        beforeState: edgeOrphanSource,
        afterState: null,
      });

      // Rollback must fail
      let thrownError: any = null;
      try {
        await localAuditService.rollback(auditEntry.auditId);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TopologicalInvariantError);
      expect(thrownError.code).toBe('ERR_ORPHAN_SOURCE_NODE');
      expect(thrownError.message).toContain('Source entity "node-deleted-source" does not exist');

      // Invariant check: ZERO orphan edges remain in store
      expect(localGraphStore.getEdge('edge-orphan-source')).toBeUndefined();
      expect(localGraphStore.getIncidentEdges('node-live-target').incoming).toEqual([]);

      // Invariant check: Audit entry remains NOT rolled back
      const entry = await localAuditService.getEntryById(auditEntry.auditId);
      expect(entry?.rolledBack).toBe(false);
    });

    it('blocks restoring an edge when target endpoint node was deleted with ERR_ORPHAN_TARGET_NODE', async () => {
      localGraphStore.addEntity(createNode('node-live-source', 'Source Live'));

      const edgeOrphanTarget: RelationshipEdge = {
        id: 'edge-orphan-target',
        sourceId: 'node-live-source',
        targetId: 'node-deleted-target', // Missing from store
        relationType: 'CAUSES',
        description: 'Broken edge',
        confidence: 0.85,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edgeOrphanTarget.id,
        beforeState: edgeOrphanTarget,
        afterState: null,
      });

      let thrownError: any = null;
      try {
        await localAuditService.rollback(auditEntry.auditId);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TopologicalInvariantError);
      expect(thrownError.code).toBe('ERR_ORPHAN_TARGET_NODE');
      expect(thrownError.message).toContain('Target entity "node-deleted-target" does not exist');

      // Zero orphan edges
      expect(localGraphStore.getEdge('edge-orphan-target')).toBeUndefined();
      expect(localGraphStore.getIncidentEdges('node-live-source').outgoing).toEqual([]);
    });

    it('blocks restoring an edge when endpoint node status is "merged" with informative error', async () => {
      // Create source and merged target
      localGraphStore.addEntity(createNode('node-alpha', 'Alpha Live'));
      localGraphStore.addEntity(createNode('node-beta-merged', 'Beta Merged', 'merged'));

      const edgeToMerged: RelationshipEdge = {
        id: 'edge-to-merged',
        sourceId: 'node-alpha',
        targetId: 'node-beta-merged',
        relationType: 'USES',
        description: 'Points to merged entity',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edgeToMerged.id,
        beforeState: edgeToMerged,
        afterState: null,
      });

      let thrownError: any = null;
      try {
        await localAuditService.rollback(auditEntry.auditId);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TopologicalInvariantError);
      expect(thrownError.code).toBe('ERR_ORPHAN_TARGET_NODE');
      expect(thrownError.message).toContain('has been merged');

      // Zero orphan edges
      expect(localGraphStore.getEdge('edge-to-merged')).toBeUndefined();
      expect(localGraphStore.getIncidentEdges('node-alpha').outgoing).toEqual([]);
    });

    it('blocks restoring a self-loop relationship edge with ERR_SELF_LOOP_DISALLOWED', async () => {
      localGraphStore.addEntity(createNode('node-self', 'Self Node'));

      const selfLoopEdge: RelationshipEdge = {
        id: 'edge-self-loop',
        sourceId: 'node-self',
        targetId: 'node-self', // Invalid self-loop
        relationType: 'CAUSES',
        description: 'Self-loop',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: selfLoopEdge.id,
        beforeState: selfLoopEdge,
        afterState: null,
      });

      let thrownError: any = null;
      try {
        await localAuditService.rollback(auditEntry.auditId);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TopologicalInvariantError);
      expect(thrownError.code).toBe('ERR_SELF_LOOP_DISALLOWED');
      expect(thrownError.message).toContain('Restored edge would create an invalid self-loop');

      // Invariant check: zero orphan or self-loop edges in store
      expect(localGraphStore.getEdge('edge-self-loop')).toBeUndefined();
    });

    it('REST API returns HTTP 400 when rollback violates topological invariants', async () => {
      const { auditService: runtimeAuditService } = await import('../../src/services/AuditService');

      const orphanEdge: RelationshipEdge = {
        id: 'edge-rest-orphan',
        sourceId: 'non-existent-source',
        targetId: 'non-existent-target',
        relationType: 'CAUSES',
        description: 'REST orphan test',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const entry = await runtimeAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: orphanEdge.id,
        beforeState: orphanEdge,
        afterState: null,
      });

      const res = await request(app)
        .post(`/api/graph/audit-log/${entry.auditId}/rollback`)
        .send({ reason: 'Attempt invalid rollback' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('does not exist');
    });
  });
});
