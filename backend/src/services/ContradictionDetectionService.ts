import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { GraphStore, graphStore } from '../store/GraphStore';
import { ContradictionStore, contradictionStore } from '../store/ContradictionStore';
import { DocumentMetadataResolver } from '../utils/documentResolver';
import {
  ContradictionAlert,
  ContradictionResolution,
  ContradictionType,
  ContradictionSeverity,
} from '../types/contradiction';
import { ClaimNode, RelationshipEdge } from '../types/graph';
import { AlignedClaim } from '../types/claim';

export class ContradictionDetectionService {
  private graph: GraphStore;
  private store: ContradictionStore;
  private docResolver: DocumentMetadataResolver;
  private genAI: GoogleGenerativeAI | null = null;

  private static NEGATION_PATTERNS = [
    /\bnot\b/i,
    /\bnever\b/i,
    /\bcannot\b/i,
    /\bdoes not\b/i,
    /\bis not\b/i,
    /\bfails\b/i,
    /\bunable\b/i,
    /\bneither\b/i,
    /\bno\b/i,
    /\babsence of\b/i,
    /\bwithout\b/i,
    /\bsuboptimal\b/i,
  ];

  private static OPPOSING_RELATIONS: Record<string, string[]> = {
    CAUSES: ['PREVENTS', 'INHIBITS', 'CONTRADICTS'],
    PREVENTS: ['CAUSES', 'PROMOTES', 'PROVES'],
    USES: ['CONTRADICTS', 'INCOMPATIBLE_WITH'],
    PROVES: ['DISPROVES', 'CONTRADICTS'],
    CONTRADICTS: ['PROVES', 'SUPPORTS'],
  };

  private static SUPERSEDING_PATTERNS = [
    /superseded by/i,
    /deprecated in version/i,
    /replaces/i,
    /former definition/i,
    /previously assumed/i,
    /outdated assumption/i,
  ];

  constructor(
    graphStoreInstance: GraphStore = graphStore,
    contradictionStoreInstance: ContradictionStore = contradictionStore
  ) {
    this.graph = graphStoreInstance;
    this.store = contradictionStoreInstance;
    this.docResolver = new DocumentMetadataResolver();

    if (process.env.NODE_ENV !== 'test') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() && apiKey !== 'your_key_here') {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      }
    }
  }

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
   * Evaluates pairwise contradiction between two claims using rule-based heuristics.
   */
  public evaluatePair(
    claimA: AlignedClaim,
    claimB: AlignedClaim,
    edgeA?: RelationshipEdge,
    edgeB?: RelationshipEdge
  ): {
    isContradiction: boolean;
    type: ContradictionType;
    severity: ContradictionSeverity;
    explanation: string;
    isStaleA?: boolean;
    isStaleB?: boolean;
  } {
    // 1. Same-document check: skip intra-document comparisons
    if (claimA.docId === claimB.docId) {
      return { isContradiction: false, type: 'none', severity: 'low', explanation: 'Intra-document' };
    }

    // 2. Check opposing relation types
    if (edgeA && edgeB) {
      const opposing = ContradictionDetectionService.OPPOSING_RELATIONS[edgeA.relationType];
      if (opposing && opposing.includes(edgeB.relationType)) {
        return {
          isContradiction: true,
          type: 'direct_negation',
          severity: 'high',
          explanation: `Opposing relations: "${edgeA.relationType}" in ${claimA.filename} vs "${edgeB.relationType}" in ${claimB.filename}`,
        };
      }
    }

    // 3. Check staleness / superseded markers
    let isStaleA = false;
    let isStaleB = false;

    if (claimA.documentVersion && claimB.documentVersion && claimA.documentVersion !== claimB.documentVersion) {
      if (claimA.documentVersion < claimB.documentVersion) isStaleA = true;
      if (claimB.documentVersion < claimA.documentVersion) isStaleB = true;
    }

    for (const pat of ContradictionDetectionService.SUPERSEDING_PATTERNS) {
      if (pat.test(claimB.claimText)) isStaleA = true;
      if (pat.test(claimA.claimText)) isStaleB = true;
    }

    const textA = claimA.claimText.toLowerCase();
    const textB = claimB.claimText.toLowerCase();

    // 4. Check divergent quantities
    const numbersA = (textA.match(/\b\d+(\.\d+)?/g) || []).map(Number);
    const numbersB = (textB.match(/\b\d+(\.\d+)?/g) || []).map(Number);
    if (numbersA.length > 0 && numbersB.length > 0 && numbersA[0] !== numbersB[0]) {
      return {
        isContradiction: true,
        type: isStaleA || isStaleB ? 'stale_superseded' : 'divergent_quantities',
        severity: 'high',
        explanation: `Conflicting quantities detected: ${numbersA[0]} in ${claimA.filename} vs ${numbersB[0]} in ${claimB.filename}`,
        isStaleA,
        isStaleB,
      };
    }

    // 5. Check direct negation heuristic with keyword overlap
    const hasNegationA = ContradictionDetectionService.NEGATION_PATTERNS.some((p) => p.test(textA));
    const hasNegationB = ContradictionDetectionService.NEGATION_PATTERNS.some((p) => p.test(textB));

    if (hasNegationA !== hasNegationB) {
      const wordsA = new Set(textA.replace(/[^\w\s]/g, '').split(/\s+/));
      const wordsB = new Set(textB.replace(/[^\w\s]/g, '').split(/\s+/));
      const intersection = [...wordsA].filter((w) => wordsB.has(w) && (w.length >= 4 || ['atp', 'dna', 'rna', 'o(n)'].includes(w)));

      if (intersection.length >= 1) {
        return {
          isContradiction: true,
          type: isStaleA || isStaleB ? 'stale_superseded' : 'direct_negation',
          severity: 'high',
          explanation: `Direct negation detected over common keywords: ${intersection.slice(0, 3).join(', ')}`,
          isStaleA,
          isStaleB,
        };
      }
    }

    return {
      isContradiction: false,
      type: 'none',
      severity: 'low',
      explanation: 'No contradiction detected',
      isStaleA,
      isStaleB,
    };
  }

  /**
   * Evaluates all claims associated with a given entity across documents.
   */
  public async evaluateEntityClaims(entityId: string): Promise<ContradictionAlert[]> {
    const rawClaims = this.graph.getClaimsForEntity(entityId);
    if (rawClaims.length < 2) return [];

    const entity = this.graph.getEntity(entityId);
    const entityName = entity?.name || 'Unknown Entity';
    const alignedClaims = rawClaims.map((c) => this.hydrateClaim(c));
    const incidentEdges = this.graph.getIncidentEdges(entityId);
    const allEdges = [...incidentEdges.incoming, ...incidentEdges.outgoing];

    const generatedAlerts: ContradictionAlert[] = [];

    for (let i = 0; i < alignedClaims.length; i++) {
      for (let j = i + 1; j < alignedClaims.length; j++) {
        const cA = alignedClaims[i];
        const cB = alignedClaims[j];

        // Skip intra-document pairs
        if (cA.docId === cB.docId) continue;

        const edgeA = allEdges.find((e) => e.evidence.chunkId === cA.evidence.chunkId);
        const edgeB = allEdges.find((e) => e.evidence.chunkId === cB.evidence.chunkId);

        const evalResult = this.evaluatePair(cA, cB, edgeA, edgeB);

        if (evalResult.isContradiction) {
          const alert = this.store.create({
            claimIdA: cA.claimId,
            claimIdB: cB.claimId,
            docIdA: cA.docId,
            docIdB: cB.docId,
            entityId,
            entityName,
            quoteA: cA.evidence.exactQuote || cA.claimText,
            quoteB: cB.evidence.exactQuote || cB.claimText,
            filenameA: cA.filename,
            filenameB: cB.filename,
            type: evalResult.type,
            severity: evalResult.severity,
            explanation: evalResult.explanation,
          });

          // Tag incident edges if present
          if (edgeA) {
            edgeA.hasContradiction = true;
            edgeA.contradictionId = alert.id;
            this.graph.updateEdge(edgeA.id, edgeA);
          }
          if (edgeB) {
            edgeB.hasContradiction = true;
            edgeB.contradictionId = alert.id;
            this.graph.updateEdge(edgeB.id, edgeB);
          }

          generatedAlerts.push(alert);
        }
      }
    }

    if (generatedAlerts.length > 0) {
      await this.graph.save();
    }

    return generatedAlerts;
  }

  /**
   * Scans cross-source contradictions across the entire knowledge graph or for a newly uploaded document.
   */
  public async evaluateCrossSourceContradictions(docId?: string): Promise<ContradictionAlert[]> {
    const all = this.graph.getAll();
    const activeNodes = all.nodes.filter((n) => n.status !== 'merged');
    const allAlerts: ContradictionAlert[] = [];

    for (const node of activeNodes) {
      const alerts = await this.evaluateEntityClaims(node.id);
      allAlerts.push(...alerts);
    }

    return allAlerts;
  }

  /**
   * Resolves a contradiction alert.
   */
  public async resolveContradiction(
    alertId: string,
    resolution: ContradictionResolution,
    note?: string
  ): Promise<ContradictionAlert> {
    const resolved = this.store.resolve(alertId, resolution, note);

    // If explicit_contradicts_edge, synthesize a CONTRADICTS edge in the graph
    if (resolution === 'explicit_contradicts_edge') {
      const claimA = this.graph.getClaim(resolved.claimIdA);
      const claimB = this.graph.getClaim(resolved.claimIdB);
      if (claimA && claimB) {
        this.graph.addEdge({
          id: `contradicts_${alertId}`,
          sourceId: claimA.subjectEntityId,
          targetId: claimB.subjectEntityId,
          relationType: 'CONTRADICTS',
          description: resolved.explanation,
          confidence: 0.95,
          evidence: claimA.evidence,
          createdAt: Date.now(),
          curationStatus: 'verified',
          hasContradiction: true,
          contradictionId: alertId,
        });
        await this.graph.save();
      }
    }

    return resolved;
  }
}

export const contradictionDetectionService = new ContradictionDetectionService();
