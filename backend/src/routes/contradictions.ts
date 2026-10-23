import { Router, Request, Response } from 'express';
import {
  contradictionDetectionService,
} from '../services/ContradictionDetectionService';
import { contradictionStore } from '../store/ContradictionStore';
import { ContradictionResolution } from '../types/contradiction';

export const contradictionsRouter = Router();

// GET /api/graph/contradictions
contradictionsRouter.get('/', (req: Request, res: Response): void => {
  const { status, entityId } = req.query;

  let alerts = contradictionStore.getAll();

  if (status === 'active' || status === 'pending') {
    alerts = alerts.filter((a) => a.status === 'active');
  } else if (status === 'resolved') {
    alerts = alerts.filter((a) => a.status !== 'active');
  }

  if (typeof entityId === 'string' && entityId.trim()) {
    alerts = alerts.filter((a) => a.entityId === entityId.trim());
  }

  res.json({
    alerts,
    count: alerts.length,
    activeCount: alerts.filter((a) => a.status === 'active').length,
  });
});

// POST /api/graph/contradictions/:id/resolve
contradictionsRouter.post('/:id/resolve', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { resolution, note } = req.body || {};

  const validResolutions = new Set<string>([
    'prefer_a',
    'prefer_b',
    'both_valid',
    'explicit_contradicts_edge',
  ]);

  if (!resolution || !validResolutions.has(resolution)) {
    res.status(400).json({
      error: `Field "resolution" is required and must be one of: ${Array.from(validResolutions).join(', ')}`,
    });
    return;
  }

  try {
    const updated = await contradictionDetectionService.resolveContradiction(
      id,
      resolution as ContradictionResolution,
      note
    );
    res.json({ ok: true, alert: updated });
  } catch (err: any) {
    console.error(`Failed to resolve contradiction ${id}:`, err);
    res.status(404).json({ error: err?.message || 'Resolution failed' });
  }
});

// POST /api/graph/contradictions/scan
contradictionsRouter.post('/scan', async (req: Request, res: Response): Promise<void> => {
  const { docId, entityId } = req.body || {};

  try {
    if (typeof entityId === 'string' && entityId.trim()) {
      const alerts = await contradictionDetectionService.evaluateEntityClaims(entityId.trim());
      res.json({ ok: true, alerts, count: alerts.length });
    } else {
      const alerts = await contradictionDetectionService.evaluateCrossSourceContradictions(docId);
      res.json({ ok: true, alerts, count: alerts.length });
    }
  } catch (err: any) {
    console.error('Scan contradictions failed:', err);
    res.status(500).json({ error: err?.message || 'Scan failed' });
  }
});
