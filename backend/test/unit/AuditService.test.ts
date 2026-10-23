import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/index';
import { AuditStore } from '../../src/store/AuditStore';
import { AuditService, auditService, TopologicalInvariantError } from '../../src/services/AuditService';
import { GraphStore } from '../../src/store/GraphStore';
import { AuditLogEntry, RelationshipEdge, EntityNode } from '../../src/types';

describe('AuditService & Audit REST API Unit & Integration Tests', () => {
  const testDir = path.join(process.cwd(), `test-audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
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

  // =========================================================================
  // SUITE 1: Mutation Recording & Append-Only JSONL Streaming
  // =========================================================================
  describe('1. Mutation Recording & JSONL Persistence', () => {
    it('records a mutation, generates auditId and timestamp, and writes valid JSONL line', async () => {
      const entry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-100',
        beforeState: { curationStatus: 'proposed' },
        afterState: { curationStatus: 'verified' },
        sourceDocId: 'doc-linalg',
        reason: 'Verified by human reviewer',
      });

      expect(entry.auditId).toBeDefined();
      expect(typeof entry.auditId).toBe('string');
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.action).toBe('edge_curate_accept');
      expect(entry.targetId).toBe('edge-100');

      // Verify physical disk file
      expect(fs.existsSync(testAuditPath)).toBe(true);
      const rawLines = fs.readFileSync(testAuditPath, 'utf-8').trim().split('\n');
      expect(rawLines.length).toBe(1);

      const parsed = JSON.parse(rawLines[0]);
      expect(parsed.auditId).toBe(entry.auditId);
      expect(parsed.action).toBe('edge_curate_accept');
      expect(parsed.beforeState.curationStatus).toBe('proposed');
      expect(parsed.afterState.curationStatus).toBe('verified');
      expect(parsed.reason).toBe('Verified by human reviewer');
    });

    it('appends multiple sequential mutations without overwriting earlier records', async () => {
      await localAuditService.recordMutation({
        action: 'relationship_created',
        targetType: 'relationship',
        targetId: 'edge-1',
        beforeState: null,
        afterState: { id: 'edge-1', relationType: 'DEFINES' },
      });

      await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-1',
        beforeState: { id: 'edge-1', curationStatus: 'proposed' },
        afterState: { id: 'edge-1', curationStatus: 'verified' },
      });

      await localAuditService.recordMutation({
        action: 'edge_curate_correct',
        targetType: 'relationship',
        targetId: 'edge-1',
        beforeState: { relationType: 'DEFINES' },
        afterState: { relationType: 'USES' },
      });

      const rawLines = fs.readFileSync(testAuditPath, 'utf-8').trim().split('\n');
      expect(rawLines.length).toBe(3);

      const line1 = JSON.parse(rawLines[0]);
      const line2 = JSON.parse(rawLines[1]);
      const line3 = JSON.parse(rawLines[2]);

      expect(line1.action).toBe('relationship_created');
      expect(line2.action).toBe('edge_curate_accept');
      expect(line3.action).toBe('edge_curate_correct');
    });

    it('serializes concurrent mutations safely via writeLock mutex queue', async () => {
      const concurrentWrites = Array.from({ length: 25 }, (_, i) =>
        localAuditService.recordMutation({
          action: 'entity_updated',
          targetType: 'entity',
          targetId: `entity-${i}`,
          beforeState: { v: i },
          afterState: { v: i + 1 },
        })
      );

      const results = await Promise.all(concurrentWrites);
      expect(results.length).toBe(25);

      const rawLines = fs.readFileSync(testAuditPath, 'utf-8').trim().split('\n');
      expect(rawLines.length).toBe(25);

      // Verify all lines are uncorrupted valid JSON
      for (const line of rawLines) {
        const item = JSON.parse(line);
        expect(item.auditId).toBeDefined();
        expect(item.action).toBe('entity_updated');
      }
    });

    it('faithfully preserves deep nested beforeState and afterState structures', async () => {
      const complexState = {
        id: 'edge-nested',
        sourceId: 'node-A',
        targetId: 'node-B',
        evidence: {
          docId: 'doc-1',
          chunkId: 'chunk-1-0',
          exactQuote: 'Deep neural networks learn representations.',
          charOffset: { start: 10, end: 54 },
        },
      };

      const entry = await localAuditService.recordMutation({
        action: 'edge_curate_correct',
        targetType: 'relationship',
        targetId: 'edge-nested',
        beforeState: complexState,
        afterState: { ...complexState, relationType: 'PROVES' },
      });

      const retrieved = await localAuditService.getEntryById(entry.auditId);
      expect(retrieved?.beforeState.evidence.charOffset.end).toBe(54);
      expect(retrieved?.afterState.relationType).toBe('PROVES');
    });
  });

  // =========================================================================
  // SUITE 2: Chronological Querying, Pagination & Filtering
  // =========================================================================
  describe('2. Querying, Pagination & Filtering', () => {
    it('returns entries in strict reverse chronological order (newest first)', async () => {
      const entry1 = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-1',
        beforeState: {},
        afterState: {},
      });
      // Small artificial delay to guarantee distinct timestamps
      await new Promise((r) => setTimeout(r, 10));

      const entry2 = await localAuditService.recordMutation({
        action: 'edge_curate_reject',
        targetType: 'relationship',
        targetId: 'edge-2',
        beforeState: {},
        afterState: {},
      });

      const entries = await localAuditService.getEntries();
      expect(entries.length).toBe(2);
      expect(entries[0].auditId).toBe(entry2.auditId); // Newest first
      expect(entries[1].auditId).toBe(entry1.auditId);
    });

    it('respects limit and returns accurate totalCount', async () => {
      for (let i = 0; i < 12; i++) {
        await localAuditService.recordMutation({
          action: 'entity_updated',
          targetType: 'entity',
          targetId: `ent-${i}`,
          beforeState: {},
          afterState: {},
        });
      }

      const paged = await localAuditService.getEntries({ limit: 4 });
      const total = await localAuditService.getTotalCount();

      expect(paged.length).toBe(4);
      expect(total).toBe(12);
    });

    it('filters entries strictly by targetId', async () => {
      await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'target-alpha',
        beforeState: {},
        afterState: {},
      });
      await localAuditService.recordMutation({
        action: 'edge_curate_reject',
        targetType: 'relationship',
        targetId: 'target-beta',
        beforeState: {},
        afterState: {},
      });
      await localAuditService.recordMutation({
        action: 'edge_curate_correct',
        targetType: 'relationship',
        targetId: 'target-alpha',
        beforeState: {},
        afterState: {},
      });

      const alphaEntries = await localAuditService.getEntries({ targetId: 'target-alpha' });
      const alphaCount = await localAuditService.getTotalCount({ targetId: 'target-alpha' });

      expect(alphaEntries.length).toBe(2);
      expect(alphaCount).toBe(2);
      expect(alphaEntries.every((e) => e.targetId === 'target-alpha')).toBe(true);
    });

    it('returns empty array when targetId matches no events', async () => {
      await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-1',
        beforeState: {},
        afterState: {},
      });

      const results = await localAuditService.getEntries({ targetId: 'unknown-target' });
      const total = await localAuditService.getTotalCount({ targetId: 'unknown-target' });

      expect(results).toEqual([]);
      expect(total).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 3: Atomic State Rollback & GraphStore Synchronization
  // =========================================================================
  describe('3. Atomic State Rollback Engine', () => {
    it('rolls back relationship curation and restores exact prior state in GraphStore', async () => {
      // Setup endpoints
      localGraphStore.addEntity({
        id: 'svd',
        name: 'SVD',
        type: 'Method',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 'pca',
        name: 'PCA',
        type: 'Method',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const initialEdge: RelationshipEdge = {
        id: 'edge-svd',
        sourceId: 'svd',
        targetId: 'pca',
        relationType: 'RELATED_TO',
        description: 'Related concepts',
        confidence: 0.9,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'quote', filename: 'f.txt' },
        createdAt: Date.now(),
      };
      (initialEdge as any).curationStatus = 'proposed';
      localGraphStore.addEdge(initialEdge);

      // Mutate edge to verified
      const updatedEdge = { ...initialEdge, curationStatus: 'verified', curatedAt: Date.now() };
      localGraphStore.updateEdge(initialEdge.id, updatedEdge as any);

      const auditEntry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: initialEdge.id,
        beforeState: initialEdge,
        afterState: updatedEdge,
      });

      // Execute rollback
      const result = await localAuditService.rollback(auditEntry.auditId);
      expect(result.success).toBe(true);
      expect(result.restoredAuditId).toBe(auditEntry.auditId);
      expect(result.targetId).toBe(initialEdge.id);

      // Verify GraphStore state restored
      const restored = localGraphStore.getEdge(initialEdge.id);
      expect(restored).toBeDefined();
      expect((restored as any)?.curationStatus).toBe('proposed');

      // Verify audit entry marked rolledBack
      const marked = await localAuditService.getEntryById(auditEntry.auditId);
      expect(marked?.rolledBack).toBe(true);

      // Verify rollback event was appended to audit log
      expect(result.actionLogged.action).toBe('rollback');
      expect(result.actionLogged.rollbackRefId).toBe(auditEntry.auditId);
    });

    it('rolls back relationship creation by deleting the created edge without orphan edges', async () => {
      localGraphStore.addEntity({
        id: 'node-A',
        name: 'Node A',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 'node-B',
        name: 'Node B',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const newEdge: RelationshipEdge = {
        id: 'edge-new',
        sourceId: 'node-A',
        targetId: 'node-B',
        relationType: 'CAUSES',
        description: 'A causes B',
        confidence: 0.85,
        evidence: { docId: 'doc-1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      localGraphStore.addEdge(newEdge);

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_created',
        targetType: 'relationship',
        targetId: newEdge.id,
        beforeState: null,
        afterState: newEdge,
      });

      // Rollback creation
      const result = await localAuditService.rollback(auditEntry.auditId);
      expect(result.success).toBe(true);

      // Verify edge deleted
      expect(localGraphStore.getEdge('edge-new')).toBeUndefined();
      expect(localGraphStore.getIncidentEdges('node-A').outgoing).toEqual([]);
      expect(localGraphStore.getIncidentEdges('node-B').incoming).toEqual([]);
    });

    it('rolls back relationship deletion by restoring the deleted edge and its adjacency indices', async () => {
      localGraphStore.addEntity({
        id: 'node-1',
        name: 'Node 1',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 'node-2',
        name: 'Node 2',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const edgeToDelete: RelationshipEdge = {
        id: 'edge-del',
        sourceId: 'node-1',
        targetId: 'node-2',
        relationType: 'PREREQUISITE_FOR',
        description: 'Req',
        confidence: 0.95,
        evidence: { docId: 'd1', chunkId: 'c1', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      localGraphStore.addEdge(edgeToDelete);

      // Simulate deletion
      localGraphStore.deleteEdge(edgeToDelete.id);
      expect(localGraphStore.getEdge(edgeToDelete.id)).toBeUndefined();

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edgeToDelete.id,
        beforeState: edgeToDelete,
        afterState: null,
      });

      const result = await localAuditService.rollback(auditEntry.auditId);
      expect(result.success).toBe(true);

      const restored = localGraphStore.getEdge(edgeToDelete.id);
      expect(restored).toBeDefined();
      expect(restored?.relationType).toBe('PREREQUISITE_FOR');
      expect(localGraphStore.getIncidentEdges('node-1').outgoing.some((e) => e.id === edgeToDelete.id)).toBe(true);
    });

    it('rolls back edge direction inversion and type correction', async () => {
      localGraphStore.addEntity({
        id: 'entity-1',
        name: 'Entity 1',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 'entity-2',
        name: 'Entity 2',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const original: RelationshipEdge = {
        id: 'edge-inverted',
        sourceId: 'entity-1',
        targetId: 'entity-2',
        relationType: 'CAUSES',
        description: 'Forward',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      localGraphStore.addEdge(original);

      const corrected = {
        ...original,
        sourceId: 'entity-2',
        targetId: 'entity-1',
        relationType: 'PREVENTS',
        curationStatus: 'corrected',
      };
      localGraphStore.updateEdge(original.id, corrected as any);

      const auditEntry = await localAuditService.recordMutation({
        action: 'edge_curate_correct',
        targetType: 'relationship',
        targetId: original.id,
        beforeState: original,
        afterState: corrected,
      });

      await localAuditService.rollback(auditEntry.auditId);

      const restored = localGraphStore.getEdge(original.id);
      expect(restored?.sourceId).toBe('entity-1');
      expect(restored?.targetId).toBe('entity-2');
      expect(restored?.relationType).toBe('CAUSES');
    });

    it('rolls back entity updates and restores entity aliases and name index', async () => {
      const entity: EntityNode = {
        id: 'ent-svm',
        name: 'SVM',
        type: 'Method',
        aliases: ['Support Vector Machine'],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      localGraphStore.addEntity(entity);

      const updatedEntity = {
        ...entity,
        name: 'Support Vector Machine',
        aliases: ['SVM', 'Max-Margin Classifier'],
      };
      localGraphStore.updateEntity(entity.id, updatedEntity);

      const auditEntry = await localAuditService.recordMutation({
        action: 'entity_updated',
        targetType: 'entity',
        targetId: entity.id,
        beforeState: entity,
        afterState: updatedEntity,
      });

      await localAuditService.rollback(auditEntry.auditId);

      const restored = localGraphStore.getEntity(entity.id);
      expect(restored?.name).toBe('SVM');
      expect(restored?.aliases).toEqual(['Support Vector Machine']);
      expect(localGraphStore.getEntityByName('svm')?.id).toBe(entity.id);
    });

    it('prevents restoring an edge with missing endpoint nodes (orphan edge guard)', async () => {
      const edgeToRestore: RelationshipEdge = {
        id: 'edge-orphan',
        sourceId: 'missing-source-node',
        targetId: 'missing-target-node',
        relationType: 'CAUSES',
        description: 'Broken edge',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };

      const auditEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edgeToRestore.id,
        beforeState: edgeToRestore,
        afterState: null,
      });

      await expect(localAuditService.rollback(auditEntry.auditId)).rejects.toThrow(
        TopologicalInvariantError
      );
    });

    it('transaction safety: rolls back in-memory changes if store save fails', async () => {
      localGraphStore.addEntity({
        id: 's',
        name: 'Source S',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 't',
        name: 'Target T',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const edge: RelationshipEdge = {
        id: 'edge-fail',
        sourceId: 's',
        targetId: 't',
        relationType: 'USES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      (edge as any).curationStatus = 'proposed';
      localGraphStore.addEdge(edge);

      const auditEntry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: { ...edge, curationStatus: 'proposed' },
        afterState: { ...edge, curationStatus: 'verified' },
      });

      // Mock save to fail
      vi.spyOn(localGraphStore, 'save').mockRejectedValueOnce(new Error('Disk write failed'));

      await expect(localAuditService.rollback(auditEntry.auditId)).rejects.toThrow('Disk write failed');

      // Target audit entry must NOT be marked rolledBack
      const entry = await localAuditService.getEntryById(auditEntry.auditId);
      expect(entry?.rolledBack).toBeFalsy();
    });
  });

  // =========================================================================
  // SUITE 4: Cascading Rollbacks & Reversion Idempotency
  // =========================================================================
  describe('4. Cascading Rollbacks & Idempotency', () => {
    it('rejects double rollback on already-reverted audit entry', async () => {
      localGraphStore.addEntity({
        id: 's-once',
        name: 'Source Once',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 't-once',
        name: 'Target Once',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const edge: RelationshipEdge = {
        id: 'edge-once',
        sourceId: 's-once',
        targetId: 't-once',
        relationType: 'USES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      localGraphStore.addEdge(edge);

      const entry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-once',
        beforeState: { ...edge, curationStatus: 'proposed' },
        afterState: { ...edge, curationStatus: 'verified' },
      });

      // First rollback succeeds
      await localAuditService.rollback(entry.auditId);

      // Second rollback fails with clear error
      await expect(localAuditService.rollback(entry.auditId)).rejects.toThrow(
        /already been rolled back/i
      );
    });

    it('supports cascading rollback: rolling back a rollback re-applies the original forward state', async () => {
      localGraphStore.addEntity({
        id: 's',
        name: 'Source',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 't',
        name: 'Target',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const edge: RelationshipEdge = {
        id: 'edge-cascade',
        sourceId: 's',
        targetId: 't',
        relationType: 'DEFINES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      (edge as any).curationStatus = 'proposed';
      localGraphStore.addEdge(edge);

      // 1. Initial curation to verified
      localGraphStore.updateEdge(edge.id, { ...edge, curationStatus: 'verified' } as any);
      const curateEntry = await localAuditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: { ...edge, curationStatus: 'proposed' },
        afterState: { ...edge, curationStatus: 'verified' },
      });

      // 2. Rollback the curation -> Restores proposed
      const rollbackResult = await localAuditService.rollback(curateEntry.auditId);
      expect((localGraphStore.getEdge(edge.id) as any)?.curationStatus).toBe('proposed');

      // 3. Rollback the rollback entry!
      const cascadeResult = await localAuditService.rollback(rollbackResult.actionLogged.auditId);
      expect(cascadeResult.success).toBe(true);

      // Edge is verified again!
      expect((localGraphStore.getEdge(edge.id) as any)?.curationStatus).toBe('verified');
      expect(cascadeResult.actionLogged.rollbackRefId).toBe(rollbackResult.actionLogged.auditId);

      // Verify originalEntry.rolledBack is unmarked (reactivated) in memory
      const recheckedCurate = localAuditStore.getById(curateEntry.auditId);
      expect(recheckedCurate?.rolledBack).toBe(false);
      expect(recheckedCurate?.rolledBackBy).toBeUndefined();

      // Verify that this reactivation survives store rehydration across new AuditStore(testAuditPath)
      const rehydratedStore = new AuditStore(testAuditPath);
      const rehydratedCurate = rehydratedStore.getById(curateEntry.auditId);
      expect(rehydratedCurate?.rolledBack).toBe(false);
      expect(rehydratedCurate?.rolledBackBy).toBeUndefined();
    });

    it('supports cascading rollback of edge deletion when beforeState === null', async () => {
      localGraphStore.addEntity({
        id: 's-del-casc',
        name: 'Source Del Casc',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      localGraphStore.addEntity({
        id: 't-del-casc',
        name: 'Target Del Casc',
        type: 'Concept',
        aliases: [],
        status: 'active',
        evidence: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const edge: RelationshipEdge = {
        id: 'edge-del-cascade',
        sourceId: 's-del-casc',
        targetId: 't-del-casc',
        relationType: 'DEFINES',
        description: 'd',
        confidence: 0.9,
        evidence: { docId: 'd', chunkId: 'c', exactQuote: 'q', filename: 'f' },
        createdAt: Date.now(),
      };
      (edge as any).curationStatus = 'proposed';
      localGraphStore.addEdge(edge);

      // 1. Delete the edge
      localGraphStore.deleteEdge(edge.id);
      const delEntry = await localAuditService.recordMutation({
        action: 'relationship_deleted',
        targetType: 'relationship',
        targetId: edge.id,
        beforeState: edge,
        afterState: null,
      });

      // 2. Rollback the deletion -> Restores edge
      const rb1 = await localAuditService.rollback(delEntry.auditId);
      expect(localGraphStore.getEdge(edge.id)).toBeDefined();

      // 3. Rollback the rollback entry -> Undoes restoration, re-deleting edge
      const rb2 = await localAuditService.rollback(rb1.actionLogged.auditId);
      expect(rb2.success).toBe(true);
      expect(localGraphStore.getEdge(edge.id)).toBeUndefined();

      // Verify original deletion entry is reactivated in memory and survives rehydration
      const recheckedDel = localAuditStore.getById(delEntry.auditId);
      expect(recheckedDel?.rolledBack).toBe(false);

      const rehydratedStore = new AuditStore(testAuditPath);
      expect(rehydratedStore.getById(delEntry.auditId)?.rolledBack).toBe(false);
    });

    it('throws 404 / NotFound when rolling back non-existent auditId', async () => {
      await expect(localAuditService.rollback('non-existent-uuid-12345')).rejects.toThrow(
        /not found/i
      );
    });
  });

  // =========================================================================
  // SUITE 5: Corrupt Line Recovery & Resilient Boot
  // =========================================================================
  describe('5. Corrupt Line Recovery & Resilient Boot', () => {
    it('recovers gracefully when .jsonl contains corrupt, garbage, or truncated lines', () => {
      // Craft corrupt file containing valid, invalid, and empty lines
      const corruptContent = [
        JSON.stringify({
          auditId: 'valid-entry-1',
          timestamp: 1000,
          action: 'edge_curate_accept',
          targetType: 'relationship',
          targetId: 'edge-1',
          beforeState: {},
          afterState: {},
        }),
        'CORRUPT_NOT_A_JSON_STRING_AT_ALL',
        JSON.stringify({
          auditId: 'valid-entry-2',
          timestamp: 2000,
          action: 'edge_curate_reject',
          targetType: 'relationship',
          targetId: 'edge-2',
          beforeState: {},
          afterState: {},
        }),
        '{"auditId":"truncated", "timestamp":', // Incomplete JSON
        '', // Empty line
        '   ', // Whitespace line
        JSON.stringify({
          auditId: 'valid-entry-3',
          timestamp: 3000,
          action: 'rollback',
          targetType: 'relationship',
          targetId: 'edge-1',
          beforeState: {},
          afterState: {},
        }),
      ].join('\n');

      fs.writeFileSync(testAuditPath, corruptContent, 'utf-8');

      // Booting store must NOT throw SyntaxError
      const resilientStore = new AuditStore(testAuditPath);
      const history = resilientStore.getHistory();

      // Only the 3 valid entries should be indexed
      expect(history.length).toBe(3);
      expect(history.map((e) => e.auditId)).toEqual([
        'valid-entry-3',
        'valid-entry-2',
        'valid-entry-1',
      ]);
    });

    it('subsequent appends succeed cleanly after booting from a corrupt file', async () => {
      fs.writeFileSync(testAuditPath, 'GARBAGE_LINE\n', 'utf-8');

      const resilientStore = new AuditStore(testAuditPath);
      const resilientService = new AuditService(resilientStore, localGraphStore);

      const newEntry = await resilientService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-healthy',
        beforeState: {},
        afterState: {},
      });

      expect(newEntry.auditId).toBeDefined();

      const history = resilientStore.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].auditId).toBe(newEntry.auditId);
    });
  });

  // =========================================================================
  // SUITE 6: REST API Route Integration Tests (Supertest)
  // =========================================================================
  describe('6. REST API Supertest Route Integration', () => {
    it('GET /api/graph/audit-log returns 200 with entries array and totalCount', async () => {
      const res = await request(app).get('/api/graph/audit-log');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(typeof res.body.totalCount).toBe('number');
    });

    it('GET /api/graph/audit-log supports ?limit and ?targetId query parameters', async () => {
      const res = await request(app).get('/api/graph/audit-log?limit=2&targetId=test-entity');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.entries.length).toBeLessThanOrEqual(2);
    });

    it('POST /api/graph/audit-log/:id/rollback returns 404 for unknown auditId', async () => {
      const res = await request(app)
        .post('/api/graph/audit-log/missing-uuid-9999/rollback')
        .send({ reason: 'Revert test' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('POST /api/graph/audit-log/:id/rollback returns 400 for already-rolled-back entry', async () => {
      // Record mutation in the active runtime auditService
      const entry = await auditService.recordMutation({
        action: 'edge_curate_accept',
        targetType: 'relationship',
        targetId: 'edge-api-test',
        beforeState: { status: 'proposed' },
        afterState: { status: 'verified' },
      });

      // Rollback via API once -> 200
      const res1 = await request(app)
        .post(`/api/graph/audit-log/${entry.auditId}/rollback`)
        .send({ reason: 'Undo accept' });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      // Rollback via API second time -> 400
      const res2 = await request(app)
        .post(`/api/graph/audit-log/${entry.auditId}/rollback`)
        .send({ reason: 'Undo again' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toMatch(/already been rolled back/i);
    });
  });
});
