import { AuditLogEntry, IAuditService, RollbackResult } from '../types/audit';
import { AuditStore, auditStore } from '../store/AuditStore';
import { GraphStore, graphStore } from '../store/GraphStore';
import { RelationshipEdge, EntityNode, ClaimNode } from '../types/graph';

export class TopologicalInvariantError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
    super(message);
    this.name = 'TopologicalInvariantError';
  }
}

export class AuditEntryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEntryNotFoundError';
  }
}

export class AuditEntryAlreadyRolledBackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEntryAlreadyRolledBackError';
  }
}

export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const release = () => {
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          next();
        } else {
          this.locked = false;
        }
      };

      if (!this.locked) {
        this.locked = true;
        resolve(release);
      } else {
        this.queue.push(() => resolve(release));
      }
    });
  }

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class AuditService implements IAuditService {
  private mutex = new AsyncMutex();

  constructor(
    private auditStoreInstance: AuditStore = auditStore,
    private graphStoreInstance: GraphStore = graphStore
  ) {}

  public async recordMutation(
    entry: Omit<AuditLogEntry, 'auditId' | 'timestamp'>
  ): Promise<AuditLogEntry> {
    return this.mutex.runExclusive(async () => {
      return this.auditStoreInstance.append(entry);
    });
  }

  public async getEntries(options?: {
    limit?: number;
    offset?: number;
    targetId?: string;
  }): Promise<AuditLogEntry[]> {
    return this.auditStoreInstance.getEntries(options);
  }

  public async getEntry(auditId: string): Promise<AuditLogEntry | undefined> {
    return this.auditStoreInstance.getById(auditId);
  }

  public async getEntryById(auditId: string): Promise<AuditLogEntry | undefined> {
    return this.auditStoreInstance.getById(auditId);
  }

  public async getTotalCount(options?: { targetId?: string }): Promise<number> {
    return this.auditStoreInstance.getTotalCount(options);
  }

  /**
   * Validates topological integrity before state restoration.
   */
  private validateTopologicalInvariants(entry: AuditLogEntry): void {
    if (entry.targetType === 'relationship') {
      const edgeToRestore = entry.beforeState as RelationshipEdge | null;
      if (edgeToRestore && edgeToRestore.sourceId && edgeToRestore.targetId) {
        if (edgeToRestore.sourceId === edgeToRestore.targetId) {
          throw new TopologicalInvariantError(
            `Cannot rollback relationship "${entry.targetId}": Restored edge would create an invalid self-loop.`,
            'ERR_SELF_LOOP_DISALLOWED',
            { edgeId: entry.targetId }
          );
        }

        const sourceNode = this.graphStoreInstance.getEntity(edgeToRestore.sourceId);
        const targetNode = this.graphStoreInstance.getEntity(edgeToRestore.targetId);

        if (!sourceNode || sourceNode.status === 'merged') {
          throw new TopologicalInvariantError(
            `Cannot rollback relationship "${entry.targetId}": Source entity "${edgeToRestore.sourceId}" does not exist or has been merged.`,
            'ERR_ORPHAN_SOURCE_NODE',
            { edgeId: entry.targetId, sourceId: edgeToRestore.sourceId }
          );
        }

        if (!targetNode || targetNode.status === 'merged') {
          throw new TopologicalInvariantError(
            `Cannot rollback relationship "${entry.targetId}": Target entity "${edgeToRestore.targetId}" does not exist or has been merged.`,
            'ERR_ORPHAN_TARGET_NODE',
            { edgeId: entry.targetId, targetId: edgeToRestore.targetId }
          );
        }
      }
    } else if (entry.targetType === 'claim') {
      const claimToRestore = entry.beforeState as ClaimNode | null;
      if (claimToRestore && claimToRestore.subjectEntityId) {
        const subjectNode = this.graphStoreInstance.getEntity(claimToRestore.subjectEntityId);
        if (!subjectNode || subjectNode.status === 'merged') {
          throw new TopologicalInvariantError(
            `Cannot rollback claim "${entry.targetId}": Subject entity "${claimToRestore.subjectEntityId}" does not exist or has been merged.`,
            'ERR_ORPHAN_CLAIM_SUBJECT',
            { claimId: entry.targetId, subjectEntityId: claimToRestore.subjectEntityId }
          );
        }
      }
    }
  }

  /**
   * Applies the in-memory reversion to GraphStore, returning the prior state for inverse logging.
   */
  private applyReversionInMemory(entry: AuditLogEntry): any {
    const { targetType, targetId, beforeState, action } = entry;
    let currentStateBeforeRollback: any = null;

    if (targetType === 'relationship') {
      const currentEdge = this.graphStoreInstance.getEdge(targetId);
      currentStateBeforeRollback = currentEdge ? { ...currentEdge } : null;

      if (action === 'relationship_created' || beforeState === null) {
        this.graphStoreInstance.deleteEdge(targetId);
      } else if (action === 'relationship_deleted') {
        if (beforeState) {
          this.graphStoreInstance.addEdge(beforeState as RelationshipEdge);
        }
      } else {
        if (beforeState) {
          this.graphStoreInstance.updateEdge(targetId, beforeState as RelationshipEdge);
        }
      }
    } else if (targetType === 'entity') {
      const currentEntity = this.graphStoreInstance.getEntity(targetId);
      currentStateBeforeRollback = currentEntity ? { ...currentEntity } : null;

      if (action === 'entity_merge') {
        const mergeState = beforeState as {
          sourceEntity?: EntityNode;
          targetEntity?: EntityNode;
          repointedEdges?: Array<{ edgeId: string; priorSourceId: string; priorTargetId: string }>;
          repointedClaims?: Array<{ claimId: string; priorSubjectEntityId: string }>;
        };
        if (mergeState.sourceEntity) {
          this.graphStoreInstance.addEntity(mergeState.sourceEntity);
        }
        if (mergeState.targetEntity) {
          this.graphStoreInstance.addEntity(mergeState.targetEntity);
        }

        if (mergeState.repointedEdges) {
          for (const repointed of mergeState.repointedEdges) {
            const edge = this.graphStoreInstance.getEdge(repointed.edgeId);
            if (edge) {
              edge.sourceId = repointed.priorSourceId;
              edge.targetId = repointed.priorTargetId;
              this.graphStoreInstance.updateEdge(edge.id, edge);
            }
          }
        }

        if (mergeState.repointedClaims) {
          for (const repointed of mergeState.repointedClaims) {
            const claim = this.graphStoreInstance.getClaim(repointed.claimId);
            if (claim) {
              claim.subjectEntityId = repointed.priorSubjectEntityId;
              this.graphStoreInstance.addClaim(claim);
            }
          }
        }
      } else {
        if (beforeState) {
          this.graphStoreInstance.addEntity(beforeState as EntityNode);
        }
      }
    } else if (targetType === 'claim') {
      const currentClaim = this.graphStoreInstance.getClaim(targetId);
      currentStateBeforeRollback = currentClaim ? { ...currentClaim } : null;

      if (beforeState === null) {
        this.graphStoreInstance.deleteClaim(targetId);
      } else if (beforeState) {
        this.graphStoreInstance.addClaim(beforeState as ClaimNode);
      }
    }

    return currentStateBeforeRollback;
  }

  /**
   * Executes an atomic rollback of a specific audit entry.
   */
  public async rollback(auditId: string, reason?: string): Promise<RollbackResult> {
    return this.mutex.runExclusive(async () => {
      // 1. Locate Target Entry
      const targetEntry = this.auditStoreInstance.getById(auditId);
      if (!targetEntry) {
        throw new AuditEntryNotFoundError(`Audit entry "${auditId}" not found`);
      }

      // 2. Pre-Check: Guard Against Double-Rollback
      if (targetEntry.rolledBack) {
        throw new AuditEntryAlreadyRolledBackError(
          `Audit entry "${auditId}" has already been rolled back by entry "${targetEntry.rolledBackBy || ''}". To re-apply, rollback entry "${targetEntry.rolledBackBy || ''}".`
        );
      }

      // 3. Pre-Flight Topological Validations (Zero Orphan Edges)
      this.validateTopologicalInvariants(targetEntry);

      // 4. Capture In-Memory Snapshot for Rollback on Failure
      const graphSnapshot = this.graphStoreInstance.captureSnapshot();
      let currentStateBeforeRollback: any;

      try {
        // 5. Apply In-Memory Graph Mutation
        currentStateBeforeRollback = this.applyReversionInMemory(targetEntry);

        // 6. Atomic Persistence to data/graph.json
        await this.graphStoreInstance.save();
      } catch (graphErr) {
        // Failure Recovery: Revert In-Memory Mutation
        this.graphStoreInstance.restoreSnapshot(graphSnapshot);
        throw graphErr;
      }

      // Capture predecessor rollback reference before appending to preserve pointer across state mutation
      const priorRollbackRefId =
        targetEntry.action === 'rollback' && targetEntry.rollbackRefId
          ? targetEntry.rollbackRefId
          : undefined;

      try {
        // 7. Append Inverse Rollback Entry to data/audit_log.jsonl
        const rollbackEntry = await this.auditStoreInstance.append({
          action: 'rollback',
          targetType: targetEntry.targetType,
          targetId: targetEntry.targetId,
          beforeState: currentStateBeforeRollback,
          afterState: targetEntry.beforeState,
          reason: reason || `Rollback of audit entry ${auditId} (${targetEntry.action})`,
          sourceDocId: targetEntry.sourceDocId,
          rollbackRefId: auditId,
        });

        // 8. Update In-Memory Flags and Cascading Involution State
        this.auditStoreInstance.markRolledBack(auditId, rollbackEntry.auditId);
        if (priorRollbackRefId) {
          // Re-activate the previously rolled-back original entry
          this.auditStoreInstance.unmarkRolledBack(priorRollbackRefId);
        }

        return {
          success: true,
          restoredAuditId: auditId,
          targetId: targetEntry.targetId,
          targetType: targetEntry.targetType,
          actionLogged: rollbackEntry,
        };
      } catch (auditErr) {
        // Critical Compensation: If audit append fails, revert GraphStore and re-save
        this.graphStoreInstance.restoreSnapshot(graphSnapshot);
        await this.graphStoreInstance.save();
        throw auditErr;
      }
    });
  }
}

export const auditService = new AuditService();
