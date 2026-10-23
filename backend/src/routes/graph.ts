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
import { Chunk, ClaimNode, RelationshipEdge, ValidatedEntity, ValidatedClaim, ValidatedRelationship } from '../types';

export const graphRouter = Router();

/**
 * Estimates token count for text using whitespace word splitting (~1.3 tokens per word).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

/**
 * Groups 2–4 adjacent text chunks into multi-chunk windows (~2,000 tokens)
 * to reduce LLM extraction calls by 60–75% while preserving chunk source metadata.
 */
export function partitionChunksIntoWindows(
  chunks: Chunk[],
  targetTokens: number = 2000,
  minChunks: number = 2,
  maxChunks: number = 4
): Chunk[][] {
  if (!chunks || chunks.length === 0) return [];
  if (chunks.length === 1) return [[chunks[0]]];

  const windows: Chunk[][] = [];
  let currentWindow: Chunk[] = [];
  let currentTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTokens = estimateTokens(chunk.text);
    const sameDoc =
      currentWindow.length === 0 ||
      currentWindow[0].metadata?.docId === chunk.metadata?.docId;

    // Check if adding this chunk would exceed limits
    const exceedsMaxChunks = currentWindow.length >= maxChunks;
    const exceedsTokens =
      currentTokens + chunkTokens > targetTokens && currentWindow.length >= minChunks;

    if (currentWindow.length > 0 && (!sameDoc || exceedsMaxChunks || exceedsTokens)) {
      windows.push(currentWindow);
      currentWindow = [];
      currentTokens = 0;
    }

    currentWindow.push(chunk);
    currentTokens += chunkTokens;
  }

  if (currentWindow.length > 0) {
    // If the last window has only 1 chunk and the preceding window is from the same doc:
    if (currentWindow.length === 1 && windows.length > 0) {
      const prevWindow = windows[windows.length - 1];
      if (prevWindow[0].metadata?.docId === currentWindow[0].metadata?.docId) {
        if (prevWindow.length < maxChunks) {
          prevWindow.push(currentWindow[0]);
        } else if (prevWindow.length > minChunks) {
          const moved = prevWindow.pop()!;
          currentWindow.unshift(moved);
          windows.push(currentWindow);
        } else {
          windows.push(currentWindow);
        }
      } else {
        windows.push(currentWindow);
      }
    } else {
      windows.push(currentWindow);
    }
  }

  return windows;
}

/**
 * Shared helper to extract and index graph from a set of chunks.
 * Groups 2–4 adjacent text chunks into multi-chunk windows (~2,000 tokens),
 * reducing LLM extraction calls by 60–75%, and performs batch entity deduplication.
 */
export async function extractAndStoreGraphForChunks(chunks: Chunk[]): Promise<{
  entitiesCount: number;
  edgesCount: number;
  claimsCount: number;
}> {
  let entitiesCount = 0;
  let edgesCount = 0;
  let claimsCount = 0;

  if (!chunks || chunks.length === 0) {
    return { entitiesCount, edgesCount, claimsCount };
  }

  // 1. Group chunks into multi-chunk windows (~2,000 tokens, 2–4 chunks)
  const windows = partitionChunksIntoWindows(chunks);
  const validatedWindows: Array<{
    windowChunks: Chunk[];
    entities: ValidatedEntity[];
    claims: ValidatedClaim[];
    relationships: ValidatedRelationship[];
  }> = [];

  const allValidatedEntities: ValidatedEntity[] = [];

  // 2. Extract and validate each multi-chunk window
  for (const windowChunks of windows) {
    const rawPayload = await graphExtractionService.extractWindow(windowChunks);
    const validated = ProvenanceValidator.validateAndAnchorWindow(windowChunks, rawPayload);

    validatedWindows.push({
      windowChunks,
      entities: validated.entities,
      claims: validated.claims,
      relationships: validated.relationships,
    });
    allValidatedEntities.push(...validated.entities);
  }

  // 3. Batch resolve and deduplicate all entities across the batch in a single batch embedding call
  const nameToId = await deduplicationService.resolveEntities(allValidatedEntities);
  entitiesCount += allValidatedEntities.length;

  // 4. Ingest Claims and Relationships across all validated windows
  for (const vw of validatedWindows) {
    for (const claim of vw.claims) {
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

    for (const rel of vw.relationships) {
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
          curationStatus: 'proposed',
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
