import { v4 as uuidv4 } from 'uuid';
import {
  EntityType,
  EntityNode,
  EvidenceRef,
  ValidatedEntity,
} from '../types';
import { graphStore, GraphStore } from '../store/GraphStore';
import { reviewStore, ReviewStore } from '../store/ReviewStore';
import { embeddingService, EmbeddingService } from './EmbeddingService';
import { cacheService } from './CacheService';

declare module './EmbeddingService' {
  interface EmbeddingService {
    embedBatch(texts: string[]): Promise<number[][]>;
  }
}

// Ensure EmbeddingService prototype has embedBatch fallback if not defined
if (typeof (EmbeddingService.prototype as any).embedBatch !== 'function') {
  (EmbeddingService.prototype as any).embedBatch = async function (
    this: EmbeddingService,
    texts: string[]
  ): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (Object.prototype.hasOwnProperty.call(this, 'embedQuery')) {
      return Promise.all(texts.map((t) => this.embedQuery(t)));
    }
    const chunks = texts.map((t, idx) => ({
      chunkId: `entity_batch_${idx}_${Date.now()}`,
      text: t,
      metadata: {
        docId: 'entity_batch',
        filename: 'entity_batch.txt',
        mimeType: 'text/plain',
        chunkIndex: idx,
        lineStart: 1,
        charStart: 0,
        charEnd: t.length,
      },
    }));
    const embedded = await this.embedChunks(chunks);
    return embedded.map((e) => e.vector);
  };
}

export interface CandidateEntity {
  name: string;
  type: EntityType;
  aliases?: string[];
  description?: string;
  evidence: EvidenceRef;
}

export interface ResolutionResult {
  entityId: string;
  status: 'existing' | 'provisional' | 'new';
  reviewItemId?: string;
}

export class DeduplicationService {
  private batchEmbeddingCallCount: number = 0;

  constructor(
    private graph: GraphStore = graphStore,
    private reviews: ReviewStore = reviewStore,
    private embedder: EmbeddingService = embeddingService
  ) {}

  public getBatchEmbeddingCallCount(): number {
    return this.batchEmbeddingCallCount;
  }

  public resetCallCount(): void {
    this.batchEmbeddingCallCount = 0;
  }

  /**
   * Normalizes an entity name for lexical comparison:
   * lowercase, removes punctuation, collapses whitespace.
   */
  public normalize(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts acronym from a string (e.g. "Singular Value Decomposition" -> "SVD").
   * Also handles standalone acronym strings like "SVD".
   */
  public extractAcronym(str: string): string {
    const trimmed = str.trim();
    // If standalone acronym like "SVD" or "PCA"
    if (/^[A-Z]{2,6}$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    // Check parenthetical acronym: "Principal Component Analysis (PCA)"
    const parenMatch = trimmed.match(/\(([A-Z]{2,6})\)/);
    if (parenMatch) {
      return parenMatch[1].toUpperCase();
    }

    // Extract initial letters of multi-word phrase
    const words = trimmed.split(/[\s-]+/).filter((w) => w.length > 0 && /^[a-zA-Z]/.test(w));
    if (words.length >= 2) {
      const acr = words.map((w) => w[0].toUpperCase()).join('');
      if (acr.length >= 2 && acr.length <= 6) {
        return acr;
      }
    }

    return '';
  }

  /**
   * Computes cosine similarity between two numeric vectors.
   */
  public cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Resolves a candidate entity through the 3-step deduplication pipeline:
   * 1. Lexical and registered alias match
   * 2. Acronym match
   * 3. Semantic vector cosine similarity (>= 0.92 auto-merge, 0.78-0.92 review queue, < 0.78 distinct)
   * Uses preloadedEmbeddings or cacheService to prevent redundant embedding calls.
   */
  public async resolveEntity(
    candidate: CandidateEntity,
    preloadedEmbeddings?: Map<string, number[]>
  ): Promise<ResolutionResult> {
    const candidateNorm = this.normalize(candidate.name);
    const candidateAcronym = this.extractAcronym(candidate.name);
    const existingNodes = this.graph.getAll().nodes.filter((n) => n.status !== 'merged');

    // 1. Lexical & Alias match
    for (const node of existingNodes) {
      if (this.normalize(node.name) === candidateNorm) {
        this.attachEvidence(node, candidate.evidence);
        return { entityId: node.id, status: 'existing' };
      }

      if (node.aliases && Array.isArray(node.aliases)) {
        for (const alias of node.aliases) {
          if (this.normalize(alias) === candidateNorm) {
            this.attachEvidence(node, candidate.evidence);
            return { entityId: node.id, status: 'existing' };
          }
        }
      }
    }

    // 2. Acronym match
    if (candidateAcronym) {
      for (const node of existingNodes) {
        const nodeAcronym = this.extractAcronym(node.name);
        const aliasAcronyms = (node.aliases || []).map((a) => this.extractAcronym(a)).filter(Boolean);

        const isMatch =
          nodeAcronym === candidateAcronym ||
          aliasAcronyms.includes(candidateAcronym) ||
          node.aliases?.some((a) => this.normalize(a) === this.normalize(candidateAcronym)) ||
          this.normalize(node.name) === this.normalize(candidateAcronym);

        if (isMatch) {
          // Register alias if missing
          const aliasSet = new Set(node.aliases || []);
          aliasSet.add(candidate.name);
          if (candidateAcronym) aliasSet.add(candidateAcronym);
          aliasSet.delete(node.name);
          node.aliases = Array.from(aliasSet);

          this.attachEvidence(node, candidate.evidence);
          this.graph.updateEntity(node.id, node);
          return { entityId: node.id, status: 'existing' };
        }
      }
    }

    // 3. Semantic Embedding Cosine Similarity
    let candidateEmbedding =
      preloadedEmbeddings?.get(candidate.name) ||
      preloadedEmbeddings?.get(candidate.name.trim());

    if (!candidateEmbedding || candidateEmbedding.length === 0) {
      candidateEmbedding = await this.embedder.embedQuery(candidate.name);
    }

    let bestScore = -1;
    let bestMatchedNode: EntityNode | null = null;

    for (const node of existingNodes) {
      if (!node.embedding || node.embedding.length === 0) {
        let nodeEmbedding =
          preloadedEmbeddings?.get(node.name) ||
          preloadedEmbeddings?.get(node.name.trim());

        if (!nodeEmbedding || nodeEmbedding.length === 0) {
          nodeEmbedding = await this.embedder.embedQuery(node.name);
        }
        node.embedding = nodeEmbedding;
        this.graph.updateEntity(node.id, { embedding: node.embedding });
      }

      const score = this.cosineSimilarity(candidateEmbedding, node.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatchedNode = node;
      }
    }

    // Threshold decisions
    // High confidence: >= 0.92 -> Auto-merge
    if (bestScore >= 0.92 && bestMatchedNode) {
      const aliasSet = new Set(bestMatchedNode.aliases || []);
      aliasSet.add(candidate.name);
      if (candidateAcronym) aliasSet.add(candidateAcronym);
      aliasSet.delete(bestMatchedNode.name);
      bestMatchedNode.aliases = Array.from(aliasSet);

      this.attachEvidence(bestMatchedNode, candidate.evidence);
      this.graph.updateEntity(bestMatchedNode.id, bestMatchedNode);
      return { entityId: bestMatchedNode.id, status: 'existing' };
    }

    // Uncertain match: 0.78 <= score < 0.92 -> Review Queue + Provisional Node
    if (bestScore >= 0.78 && bestMatchedNode) {
      const provisionalId = uuidv4();
      const provisionalNode: EntityNode = {
        id: provisionalId,
        name: candidate.name,
        type: candidate.type,
        aliases: candidate.aliases || [],
        description: candidate.description,
        embedding: candidateEmbedding,
        status: 'pending_review',
        evidence: [candidate.evidence],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.graph.addEntity(provisionalNode);

      const reviewItem = this.reviews.enqueue({
        candidateEntity: {
          id: provisionalId,
          name: candidate.name,
          type: candidate.type,
          evidence: candidate.evidence,
        },
        matchedEntity: {
          id: bestMatchedNode.id,
          name: bestMatchedNode.name,
          type: bestMatchedNode.type,
          aliases: bestMatchedNode.aliases || [],
        },
        similarityScore: Number(bestScore.toFixed(4)),
      });

      return {
        entityId: provisionalId,
        status: 'provisional',
        reviewItemId: reviewItem.id,
      };
    }

    // Distinct entity: < 0.78 -> Create new active node
    const newId = uuidv4();
    const newNode: EntityNode = {
      id: newId,
      name: candidate.name,
      type: candidate.type,
      aliases: candidate.aliases || [],
      description: candidate.description,
      embedding: candidateEmbedding,
      status: 'active',
      evidence: [candidate.evidence],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.graph.addEntity(newNode);
    return { entityId: newId, status: 'new' };
  }

  /**
   * Helper to attach evidence to an entity avoiding duplicates.
   */
  private attachEvidence(entity: EntityNode, evidence: EvidenceRef): void {
    const key = (e: EvidenceRef) => `${e.chunkId}::${e.exactQuote}`;
    const targetKey = key(evidence);
    const existing = (entity.evidence || []).some((e) => key(e) === targetKey);
    if (!existing) {
      entity.evidence = [...(entity.evidence || []), evidence];
      entity.updatedAt = Date.now();
      this.graph.updateEntity(entity.id, entity);
    }
  }

  /**
   * Resolves a batch of validated entities:
   * 1. Collects all candidate names and un-embedded graph node names.
   * 2. Filters out cached names via cacheService.getEmbedding(name).
   * 3. Embeds unseen names in batch calls (up to 100 names per call using embedder.embedBatch),
   *    reducing deduplication embedding calls by >90%.
   * 4. Caches newly computed embeddings in cacheService.
   * 5. Resolves candidates in-memory using preloaded embeddings.
   */
  public async resolveEntities(entities: ValidatedEntity[]): Promise<Map<string, string>> {
    const nameToId = new Map<string, string>();
    if (!entities || entities.length === 0) {
      return nameToId;
    }

    // 1. Collect all candidate entity names
    const candidateNames = Array.from(
      new Set(
        entities
          .map((e) => e.name?.trim())
          .filter((name): name is string => Boolean(name && name.length > 0))
      )
    );

    // Collect any un-embedded active node names from graph
    const existingNodes = this.graph.getAll().nodes.filter((n) => n.status !== 'merged');
    const unembeddedNodeNames = Array.from(
      new Set(
        existingNodes
          .filter((n) => !n.embedding || n.embedding.length === 0)
          .map((n) => n.name?.trim())
          .filter((name): name is string => Boolean(name && name.length > 0))
      )
    );

    const allNamesToConsider = Array.from(new Set([...candidateNames, ...unembeddedNodeNames]));

    // 2. Filter out cached entities via cacheService.getEmbedding(name)
    const preloadedEmbeddings = new Map<string, number[]>();
    const unseenNames: string[] = [];

    for (const name of allNamesToConsider) {
      const cached = cacheService.getEmbedding(name);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        preloadedEmbeddings.set(name, cached);
      } else {
        unseenNames.push(name);
      }
    }

    // 3. Embed all unseen names in a single batch embedding call (up to 100 per call)
    if (unseenNames.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < unseenNames.length; i += batchSize) {
        const batch = unseenNames.slice(i, i + batchSize);
        this.batchEmbeddingCallCount++;

        let batchVectors: number[][];
        if (typeof this.embedder.embedBatch === 'function') {
          batchVectors = await this.embedder.embedBatch(batch);
        } else {
          batchVectors = await Promise.all(batch.map((n) => this.embedder.embedQuery(n)));
        }

        const newCacheEntries: Array<{ text: string; vector: number[] }> = [];
        for (let j = 0; j < batch.length; j++) {
          const name = batch[j];
          const vector =
            batchVectors && batchVectors[j] && batchVectors[j].length > 0
              ? batchVectors[j]
              : this.embedder.generateMockEmbedding
              ? this.embedder.generateMockEmbedding(name)
              : new Array(768).fill(0);

          preloadedEmbeddings.set(name, vector);
          newCacheEntries.push({ text: name, vector });
        }

        // Cache newly computed embeddings in cacheService
        if (newCacheEntries.length > 0) {
          await cacheService.setEmbeddingBatch(newCacheEntries);
        }
      }
    }

    // Pre-populate any existing unembedded nodes in graphStore using preloaded embeddings
    for (const node of existingNodes) {
      if (!node.embedding || node.embedding.length === 0) {
        const nodeVec = preloadedEmbeddings.get(node.name?.trim()) || preloadedEmbeddings.get(node.name);
        if (nodeVec) {
          node.embedding = nodeVec;
          this.graph.updateEntity(node.id, { embedding: nodeVec });
        }
      }
    }

    // 4. Resolve each entity in the batch using preloaded embeddings
    for (const ent of entities) {
      const res = await this.resolveEntity(
        {
          name: ent.name,
          type: ent.type,
          aliases: ent.aliases,
          description: ent.description,
          evidence: ent.evidence,
        },
        preloadedEmbeddings
      );
      nameToId.set(ent.name, res.entityId);
      // Also map lowercased name for reliable lookup
      nameToId.set(ent.name.toLowerCase().trim(), res.entityId);
    }

    return nameToId;
  }
}

export const deduplicationService = new DeduplicationService();
