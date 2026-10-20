import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { graphStore } from '../store/GraphStore';
import { reviewStore } from '../store/ReviewStore';
import { reviewQueueService } from '../services/ReviewQueueService';
import { graphExtractionService } from '../services/GraphExtractionService';
import { ProvenanceValidator } from '../services/ProvenanceValidator';
import { deduplicationService } from '../services/DeduplicationService';
import { keywordIndex } from '../store/KeywordIndex';
import { metadataStore } from '../store/MetadataStore';
import { Chunk, ClaimNode, RelationshipEdge } from '../types';

export const graphRouter = Router();

/**
 * Shared helper to extract and index graph from a set of chunks.
 */
export async function extractAndStoreGraphForChunks(chunks: Chunk[]): Promise<{
  entitiesCount: number;
  edgesCount: number;
  claimsCount: number;
}> {
  let entitiesCount = 0;
  let edgesCount = 0;
  let claimsCount = 0;

  for (const chunk of chunks) {
    // 1. Extract candidates
    const rawPayload = await graphExtractionService.extract(chunk);

    // 2. Validate & Anchor (Definition of Done)
    const validated = ProvenanceValidator.validateAndAnchor(chunk, rawPayload);

    // 3. Resolve & Deduplicate entities
    const nameToId = await deduplicationService.resolveEntities(validated.entities);
    entitiesCount += validated.entities.length;

    // 4. Ingest Claims
    for (const claim of validated.claims) {
      const subjectId =
        nameToId.get(claim.subjectEntityName) ||
        nameToId.get(claim.subjectEntityName.toLowerCase().trim()) ||
        graphStore.getEntityByName(claim.subjectEntityName)?.id;

      if (subjectId) {
        const claimNode: ClaimNode = {
          id: uuidv4(),
          subjectEntityId: subjectId,
          claimText: claim.claimText,
          modality: claim.modality,
          confidence: claim.confidence,
          evidence: claim.evidence,
          createdAt: Date.now(),
        };
        graphStore.addClaim(claimNode);
        claimsCount++;
      }
    }

    // 5. Ingest Relationships
    for (const rel of validated.relationships) {
      const sourceId =
        nameToId.get(rel.sourceEntityName) ||
        nameToId.get(rel.sourceEntityName.toLowerCase().trim()) ||
        graphStore.getEntityByName(rel.sourceEntityName)?.id;

      const targetId =
        nameToId.get(rel.targetEntityName) ||
        nameToId.get(rel.targetEntityName.toLowerCase().trim()) ||
        graphStore.getEntityByName(rel.targetEntityName)?.id;

      if (sourceId && targetId && sourceId !== targetId) {
        const edgeNode: RelationshipEdge = {
          id: uuidv4(),
          sourceId,
          targetId,
          relationType: rel.relationType,
          description: rel.description,
          confidence: rel.confidence,
          evidence: rel.evidence,
          createdAt: Date.now(),
        };
        graphStore.addEdge(edgeNode);
        edgesCount++;
      }
    }
  }

  await Promise.all([graphStore.save(), reviewStore.save()]);

  return { entitiesCount, edgesCount, claimsCount };
}

// GET /api/graph
graphRouter.get('/', (_req: Request, res: Response) => {
  const all = graphStore.getAll();
  const activeNodes = all.nodes.filter((n) => n.status !== 'merged');
  const nodeSet = new Set(activeNodes.map((n) => n.id));
  const activeEdges = all.edges.filter(
    (e) => nodeSet.has(e.sourceId) && nodeSet.has(e.targetId)
  );
  const activeClaims = all.claims.filter((c) => nodeSet.has(c.subjectEntityId));

  res.json({
    nodes: activeNodes,
    edges: activeEdges,
    claims: activeClaims,
    summary: {
      totalNodes: activeNodes.length,
      totalEdges: activeEdges.length,
      totalClaims: activeClaims.length,
      pendingReviewCount: activeNodes.filter((n) => n.status === 'pending_review').length,
    },
  });
});

// GET /api/graph/entities/:id
graphRouter.get('/entities/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const entity = graphStore.getEntity(id);

  if (!entity) {
    res.status(404).json({ error: `Entity with ID ${id} not found` });
    return;
  }

  const { incoming, outgoing } = graphStore.getIncidentEdges(id);
  const claims = graphStore.getClaimsForEntity(id);

  res.json({
    entity,
    incomingEdges: incoming,
    outgoingEdges: outgoing,
    claims,
  });
});

// GET /api/graph/review-queue
graphRouter.get('/review-queue', (_req: Request, res: Response) => {
  const pending = reviewQueueService.listPending();
  res.json({
    items: pending,
    count: pending.length,
  });
});

// POST /api/graph/review-queue/:id/resolve
graphRouter.post('/review-queue/:id/resolve', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action, targetEntityId } = req.body;

  if (!action || !['merge', 'separate', 'redirect'].includes(action)) {
    res.status(400).json({
      error: 'Field "action" is required and must be "merge", "separate", or "redirect".',
    });
    return;
  }

  try {
    await reviewQueueService.resolve(id, action, targetEntityId);
    res.json({ ok: true, id, action });
  } catch (err: any) {
    console.error(`Error resolving review queue item ${id}:`, err);
    res.status(400).json({ error: err?.message || 'Resolution failed.' });
  }
});

// POST /api/graph/reindex
graphRouter.post('/reindex', async (req: Request, res: Response) => {
  const { docId } = req.body;

  try {
    if (docId) {
      const doc = metadataStore.get(docId);
      if (!doc) {
        res.status(404).json({ error: `Document ${docId} not found` });
        return;
      }

      const chunks = keywordIndex.getChunksByDocId(docId);
      if (chunks.length === 0) {
        res.status(400).json({ error: `No chunks found for document ${docId}` });
        return;
      }

      // Clear previous graph data for this docId
      graphStore.deleteByDocId(docId);

      const stats = await extractAndStoreGraphForChunks(chunks);
      res.json({ ok: true, docId, ...stats });
    } else {
      // Reindex all documents
      const docs = metadataStore.getAll().filter((d) => d.status.stage === 'done');
      let totalEntities = 0;
      let totalEdges = 0;
      let totalClaims = 0;

      for (const doc of docs) {
        const chunks = keywordIndex.getChunksByDocId(doc.docId);
        if (chunks.length > 0) {
          const stats = await extractAndStoreGraphForChunks(chunks);
          totalEntities += stats.entitiesCount;
          totalEdges += stats.edgesCount;
          totalClaims += stats.claimsCount;
        }
      }

      res.json({
        ok: true,
        reindexedDocsCount: docs.length,
        entitiesCount: totalEntities,
        edgesCount: totalEdges,
        claimsCount: totalClaims,
      });
    }
  } catch (err: any) {
    console.error('Reindex error:', err);
    res.status(500).json({ error: err?.message || 'Reindex failed' });
  }
});
