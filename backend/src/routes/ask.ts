import { Router, Request, Response } from 'express';
import { searchService } from '../services/SearchService';
import { llmService } from '../services/LLMService';
import { AskRequest, AskResponse } from '../types';

export const askRouter = Router();

// POST /api/ask
askRouter.post('/', async (req: Request<{}, {}, AskRequest>, res: Response): Promise<void> => {
  const { question, docIds } = req.body;

  if (!question || typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'Field "question" is required and cannot be empty.' });
    return;
  }

  try {
    const trimmed = question.trim();
    const filterDocIds = Array.isArray(docIds) ? docIds : undefined;

    // 1. Retrieve most relevant chunks using hybrid search
    const chunks = await searchService.hybridSearch(trimmed, filterDocIds, 8, 0.6);

    // 2. Generate answer with citation enforcement
    const result = await llmService.generateAnswer(trimmed, chunks);

    const response: AskResponse = {
      answer: result.answer,
      citations: result.citations,
    };

    res.json(response);
  } catch (err: any) {
    console.error('Ask error:', err);
    res.status(500).json({ error: err?.message || 'Answer generation failed.' });
  }
});
