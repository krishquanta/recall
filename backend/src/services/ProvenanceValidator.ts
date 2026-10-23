import {
  Chunk,
  ExtractedGraphPayload,
  ValidatedGraphPayload,
  ValidatedEntity,
  ValidatedClaim,
  ValidatedRelationship,
  EvidenceRef,
} from '../types';

export class ProvenanceValidator {
  /**
   * Normalizes text for comparison by collapsing whitespace and trimming.
   */
  private static normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Attempts exact match first, then sliding window alignment against chunk.text.
   * Returns verbatim substring and character offsets { start, end } if found, or null if ungrounded.
   */
  public static findVerbatimAnchor(
    chunkText: string,
    quote: string
  ): { exactQuote: string; charOffset: { start: number; end: number } } | null {
    if (!quote || typeof quote !== 'string') return null;
    const trimmedQuote = quote.trim();
    if (trimmedQuote.length === 0) return null;

    // 1. Exact match
    const exactIdx = chunkText.indexOf(trimmedQuote);
    if (exactIdx !== -1) {
      return {
        exactQuote: trimmedQuote,
        charOffset: {
          start: exactIdx,
          end: exactIdx + trimmedQuote.length,
        },
      };
    }

    // Case-insensitive exact match
    const lowerChunk = chunkText.toLowerCase();
    const lowerQuote = trimmedQuote.toLowerCase();
    const lowerIdx = lowerChunk.indexOf(lowerQuote);
    if (lowerIdx !== -1) {
      const verbatim = chunkText.substring(lowerIdx, lowerIdx + trimmedQuote.length);
      return {
        exactQuote: verbatim,
        charOffset: {
          start: lowerIdx,
          end: lowerIdx + verbatim.length,
        },
      };
    }

    // 2. Normalized whitespace alignment
    const normQuote = this.normalizeWhitespace(trimmedQuote);
    const quoteWords = normQuote.split(' ').filter(Boolean);
    if (quoteWords.length === 0) return null;

    // Fast boundary search using initial and final tokens
    const firstWord = quoteWords[0].replace(/[^\w]/g, '').toLowerCase();
    const lastWord = quoteWords[quoteWords.length - 1].replace(/[^\w]/g, '').toLowerCase();

    // Look for matching window
    let bestMatch: { start: number; end: number; score: number } | null = null;
    const minLength = Math.max(1, Math.floor(trimmedQuote.length * 0.75));
    const maxLength = Math.ceil(trimmedQuote.length * 1.35);

    // Scan chunk for candidate starts matching firstWord
    const chunkTokens = chunkText.split(/(\s+)/); // preserves whitespace tokens
    let charPos = 0;
    const tokenPositions: { token: string; start: number; end: number }[] = [];
    for (const t of chunkTokens) {
      tokenPositions.push({ token: t, start: charPos, end: charPos + t.length });
      charPos += t.length;
    }

    const nonSpaceTokens = tokenPositions.filter((tp) => tp.token.trim().length > 0);

    for (let i = 0; i < nonSpaceTokens.length; i++) {
      const cleanToken = nonSpaceTokens[i].token.replace(/[^\w]/g, '').toLowerCase();
      if (cleanToken === firstWord || cleanToken.includes(firstWord) || firstWord.includes(cleanToken)) {
        // Candidate start found
        const startChar = nonSpaceTokens[i].start;

        for (let j = i; j < nonSpaceTokens.length; j++) {
          const endChar = nonSpaceTokens[j].end;
          const windowLen = endChar - startChar;
          if (windowLen > maxLength) break;
          if (windowLen >= minLength) {
            const cleanEndToken = nonSpaceTokens[j].token.replace(/[^\w]/g, '').toLowerCase();
            if (cleanEndToken === lastWord || cleanEndToken.includes(lastWord) || lastWord.includes(cleanEndToken)) {
              // Candidate window [startChar, endChar]
              const candidate = chunkText.substring(startChar, endChar);
              const candidateNorm = this.normalizeWhitespace(candidate);

              // Calculate token overlap score
              const candidateWords = candidateNorm.split(' ').map((w) => w.toLowerCase());
              let matchedCount = 0;
              for (const qw of quoteWords) {
                const cleanQw = qw.replace(/[^\w]/g, '').toLowerCase();
                if (cleanQw && candidateWords.some((cw) => cw.includes(cleanQw) || cleanQw.includes(cw))) {
                  matchedCount++;
                }
              }

              const overlap = matchedCount / quoteWords.length;
              if (overlap >= 0.75 && (!bestMatch || overlap > bestMatch.score)) {
                bestMatch = { start: startChar, end: endChar, score: overlap };
                if (overlap === 1) break;
              }
            }
          }
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.75) {
      const verbatim = chunkText.substring(bestMatch.start, bestMatch.end);
      return {
        exactQuote: verbatim,
        charOffset: {
          start: bestMatch.start,
          end: bestMatch.end,
        },
      };
    }

    // Ungrounded / not found
    return null;
  }

  /**
   * Enforces the Definition of Done:
   * Validates that every extracted relationship, claim, and entity is anchored
   * to a verifiable text passage in chunk.text (or across a multi-chunk window).
   * Matches verbatim quotes against each chunk in the window and assigns
   * specific source chunkId, docId, page, and charOffset.
   * Ungrounded assertions are strictly discarded.
   */
  public static validateAndAnchor(
    chunkOrChunks: Chunk | Chunk[],
    payload: ExtractedGraphPayload
  ): ValidatedGraphPayload {
    const chunks = Array.isArray(chunkOrChunks) ? chunkOrChunks : [chunkOrChunks];
    if (chunks.length === 0) {
      return { entities: [], claims: [], relationships: [] };
    }

    const createEvidence = (
      targetChunk: Chunk,
      exactQuote: string,
      charOffset: { start: number; end: number }
    ): EvidenceRef => {
      const meta = targetChunk.metadata;
      return {
        docId: meta.docId,
        chunkId: targetChunk.chunkId,
        filename: meta.filename,
        page: meta.page,
        slide: meta.slide,
        sheet: meta.sheet,
        rowStart: meta.rowStart,
        lineStart: meta.lineStart,
        exactQuote,
        charOffset,
      };
    };

    // Helper to search across chunks in the window for a verbatim anchor
    const findAnchorInChunks = (
      quote: string,
      fallbackText?: string
    ): { targetChunk: Chunk; exactQuote: string; charOffset: { start: number; end: number } } | null => {
      for (const c of chunks) {
        const anchor = this.findVerbatimAnchor(c.text, quote);
        if (anchor) {
          return { targetChunk: c, exactQuote: anchor.exactQuote, charOffset: anchor.charOffset };
        }
      }
      if (fallbackText) {
        for (const c of chunks) {
          const anchor = this.findVerbatimAnchor(c.text, fallbackText);
          if (anchor) {
            return { targetChunk: c, exactQuote: anchor.exactQuote, charOffset: anchor.charOffset };
          }
        }
      }
      return null;
    };

    // 1. Validate entities
    const validatedEntities: ValidatedEntity[] = [];
    for (const ent of payload.entities || []) {
      if (!ent.name || !ent.name.trim()) continue;

      const quoteToTest = ent.mentionQuote || ent.exactQuote || ent.name;
      const anchorMatch = findAnchorInChunks(quoteToTest, ent.name);

      if (anchorMatch) {
        validatedEntities.push({
          ...ent,
          name: ent.name.trim(),
          evidence: createEvidence(anchorMatch.targetChunk, anchorMatch.exactQuote, anchorMatch.charOffset),
        });
      }
    }

    // 2. Validate relationships
    const validatedRelationships: ValidatedRelationship[] = [];
    for (const rel of payload.relationships || []) {
      if (!rel.sourceEntityName || !rel.targetEntityName || !rel.relationType) continue;

      const anchorMatch = findAnchorInChunks(rel.exactQuote);
      if (anchorMatch) {
        validatedRelationships.push({
          sourceEntityName: rel.sourceEntityName.trim(),
          targetEntityName: rel.targetEntityName.trim(),
          relationType: rel.relationType,
          description: rel.description?.trim() || `${rel.sourceEntityName} ${rel.relationType} ${rel.targetEntityName}`,
          confidence: typeof rel.confidence === 'number' ? Math.max(0, Math.min(1, rel.confidence)) : 0.9,
          exactQuote: anchorMatch.exactQuote,
          evidence: createEvidence(anchorMatch.targetChunk, anchorMatch.exactQuote, anchorMatch.charOffset),
        });
      }
    }

    // 3. Validate claims
    const validatedClaims: ValidatedClaim[] = [];
    for (const claim of payload.claims || []) {
      if (!claim.subjectEntityName || !claim.claimText) continue;

      const anchorMatch = findAnchorInChunks(claim.exactQuote, claim.claimText);
      if (anchorMatch) {
        validatedClaims.push({
          subjectEntityName: claim.subjectEntityName.trim(),
          claimText: claim.claimText.trim(),
          modality: claim.modality || 'Fact',
          confidence: typeof claim.confidence === 'number' ? Math.max(0, Math.min(1, claim.confidence)) : 0.9,
          exactQuote: anchorMatch.exactQuote,
          evidence: createEvidence(anchorMatch.targetChunk, anchorMatch.exactQuote, anchorMatch.charOffset),
        });
      }
    }

    return {
      entities: validatedEntities,
      claims: validatedClaims,
      relationships: validatedRelationships,
    };
  }

  /**
   * Explicit alias for validating and anchoring extracted graph payload across a multi-chunk window.
   */
  public static validateAndAnchorWindow(
    chunks: Chunk[],
    payload: ExtractedGraphPayload
  ): ValidatedGraphPayload {
    return this.validateAndAnchor(chunks, payload);
  }
}
