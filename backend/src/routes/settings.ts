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

import fs from 'fs';
import path from 'path';
import { urlSecurityValidator, DEFAULT_RESEARCH_SETTINGS } from '../services/UrlSecurityValidator';
import { ResearchSettings } from '../types';

function getResearchSettingsPath(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'research_settings.json');
}

function loadResearchSettings(): ResearchSettings {
  const filePath = getResearchSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_RESEARCH_SETTINGS,
        ...parsed,
      };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_RESEARCH_SETTINGS };
}

/**
 * GET /api/settings/research
 * Returns current research settings.
 */
settingsRouter.get('/research', (_req: Request, res: Response) => {
  try {
    const settings = loadResearchSettings();
    res.status(200).json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to get research settings' });
  }
});

/**
 * PUT /api/settings/research
 * Updates research settings (approved domains, budgets, provider toggles).
 */
settingsRouter.put('/research', (req: Request, res: Response) => {
  try {
    const current = loadResearchSettings();
    const update = req.body || {};

    const updated: ResearchSettings = {
      approvedDomains: Array.isArray(update.approvedDomains)
        ? update.approvedDomains.map((d: any) => String(d).trim().toLowerCase()).filter(Boolean)
        : current.approvedDomains,
      maxQueriesPerTask:
        typeof update.maxQueriesPerTask === 'number' && update.maxQueriesPerTask > 0
          ? Math.min(update.maxQueriesPerTask, 10)
          : current.maxQueriesPerTask,
      maxSourcesPerTask:
        typeof update.maxSourcesPerTask === 'number' && update.maxSourcesPerTask > 0
          ? Math.min(update.maxSourcesPerTask, 20)
          : current.maxSourcesPerTask,
      maxExecutionTimeMs:
        typeof update.maxExecutionTimeMs === 'number' && update.maxExecutionTimeMs >= 5000
          ? update.maxExecutionTimeMs
          : current.maxExecutionTimeMs,
      enableDuckDuckGo:
        typeof update.enableDuckDuckGo === 'boolean'
          ? update.enableDuckDuckGo
          : current.enableDuckDuckGo,
      enableWikipediaApi:
        typeof update.enableWikipediaApi === 'boolean'
          ? update.enableWikipediaApi
          : current.enableWikipediaApi,
      enableArxivApi:
        typeof update.enableArxivApi === 'boolean'
          ? update.enableArxivApi
          : current.enableArxivApi,
    };

    const filePath = getResearchSettingsPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');

    urlSecurityValidator.updateAllowedDomains(updated.approvedDomains);

    res.status(200).json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update research settings' });
  }
});
