import { Router, Request, Response } from 'express';
import { claimComparisonService } from '../services/ClaimComparisonService';

export const claimsRouter = Router();

// GET /api/graph/claims/compare
claimsRouter.get('/compare', async (req: Request, res: Response): Promise<void> => {
  const { entityId, includeSingleDoc } = req.query;

  try {
    if (typeof entityId === 'string' && entityId.trim()) {
      const clusters = await claimComparisonService.compareEntityClaims(entityId.trim(), {
        includeSingleDoc: includeSingleDoc === 'true' || includeSingleDoc === '1',
      });
      res.json({
        cluster: clusters[0] || null,
        clusters,
      });
    } else {
      const clusters = await claimComparisonService.compareAllEntities();
      res.json({
        clusters,
        count: clusters.length,
      });
    }
  } catch (err: any) {
    console.error('Failed to compare claims:', err);
    res.status(500).json({ error: err?.message || 'Comparison failed' });
  }
});
