import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
  Chunk,
  ExtractedGraphPayload,
  ExtractedEntity,
  ExtractedClaim,
  ExtractedRelationship,
  EntityType,
  ClaimModality,
  RelationType,
} from '../types';
import { keyManager, KeyManager } from './KeyManager';

export class GraphExtractionService {
  private keyManager: KeyManager;
  private clientFactory?: (apiKey: string) => any;
  private extractionCallCount: number = 0;

  constructor(km: KeyManager = keyManager, clientFactory?: (apiKey: string) => any) {
    this.keyManager = km;
    this.clientFactory = clientFactory;
  }

  public setKeyManager(km: KeyManager): void {
    this.keyManager = km;
  }

  public setClientFactory(factory: (apiKey: string) => any): void {
    this.clientFactory = factory;
  }

  /**
   * Mock extraction for offline and test environments.
   * Extracts entities, claims, and relations strictly from real sentences in chunk.text
   * so that exactQuote is guaranteed to be a verbatim substring of chunk.text.
   */
  public extractMock(chunk: Chunk): ExtractedGraphPayload {
    const text = chunk.text;
    if (!text || !text.trim()) {
      return { entities: [], claims: [], relationships: [] };
    }

    // Split into sentences (preserving verbatim text)
    const rawSentences = text
      .split(/(?<=[.!?\n])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 15 && text.includes(s));

    if (rawSentences.length === 0) {
      const fallbackSentence = text.trim();
      rawSentences.push(fallbackSentence);
    }

    const entities: ExtractedEntity[] = [];
    const claims: ExtractedClaim[] = [];
    const relationships: ExtractedRelationship[] = [];

    // Helper to find verbatim quotes in text
    const getSentenceForTerm = (term: string): string => {
      for (const s of rawSentences) {
        if (s.toLowerCase().includes(term.toLowerCase()) && text.includes(s)) {
          return s;
        }
      }
      return rawSentences[0];
    };

    // Relation keyword patterns to detect typed relations in sentences
    const relationKeywords: { regex: RegExp; type: RelationType; desc: string }[] = [
      { regex: /\b(?:is a|is an|are a|are an|classified as)\b/i, type: 'IS_A', desc: 'specializes or categorizes' },
      { regex: /\b(?:part of|composed of|consists of|contains|includes)\b/i, type: 'PART_OF', desc: 'component of' },
      { regex: /\b(?:requires|prerequisite|depends on|builds on)\b/i, type: 'PREREQUISITE_FOR', desc: 'prerequisite for' },
      { regex: /\b(?:causes|leads to|results in|produces)\b/i, type: 'CAUSES', desc: 'causes or produces' },
      { regex: /\b(?:uses|utilizes|applies|employed in)\b/i, type: 'USES', desc: 'uses or applies' },
      { regex: /\b(?:defines|is defined as|represents|denotes)\b/i, type: 'DEFINES', desc: 'defines' },
      { regex: /\b(?:contradicts|conflicts with|disproves|refutes)\b/i, type: 'CONTRADICTS', desc: 'contradicts' },
      { regex: /\b(?:proves|demonstrates|verifies|supports)\b/i, type: 'PROVES', desc: 'proves' },
      { regex: /\b(?:equivalent to|equal to|same as|identical to)\b/i, type: 'EQUIVALENT_TO', desc: 'equivalent to' },
    ];

    // Detect candidate entity names (capitalized multi-word or single terms, acronyms)
    const entityCandidates: { name: string; type: EntityType; sentence: string; aliases: string[] }[] = [];

    for (const sentence of rawSentences) {
      // Look for acronym with definition pattern: e.g., "Singular Value Decomposition (SVD)"
      const acronymMatch = sentence.match(/([A-Z][a-zA-Z0-9\s]+)\s*\(([A-Z]{2,6})\)/);
      if (acronymMatch) {
        const full = acronymMatch[1].trim();
        const acr = acronymMatch[2].trim();
        if (full.length >= 3 && !entityCandidates.some((e) => e.name.toLowerCase() === full.toLowerCase())) {
          entityCandidates.push({
            name: full,
            type: 'Concept',
            sentence,
            aliases: [acr],
          });
        }
      }

      // Check for formulas or theorems
      if (/\b(?:theorem|formula|equation|law|principle)\b/i.test(sentence)) {
        const match = sentence.match(/(?:[A-Z][a-z]+\s+)?(?:Theorem|Formula|Equation|Law|Principle)/i);
        if (match && !entityCandidates.some((e) => e.name.toLowerCase() === match[0].toLowerCase())) {
          entityCandidates.push({
            name: match[0],
            type: match[0].toLowerCase().includes('theorem') ? 'Theorem' : 'Formula',
            sentence,
            aliases: [],
          });
        }
      }

      // Check for methods or algorithms
      if (/\b(?:algorithm|method|model|approach|regression|classifier)\b/i.test(sentence)) {
        const match = sentence.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Algorithm|Method|Model|Approach|Regression|Classifier))/i);
        if (match && !entityCandidates.some((e) => e.name.toLowerCase() === match[0].toLowerCase())) {
          entityCandidates.push({
            name: match[0],
            type: 'Method',
            sentence,
            aliases: [],
          });
        }
      }

      // Capitalized proper nouns / concepts
      const capMatches = sentence.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g);
      if (capMatches) {
        for (const cap of capMatches) {
          if (
            cap.length >= 4 &&
            !['This', 'That', 'These', 'Those', 'There', 'When', 'What', 'Where', 'With', 'However', 'Furthermore', 'Moreover', 'In', 'The', 'For', 'And'].includes(cap) &&
            !entityCandidates.some((e) => e.name.toLowerCase() === cap.toLowerCase())
          ) {
            entityCandidates.push({
              name: cap,
              type: 'Concept',
              sentence,
              aliases: [],
            });
          }
        }
      }
    }

    // If still no entities found, take first non-trivial word
    if (entityCandidates.length === 0) {
      const words = text.split(/\s+/).filter((w) => w.length > 5);
      const fallbackName = words[0] || 'Topic';
      entityCandidates.push({
        name: fallbackName,
        type: 'Concept',
        sentence: rawSentences[0],
        aliases: [],
      });
    }

    // Limit to top 5 entities per chunk
    const selectedEntities = entityCandidates.slice(0, 5);

    for (const ent of selectedEntities) {
      entities.push({
        name: ent.name,
        type: ent.type,
        aliases: ent.aliases,
        mentionQuote: ent.sentence,
      });

      // Generate atomic claim with exact quote
      claims.push({
        subjectEntityName: ent.name,
        claimText: ent.sentence,
        modality: ent.type === 'Theorem' ? 'Rule' : 'Fact',
        confidence: 0.95,
        exactQuote: ent.sentence,
      });
    }

    // Extract relationships between entities
    for (let i = 0; i < selectedEntities.length; i++) {
      for (let j = i + 1; j < selectedEntities.length; j++) {
        const entA = selectedEntities[i];
        const entB = selectedEntities[j];

        // Find a sentence mentioning either or both
        let matchedSentence = '';
        let detectedRelType: RelationType = 'RELATED_TO';
        let desc = `${entA.name} is related to ${entB.name}`;

        for (const s of rawSentences) {
          const hasA = s.toLowerCase().includes(entA.name.toLowerCase());
          const hasB = s.toLowerCase().includes(entB.name.toLowerCase());

          if (hasA && hasB) {
            matchedSentence = s;
            for (const rk of relationKeywords) {
              if (rk.regex.test(s)) {
                detectedRelType = rk.type;
                desc = `${entA.name} ${rk.desc} ${entB.name}`;
                break;
              }
            }
            break;
          }
        }

        if (!matchedSentence) {
          // Use entA's sentence if both appear in chunk
          matchedSentence = entA.sentence;
        }

        if (matchedSentence && text.includes(matchedSentence)) {
          relationships.push({
            sourceEntityName: entA.name,
            targetEntityName: entB.name,
            relationType: detectedRelType,
            description: desc,
            confidence: 0.9,
            exactQuote: matchedSentence,
          });
        }
      }
    }

    // If no relationships between pairs, create at least one if we have >= 2 entities
    if (relationships.length === 0 && selectedEntities.length >= 2) {
      const entA = selectedEntities[0];
      const entB = selectedEntities[1];
      const sentence = entA.sentence || rawSentences[0];
      if (text.includes(sentence)) {
        relationships.push({
          sourceEntityName: entA.name,
          targetEntityName: entB.name,
          relationType: 'RELATED_TO',
          description: `${entA.name} is associated with ${entB.name}`,
          confidence: 0.85,
          exactQuote: sentence,
        });
      }
    }

    return { entities, claims, relationships };
  }

  public getExtractionCallCount(): number {
    return this.extractionCallCount;
  }

  public resetCallCount(): void {
    this.extractionCallCount = 0;
  }

  /**
   * Mock extraction for a multi-chunk window.
   * Extracts entities, claims, and relations across all chunks in the window,
   * guaranteeing that every exactQuote is a verbatim substring of one of the chunks.
   */
  public extractMockWindow(chunks: Chunk[]): ExtractedGraphPayload {
    if (!chunks || chunks.length === 0) {
      return { entities: [], claims: [], relationships: [] };
    }

    const combinedEntities: ExtractedEntity[] = [];
    const combinedClaims: ExtractedClaim[] = [];
    const combinedRelationships: ExtractedRelationship[] = [];
    const seenEntityNames = new Set<string>();

    for (const chunk of chunks) {
      const payload = this.extractMock(chunk);
      for (const ent of payload.entities) {
        const norm = ent.name.toLowerCase().trim();
        if (!seenEntityNames.has(norm)) {
          seenEntityNames.add(norm);
          combinedEntities.push(ent);
        }
      }
      combinedClaims.push(...payload.claims);
      combinedRelationships.push(...payload.relationships);
    }

    return {
      entities: combinedEntities,
      claims: combinedClaims,
      relationships: combinedRelationships,
    };
  }

  /**
   * Extracts knowledge graph payload from a multi-chunk window (2–4 chunks, ~2,000 tokens)
   * in a single LLM extraction call, reducing extraction calls by 60–75%.
   */
  public async extractWindow(chunks: Chunk[]): Promise<ExtractedGraphPayload> {
    if (!chunks || chunks.length === 0) {
      return { entities: [], claims: [], relationships: [] };
    }

    this.extractionCallCount++;

    const combinedText = chunks
      .map((c) => c.text)
      .filter((t) => t && t.trim().length > 0)
      .join('\n\n');

    if (!combinedText.trim()) {
      return { entities: [], claims: [], relationships: [] };
    }

    if (this.keyManager.getTotalKeyCount() === 0) {
      const single = process.env.GEMINI_API_KEY;
      const multi = process.env.GEMINI_API_KEYS;
      if (
        (single && single.trim() && single.trim() !== 'your_key_here') ||
        (multi && multi.trim())
      ) {
        this.keyManager.reset();
      }
    }

    if (this.keyManager.getTotalKeyCount() === 0) {
      return this.extractMockWindow(chunks);
    }

    const modelName = process.env.LLM_MODEL || 'gemini-2.0-flash';

    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        entities: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              name: { type: SchemaType.STRING, description: 'Canonical entity or concept name' },
              type: {
                type: SchemaType.STRING,
                enum: ['Concept', 'Method', 'Formula', 'Theorem', 'Property', 'Dataset', 'Person'],
              },
              aliases: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: 'Known acronyms or alternate names',
              },
              mentionQuote: {
                type: SchemaType.STRING,
                description: 'Verbatim sentence from text where entity is mentioned',
              },
            },
            required: ['name', 'type', 'mentionQuote'],
          },
        },
        claims: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              subjectEntityName: { type: SchemaType.STRING },
              claimText: { type: SchemaType.STRING },
              modality: {
                type: SchemaType.STRING,
                enum: ['Fact', 'Definition', 'Hypothesis', 'Rule'],
              },
              confidence: { type: SchemaType.NUMBER },
              exactQuote: {
                type: SchemaType.STRING,
                description: 'Verbatim sentence from text directly supporting this claim',
              },
            },
            required: ['subjectEntityName', 'claimText', 'modality', 'exactQuote'],
          },
        },
        relationships: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              sourceEntityName: { type: SchemaType.STRING },
              targetEntityName: { type: SchemaType.STRING },
              relationType: {
                type: SchemaType.STRING,
                enum: [
                  'DEFINES',
                  'IS_A',
                  'PART_OF',
                  'PREREQUISITE_FOR',
                  'CAUSES',
                  'USES',
                  'CONTRADICTS',
                  'PROVES',
                  'EQUIVALENT_TO',
                  'RELATED_TO',
                ],
              },
              description: { type: SchemaType.STRING },
              confidence: { type: SchemaType.NUMBER },
              exactQuote: {
                type: SchemaType.STRING,
                description: 'Verbatim sentence from text establishing this relationship',
              },
            },
            required: ['sourceEntityName', 'targetEntityName', 'relationType', 'exactQuote'],
          },
        },
      },
      required: ['entities', 'claims', 'relationships'],
    };

    const prompt = `You are an expert academic knowledge graph extractor.
Analyze the following text passage and extract canonical academic entities, atomic claims with modalities, and typed relationships.

CRITICAL INSTRUCTIONS:
1. Every entity, claim, and relationship MUST have an exact verbatim quote ("exactQuote" or "mentionQuote") copied character-for-character from the passage.
2. DO NOT paraphrase quotes. DO NOT extrapolate or invent facts.
3. Entities should have clean canonical names (e.g. "Singular Value Decomposition" rather than "The SVD method"). Include acronyms in "aliases".
4. Relation types must be chosen from the strict enum: DEFINES, IS_A, PART_OF, PREREQUISITE_FOR, CAUSES, USES, CONTRADICTS, PROVES, EQUIVALENT_TO, RELATED_TO.

PASSAGE:
"""${combinedText.slice(0, 24000)}"""
`;

    return await this.keyManager.executeWithFailover(async (apiKey) => {
      const genAI = this.clientFactory ? this.clientFactory(apiKey) : new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
        },
      });

      const response = await model.generateContent(prompt);
      const textOutput = response.response?.text();
      if (!textOutput) {
        throw new Error('Gemini graph extraction returned empty response');
      }

      const parsed = JSON.parse(textOutput) as ExtractedGraphPayload;
      if (!parsed || !Array.isArray(parsed.entities)) {
        throw new Error('Gemini graph extraction returned invalid JSON schema');
      }

      return parsed;
    });
  }

  /**
   * Extracts knowledge graph payload from single chunk text (delegates to extractWindow).
   */
  public async extract(chunk: Chunk): Promise<ExtractedGraphPayload> {
    return this.extractWindow([chunk]);
  }
}

export const graphExtractionService = new GraphExtractionService();
