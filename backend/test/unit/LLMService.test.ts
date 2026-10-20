import { describe, it, expect } from 'vitest';
import { llmService } from '../../src/services/LLMService';
import { RankedChunk } from '../../src/types';

describe('LLMService', () => {
  const chunks: RankedChunk[] = [
    {
      chunkId: 'doc-clt-0',
      text: 'The central limit theorem states that sample means approach a normal distribution as sample size grows.',
      score: 0.95,
      metadata: {
        docId: 'doc-clt',
        filename: 'stats.pdf',
        mimeType: 'application/pdf',
        chunkIndex: 0,
        page: 14,
        charStart: 0,
        charEnd: 105,
      },
    },
  ];

  it('generates an answer with structured citation metadata', async () => {
    const result = await llmService.generateAnswer('What is CLT?', chunks);

    expect(result.answer).toContain('[1]');
    expect(result.citations.length).toBe(1);
    expect(result.citations[0].index).toBe(1);
    expect(result.citations[0].chunkId).toBe('doc-clt-0');
    expect(result.citations[0].metadata.page).toBe(14);
    expect(result.citations[0].quote).toContain('central limit theorem');
  });

  it('returns graceful message when context is empty', async () => {
    const result = await llmService.generateAnswer('What is quantum computing?', []);

    expect(result.answer).toContain("I don't have information about that");
    expect(result.citations).toEqual([]);
  });

  it('greets cordially when user says "hi" or greeting', async () => {
    const result = await llmService.generateAnswer('hi', chunks);

    expect(result.answer).toContain('Smart Teacher');
    expect(result.answer).toContain('help you');
  });

  it('responds in Spanish when user says "hola"', async () => {
    const result = await llmService.generateAnswer('hola', chunks);

    expect(result.answer).toContain('¡Hola!');
  });
});
