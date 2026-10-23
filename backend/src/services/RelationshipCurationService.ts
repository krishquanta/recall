import { GraphStore, graphStore } from '../store/GraphStore';
import { AuditService, auditService } from './AuditService';
import { IAuditService, AuditLogEntry, AuditActionType } from '../types/audit';
import { cacheService } from './CacheService';
import {
  RelationshipEdge,
  CurateEdgeParams,
  CurateEdgeResult,
  RelationType,
  VALID_RELATION_TYPES,
} from '../types/graph';

export class EdgeNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(edgeId: string) {
    super(`Relationship edge with ID "${edgeId}" not found`);
    this.name = 'EdgeNotFoundError';
  }
}

export class InvalidCurationActionError extends Error {
  public readonly statusCode = 400;
  constructor(action: string) {
    super(`Invalid curation action "${action}". Must be "accept", "reject", or "correct".`);
    this.name = 'InvalidCurationActionError';
  }
}

export class InvalidRelationTypeError extends Error {
  public readonly statusCode = 400;
  constructor(relationType: string) {
    super(
      `Invalid relationType "${relationType}". Valid types: ${VALID_RELATION_TYPES.join(', ')}`
    );
    this.name = 'InvalidRelationTypeError';
  }
}

export class RelationshipCurationService {
  private graph: GraphStore;
  private audit: IAuditService;

  constructor(
    graphStoreInstance: GraphStore = graphStore,
    auditServiceInstance?: IAuditService
  ) {
    this.graph = graphStoreInstance;
    this.audit = auditServiceInstance || auditService;
  }

  /**
   * Main unified curation entrypoint.
   * Executes edge curation, updates GraphStore, and records an append-only audit log entry.
   */
  public async curateEdge(
    edgeId: string,
    params: CurateEdgeParams
  ): Promise<CurateEdgeResult> {
    // 1. Parameter Validation
    if (!edgeId || typeof edgeId !== 'string' || !edgeId.trim()) {
      throw new Error('Edge ID is required');
    }
    const trimmedId = edgeId.trim();

    if (!params || typeof params !== 'object') {
      throw new InvalidCurationActionError('undefined');
    }

    const { action, relationType, invertDirection, description, reason } = params;

    if (!action || !['accept', 'reject', 'correct'].includes(action)) {
      throw new InvalidCurationActionError(String(action));
    }

    if (relationType && !VALID_RELATION_TYPES.includes(relationType)) {
      throw new InvalidRelationTypeError(String(relationType));
    }

    // 2. Fetch Existing Edge
    const existingEdge = this.graph.getEdge(trimmedId);
    if (!existingEdge) {
      throw new EdgeNotFoundError(trimmedId);
    }

    // 3. Deep-Clone beforeState for Immutable Audit Snapshot
    const beforeState: RelationshipEdge = JSON.parse(JSON.stringify(existingEdge));
    const edgeToUpdate: RelationshipEdge = { ...existingEdge };

    // 4. Apply State Transitions
    const now = Date.now();
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
    let auditAction: AuditActionType = 'relationship_curated';

    switch (action) {
      case 'accept': {
        edgeToUpdate.curationStatus = 'verified';
        edgeToUpdate.curatedAt = now;
        if (cleanReason) edgeToUpdate.curationReason = cleanReason;
        auditAction = 'edge_curate_accept';
        break;
      }

      case 'reject': {
        // Soft delete: preserved in GraphStore for audit history & rollback, but isolated from search traversals
        edgeToUpdate.curationStatus = 'rejected';
        edgeToUpdate.curatedAt = now;
        if (cleanReason) edgeToUpdate.curationReason = cleanReason;
        auditAction = 'edge_curate_reject';

        // Invalidate cached QA responses to purge any answers referencing this rejected relationship
        try {
          if (typeof (cacheService as any)?.clearQA === 'function') {
            (cacheService as any).clearQA();
          } else if ((cacheService as any)?.qaMap && typeof (cacheService as any).qaMap.clear === 'function') {
            (cacheService as any).qaMap.clear();
          }
        } catch {
          // Best-effort cache invalidation
        }
        break;
      }

      case 'correct': {
        // Preserve initial extraction type before overriding
        if (!edgeToUpdate.originalRelationType) {
          edgeToUpdate.originalRelationType = edgeToUpdate.relationType;
        }

        if (relationType) {
          edgeToUpdate.relationType = relationType;
        }

        if (invertDirection) {
          const tempSource = edgeToUpdate.sourceId;
          edgeToUpdate.sourceId = edgeToUpdate.targetId;
          edgeToUpdate.targetId = tempSource;
        }

        if (edgeToUpdate.sourceId === edgeToUpdate.targetId) {
          throw new Error('Cannot correct edge: source and target entities cannot be identical');
        }

        if (typeof description === 'string' && description.trim()) {
          edgeToUpdate.description = description.trim();
        }

        edgeToUpdate.curationStatus = 'corrected';
        edgeToUpdate.curatedAt = now;
        if (cleanReason) edgeToUpdate.curationReason = cleanReason;
        auditAction = 'edge_curate_correct';
        break;
      }
    }

    // 5. Update Graph Store and Persist
    this.graph.updateEdge(trimmedId, edgeToUpdate);
    await this.graph.save();

    // 6. Record Audit Log Entry
    const auditEntry = await this.audit.recordMutation({
      action: auditAction,
      targetType: 'relationship',
      targetId: trimmedId,
      beforeState,
      afterState: edgeToUpdate,
      reason: cleanReason,
      sourceDocId: edgeToUpdate.evidence?.docId,
    });

    return {
      edge: edgeToUpdate,
      auditEntry,
    };
  }

  /**
   * Convenience method: Accept an edge (mark as human-verified).
   */
  public async acceptEdge(edgeId: string, reason?: string): Promise<RelationshipEdge> {
    const result = await this.curateEdge(edgeId, { action: 'accept', reason });
    return result.edge;
  }

  /**
   * Convenience method: Reject an edge (soft-delete / isolate from search).
   */
  public async rejectEdge(edgeId: string, reason?: string): Promise<RelationshipEdge> {
    const result = await this.curateEdge(edgeId, { action: 'reject', reason });
    return result.edge;
  }

  /**
   * Convenience method: Correct an edge (relation type, direction, or description).
   */
  public async correctEdge(
    edgeId: string,
    params: {
      relationType?: RelationType;
      invertDirection?: boolean;
      description?: string;
      reason?: string;
    }
  ): Promise<RelationshipEdge> {
    const result = await this.curateEdge(edgeId, {
      action: 'correct',
      relationType: params.relationType,
      invertDirection: params.invertDirection,
      description: params.description,
      reason: params.reason,
    });
    return result.edge;
  }
}

export const relationshipCurationService = new RelationshipCurationService();
