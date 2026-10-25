import { Router, Request, Response } from 'express';
import { gapDetectionService } from '../services/GapDetectionService';
import { researchOrchestratorService } from '../services/ResearchOrchestratorService';
import { researchImportService } from '../services/ResearchImportService';
import { researchProposalStore } from '../store/ResearchProposalStore';

export const researchRouter = Router();

/**
 * GET /api/research/gaps
 * Audits knowledge graph topology and returns ranked list of knowledge gaps.
 */
researchRouter.get('/gaps', (_req: Request, res: Response) => {
  try {
    const gaps = gapDetectionService.detectGaps();
    res.status(200).json({
      gaps,
      totalCount: gaps.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to detect knowledge gaps' });
  }
});

/**
 * POST /api/research/investigate
 * Initiates a bounded web research task for a topic or gap.
 */
researchRouter.post('/investigate', async (req: Request, res: Response) => {
  try {
    const { question, gapId, maxQueries, maxSources, maxExecutionTimeMs } = req.body || {};

    if (!question || typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'Field "question" is required and must be a non-empty string.' });
      return;
    }

    const proposal = await researchOrchestratorService.executeTask(question.trim(), {
      gapId,
      maxQueries: typeof maxQueries === 'number' ? maxQueries : undefined,
      maxSources: typeof maxSources === 'number' ? maxSources : undefined,
      maxExecutionTimeMs: typeof maxExecutionTimeMs === 'number' ? maxExecutionTimeMs : undefined,
    });

    if (proposal.report.sources.length === 0) {
      res.status(408).json({
        error: 'Research task completed with insufficient sources',
        proposalId: proposal.id,
        proposal,
      });
      return;
    }

    res.status(200).json({
      proposalId: proposal.id,
      proposal,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to execute research task' });
  }
});

/**
 * GET /api/research/proposals/:id
 * Retrieves a pending research proposal by ID.
 */
researchRouter.get('/proposals/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const proposal = researchProposalStore.get(id);

    if (!proposal) {
      res.status(404).json({ error: `Research proposal "${id}" not found or expired` });
      return;
    }

    res.status(200).json(proposal);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to retrieve proposal' });
  }
});

/**
 * POST /api/research/import
 * Commits accepted entities, relations, and contradiction resolutions into the knowledge graph.
 */
researchRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const {
      proposalId,
      acceptedEntityTempIds = [],
      acceptedRelationTempIds = [],
      acceptedContradictionIds = [],
    } = req.body || {};

    if (!proposalId || typeof proposalId !== 'string') {
      res.status(400).json({ error: 'Field "proposalId" is required' });
      return;
    }

    const result = await researchImportService.importProposal(
      proposalId,
      Array.isArray(acceptedEntityTempIds) ? acceptedEntityTempIds : [],
      Array.isArray(acceptedRelationTempIds) ? acceptedRelationTempIds : [],
      Array.isArray(acceptedContradictionIds) ? acceptedContradictionIds : []
    );

    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to import research proposal' });
  }
});

/**
 * POST /api/research/reject
 * Discards a pending proposal without importing any updates.
 */
researchRouter.post('/reject', (req: Request, res: Response) => {
  try {
    const { proposalId } = req.body || {};

    if (!proposalId || typeof proposalId !== 'string') {
      res.status(400).json({ error: 'Field "proposalId" is required' });
      return;
    }

    researchProposalStore.delete(proposalId);
    res.status(200).json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to reject research proposal' });
  }
});
