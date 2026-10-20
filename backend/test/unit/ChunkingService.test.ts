import { describe, it, expect } from 'vitest';
import { chunkingService } from '../../src/services/ChunkingService';
import { Page } from '../../src/types';

describe('ChunkingService', () => {
  it('should preserve page, lineStart, and charStart metadata', () => {
    const pages: Page[] = [
      {
        page: 1,
        text: 'Page one introduction to neural networks and gradient descent.',
        isOCR: false,
      },
      {
        page: 2,
        lineStart: 10,
        text: 'Page two discusses backpropagation and activation functions.',
        isOCR: true,
      },
    ];

    const chunks = chunkingService.chunk(pages, 'doc-123', 'notes.pdf', 'application/pdf');

    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkId).toBe('doc-123-0');
    expect(chunks[0].metadata.page).toBe(1);
    expect(chunks[0].metadata.isOCR).toBe(false);
    expect(chunks[0].metadata.charStart).toBe(0);

    expect(chunks[1].chunkId).toBe('doc-123-1');
    expect(chunks[1].metadata.page).toBe(2);
    expect(chunks[1].metadata.lineStart).toBe(10);
    expect(chunks[1].metadata.isOCR).toBe(true);
    expect(chunks[1].metadata.charStart).toBeGreaterThan(0);
  });

  it('should split large pages using sliding window', () => {
    // Generate text with 1000 words
    const longText = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
    const pages: Page[] = [
      {
        page: 5,
        text: longText,
        isOCR: false,
      },
    ];

    const chunks = chunkingService.chunk(pages, 'doc-large', 'paper.pdf', 'application/pdf', 512, 64);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata.page).toBe(5);
      expect(chunk.metadata.filename).toBe('paper.pdf');
    }
  });

  it('should handle empty pages gracefully', () => {
    const chunks = chunkingService.chunk([], 'doc-empty', 'empty.txt', 'text/plain');
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkId).toBe('doc-empty-0');
  });
});
