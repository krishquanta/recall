import { Router, Request, Response } from 'express';
import { searchService } from '../services/SearchService';
import { SearchRequest, SearchResponse } from '../types';

export const searchRouter = Router();

// POST /api/search
searchRouter.post('/', async (req: Request<{}, {}, SearchRequest>, res: Response): Promise<void> => {
  const { query, docIds, topK = 8, alpha = 0.6 } = req.body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Field "query" is required and cannot be empty.' });
    return;
  }

  try {
    const results = await searchService.hybridSearch(
      query.trim(),
      Array.isArray(docIds) ? docIds : undefined,
      Number(topK) || 8,
      typeof alpha === 'number' ? alpha : 0.6
    );

    const response: SearchResponse = { results };
    res.json(response);
  } catch (err: any) {
    console.error('Search error:', err);
    res.status(500).json({ error: err?.message || 'Search execution failed.' });
  }
});
