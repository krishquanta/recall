import { GraphStore, graphStore } from '../store/GraphStore';
import { EmbeddingService, embeddingService } from './EmbeddingService';
import { DocumentMetadataResolver } from '../utils/documentResolver';
import {
  AlignedClaim,
  ClaimTopicGroup,
  ClaimComparisonCluster,
  CompareClaimsOptions,
} from '../types/claim';
import { ClaimNode } from '../types/graph';

export class ClaimComparisonService {
  private graph: GraphStore;
  private embedder: EmbeddingService;
  private docResolver: DocumentMetadataResolver;

  constructor(
    graphStoreInstance: GraphStore = graphStore,
    embeddingServiceInstance: EmbeddingService = embeddingService
  ) {
    this.graph = graphStoreInstance;
    this.embedder = embeddingServiceInstance;
    this.docResolver = new DocumentMetadataResolver();
  }

  /**
   * Computes cosine similarity between two numeric vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
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
   * Derives a topic key from claim text using keyword extraction or topic patterns.
   */
  private extractTopicName(text: string): string {
    const t = text.toLowerCase();
    if (t.includes('mitochondri') || t.includes('atp')) return 'Cellular Energy & ATP';
    if (t.includes('photosynthe') || t.includes('chloroplast')) return 'Photosynthesis';
    if (t.includes('enzyme') || t.includes('activation energy') || t.includes('catalys')) return 'Enzyme Kinetics';
    if (t.includes('bellman')) return 'Bellman-Ford Algorithm';
    if (t.includes('dijkstra')) return 'Dijkstra Shortest Path';
    if (t.includes('time complexity') || t.includes('o(') || t.includes('o(n')) return 'Computational Complexity';
    if (t.includes('knapsack')) return 'Knapsack Optimization';

    // Fallback: extract first capitalized phrase or primary noun phrase
    const words = text.split(/\s+/).filter((w) => w.length > 4);
    if (words.length > 0) {
      return words.slice(0, 3).join(' ');
    }
    return 'General Properties';
  }

  /**
   * Computes pairwise consensus score in [0.0, 1.0] across aligned claims.
   */
  public async computeConsensus(claims: AlignedClaim[]): Promise<number> {
    if (claims.length <= 1) return 1.0;

    const vectors: number[][] = [];
    for (const claim of claims) {
      const vec = await this.embedder.embedQuery(claim.claimText);
      vectors.push(vec);
    }

    let pairCount = 0;
    let totalSim = 0;

    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const rawCosine = this.cosineSimilarity(vectors[i], vectors[j]);
        // Normalize cosine from [-1.0, 1.0] to [0.0, 1.0]
        const normalized = Math.max(0.0, Math.min(1.0, (rawCosine + 1.0) / 2.0));
        totalSim += normalized;
        pairCount++;
      }
    }

    return pairCount > 0 ? Number((totalSim / pairCount).toFixed(4)) : 1.0;
  }

  /**
   * Hydrates raw ClaimNode into an AlignedClaim with resolved document metadata.
   */
  private hydrateClaim(claim: ClaimNode): AlignedClaim {
    const docMeta = this.docResolver.resolve(claim.evidence.docId, claim.evidence);
    return {
      claimId: claim.id,
      claimText: claim.claimText,
      docId: claim.evidence.docId,
      filename: docMeta.filename,
      evidence: claim.evidence,
      confidence: claim.confidence,
      modality: claim.modality,
      documentDate: docMeta.documentDate,
      documentVersion: docMeta.documentVersion,
      isStale: false,
    };
  }

  /**
   * Compares all claims for an entity across different documents.
   * Returns an array of ClaimComparisonCluster (one per entity).
   */
  public async compareEntityClaims(
    entityId: string,
    options: CompareClaimsOptions = {}
  ): Promise<ClaimComparisonCluster[]> {
    const entity = this.graph.getEntity(entityId);
    const entityName = entity?.name || 'Unknown Entity';
    const rawClaims = this.graph.getClaimsForEntity(entityId);

    if (rawClaims.length === 0) {
      return [
        {
          entityId,
          entityName,
          claimGroups: [],
        },
      ];
    }

    const alignedClaims: AlignedClaim[] = rawClaims.map((c) => this.hydrateClaim(c));

    // Group claims by topic
    const topicMap = new Map<string, AlignedClaim[]>();
    for (const ac of alignedClaims) {
      const topic = this.extractTopicName(ac.claimText);
      if (!topicMap.has(topic)) {
        topicMap.set(topic, []);
      }
      topicMap.get(topic)!.push(ac);
    }

    const claimGroups: ClaimTopicGroup[] = [];

    for (const [topic, groupClaims] of topicMap.entries()) {
      // Determine multi-source presence
      const docIds = new Set(groupClaims.map((c) => c.docId));
      if (!options.includeSingleDoc && docIds.size < 2) {
        continue;
      }

      // Calculate consensus score
      const consensusScore = await this.computeConsensus(groupClaims);

      // Check for simple negation or conflicting signals
      let hasContradiction = false;
      const lowerTexts = groupClaims.map((c) => c.claimText.toLowerCase());
      const hasNegation = lowerTexts.some((t) => /\b(not|never|cannot|fails|suboptimal)\b/i.test(t));
      const hasAffirmation = lowerTexts.some((t) => /\b(optimal|guarantees|always|is a|proves)\b/i.test(t));
      if (hasNegation && hasAffirmation && docIds.size >= 2) {
        hasContradiction = true;
      }

      // Check for stale claims based on version or dates
      let hasStaleClaim = false;
      const versions = groupClaims.map((c) => c.documentVersion || 1);
      const maxVersion = Math.max(...versions);
      for (const claim of groupClaims) {
        if (claim.documentVersion && claim.documentVersion < maxVersion) {
          claim.isStale = true;
          hasStaleClaim = true;
        }
      }

      claimGroups.push({
        topic,
        claims: groupClaims,
        consensusScore: hasContradiction ? Math.min(consensusScore, 0.45) : consensusScore,
        hasContradiction,
        hasStaleClaim,
      });
    }

    return [
      {
        entityId,
        entityName,
        claimGroups,
      },
    ];
  }

  /**
   * Generates comparison clusters across all entities in the graph.
   */
  public async compareAllEntities(): Promise<ClaimComparisonCluster[]> {
    const all = this.graph.getAll();
    const activeNodes = all.nodes.filter((n) => n.status !== 'merged');
    const results: ClaimComparisonCluster[] = [];

    for (const node of activeNodes) {
      const clusters = await this.compareEntityClaims(node.id, { includeSingleDoc: false });
      if (clusters[0] && clusters[0].claimGroups.length > 0) {
        results.push(clusters[0]);
      }
    }

    return results;
  }
}

export const claimComparisonService = new ClaimComparisonService();
