import { Router, Request, Response } from 'express';
import {
  relationshipCurationService,
  EdgeNotFoundError,
  InvalidCurationActionError,
  InvalidRelationTypeError,
} from '../services/RelationshipCurationService';
import { RelationType, VALID_RELATION_TYPES, CurateEdgeParams } from '../types/graph';

export const curationRouter = Router();

const ALLOWED_RELATION_TYPES = new Set<string>(VALID_RELATION_TYPES);
const ALLOWED_ACTIONS = new Set<string>(['accept', 'reject', 'correct']);

/**
 * Express handler for POST /api/graph/relationships/:id/curate
 */
export async function curateRelationshipHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || !id.trim()) {
    res.status(400).json({ error: 'Relationship ID parameter is required' });
    return;
  }

  const trimmedId = id.trim();
  const body = req.body || {};
  const { action, relationType, invertDirection, description, reason } = body;

  // 1. Action Validation
  if (!action || typeof action !== 'string' || !ALLOWED_ACTIONS.has(action)) {
    res.status(400).json({
      error: `Field "action" is required and must be one of: 'accept', 'reject', 'correct'. Received: "${action}"`,
    });
    return;
  }

  // 2. Action-Specific Parameter Validation
  if (action === 'correct') {
    if (relationType !== undefined) {
      if (typeof relationType !== 'string' || !ALLOWED_RELATION_TYPES.has(relationType)) {
        res.status(400).json({
          error: `Invalid relationType "${relationType}". Allowed types: ${Array.from(ALLOWED_RELATION_TYPES).join(', ')}`,
        });
        return;
      }
    }

    if (invertDirection !== undefined && typeof invertDirection !== 'boolean') {
      res.status(400).json({
        error: 'Field "invertDirection" must be a boolean (true or false)',
      });
      return;
    }
  }

  try {
    const params: CurateEdgeParams = {
      action: action as 'accept' | 'reject' | 'correct',
      relationType: relationType as RelationType | undefined,
      invertDirection: Boolean(invertDirection),
      description: typeof description === 'string' ? description.trim() : undefined,
      reason: typeof reason === 'string' ? reason.trim() : undefined,
    };

    const result = await relationshipCurationService.curateEdge(trimmedId, params);

    res.status(200).json({
      success: true,
      ok: true,
      edge: result.edge,
      auditEntry: result.auditEntry,
    });
  } catch (err: any) {
    if (err instanceof EdgeNotFoundError || err.statusCode === 404 || /not found/i.test(err?.message)) {
      res.status(404).json({ error: err.message });
      return;
    }

    if (
      err instanceof InvalidCurationActionError ||
      err instanceof InvalidRelationTypeError ||
      err.statusCode === 400 ||
      /invalid|cannot curate|cannot correct|identical/i.test(err?.message)
    ) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error(`Error curating relationship ${id}:`, err);
    res.status(500).json({ error: err.message || 'Relationship curation failed' });
  }
}

// Router Route Definitions
curationRouter.post('/relationships/:id/curate', curateRelationshipHandler);
curationRouter.post('/curate/:id', curateRelationshipHandler); // Convenience alias
curationRouter.post('/curate-edge', (req: Request, res: Response) => {
  const edgeId = req.body?.edgeId || req.body?.id;
  if (edgeId) {
    req.params.id = edgeId;
  }
  return curateRelationshipHandler(req, res);
});
