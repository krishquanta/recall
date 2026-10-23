import { Router, Request, Response } from 'express';
import { keyManager, maskApiKey } from '../services/KeyManager';
import { cacheService } from '../services/CacheService';

export const settingsRouter = Router();

/**
 * GET /api/settings/keys
 * Returns key pool health status, cache statistics, and aggregate counts.
 */
settingsRouter.get('/keys', (_req: Request, res: Response) => {
  try {
    const keys = keyManager.getKeyStatuses();
    const cacheStats = cacheService.getStats();
    const activeKeyCount = keyManager.getActiveKeyCount();
    const totalKeyCount = keyManager.getTotalKeyCount();

    res.status(200).json({
      keys,
      cacheStats,
      activeKeyCount,
      totalKeyCount,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || 'Failed to retrieve settings',
    });
  }
});

/**
 * POST /api/settings/keys
 * Dynamically registers a new Gemini API key into the runtime pool.
 */
settingsRouter.post('/keys', (req: Request, res: Response) => {
  try {
    const rawKey = req.body?.key ?? req.body?.apiKey;

    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      res.status(400).json({ error: 'Field "key" is required' });
      return;
    }

    const trimmedKey = rawKey.trim();
    const result = keyManager.addKey(trimmedKey);

    if (!result.success) {
      res.status(400).json({
        error: 'Failed to add key: key already exists in pool or is invalid',
      });
      return;
    }

    const keyStatus = keyManager.getKeyStatuses().find(
      (s) => s.maskedKey === maskApiKey(trimmedKey)
    ) || {
      keyId: result.keyId,
      maskedKey: maskApiKey(trimmedKey),
      status: 'ACTIVE' as const,
      cooldownRemainingMs: 0,
      totalRequests: 0,
      failedRequests: 0,
      lastUsedTimestamp: null,
    };

    res.status(200).json({
      success: true,
      keyStatus,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || 'Internal error adding key',
    });
  }
});
