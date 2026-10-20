import { Chunk, ChunkMetadata, Page } from '../types';

export class ChunkingService {
  /**
   * Chunks extracted pages using a sliding window approach.
   * Window size: 512 tokens (approximated by whitespace-delimited words).
   * Overlap: 64 tokens.
   */
  public chunk(
    pages: Page[],
    docId: string,
    filename: string,
    mimeType: string,
    windowTokens = 512,
    overlapTokens = 64
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let globalChunkIndex = 0;
    let globalCharOffset = 0;

    for (const page of pages) {
      const pageText = page.text || '';
      if (!pageText.trim()) {
        continue;
      }

      // Tokenize by whitespace, tracking word boundaries
      const words = pageText.split(/\s+/);
      
      if (words.length <= windowTokens) {
        // Fits in a single chunk
        const charStart = globalCharOffset;
        const charEnd = globalCharOffset + pageText.length;
        globalCharOffset = charEnd + 1; // +1 for inter-page gap

        const metadata: ChunkMetadata = {
          docId,
          filename,
          mimeType,
          chunkIndex: globalChunkIndex,
          charStart,
          charEnd,
          isOCR: page.isOCR,
          page: page.page,
          sheet: page.sheet,
          rowStart: page.rowStart,
          lineStart: page.lineStart,
        };

        chunks.push({
          chunkId: `${docId}-${globalChunkIndex}`,
          text: pageText,
          metadata,
        });

        globalChunkIndex++;
      } else {
        // Sliding window across words
        const step = Math.max(1, windowTokens - overlapTokens);
        for (let startIdx = 0; startIdx < words.length; startIdx += step) {
          const endIdx = Math.min(startIdx + windowTokens, words.length);
          const chunkWords = words.slice(startIdx, endIdx);
          const chunkText = chunkWords.join(' ');

          // Find approximate character offsets in pageText
          const approxStart = Math.max(0, pageText.indexOf(chunkWords[0]));
          const charStart = globalCharOffset + approxStart;
          const charEnd = charStart + chunkText.length;

          const metadata: ChunkMetadata = {
            docId,
            filename,
            mimeType,
            chunkIndex: globalChunkIndex,
            charStart,
            charEnd,
            isOCR: page.isOCR,
            page: page.page,
            sheet: page.sheet,
            rowStart: page.rowStart,
            lineStart: page.lineStart,
          };

          chunks.push({
            chunkId: `${docId}-${globalChunkIndex}`,
            text: chunkText,
            metadata,
          });

          globalChunkIndex++;

          // If reached the end of words, break
          if (endIdx >= words.length) {
            break;
          }
        }

        globalCharOffset += pageText.length + 1;
      }
    }

    // Edge case: empty document
    if (chunks.length === 0) {
      chunks.push({
        chunkId: `${docId}-0`,
        text: `[Empty document: ${filename}]`,
        metadata: {
          docId,
          filename,
          mimeType,
          chunkIndex: 0,
          charStart: 0,
          charEnd: 0,
        },
      });
    }

    return chunks;
  }
}

export const chunkingService = new ChunkingService();
