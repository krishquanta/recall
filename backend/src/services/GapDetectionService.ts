import { GraphStore, graphStore } from '../store/GraphStore';
import { ContradictionStore } from '../store/ContradictionStore';
import { MetadataStore, metadataStore } from '../store/MetadataStore';
import { InvestigationGap } from '../types';

// Singleton instance of ContradictionStore
let defaultContradictionStore: ContradictionStore | null = null;
function getDefaultContradictionStore(): ContradictionStore {
  if (!defaultContradictionStore) {
    defaultContradictionStore = new ContradictionStore();
  }
  return defaultContradictionStore;
}

export class GapDetectionService {
  constructor(
    private graphStoreInstance: GraphStore = graphStore,
    private contradictionStoreInstance?: ContradictionStore,
    private metadataStoreInstance: MetadataStore = metadataStore
  ) {}

  private getContradictionStore(): ContradictionStore {
    return this.contradictionStoreInstance || getDefaultContradictionStore();
  }

  /**
   * Audits active graph and returns ranked gaps sorted by priorityScore descending.
   */
  public detectGaps(): InvestigationGap[] {
    const contradictions = this.findUnresolvedContradictions();
    const staleClaims = this.findStaleClaims();
    const isolatedEntities = this.findIsolatedEntities(2);
    const singleSourceClaims = this.findSingleSourceClaims();

    const allGaps: InvestigationGap[] = [
      ...contradictions,
      ...staleClaims,
      ...isolatedEntities,
      ...singleSourceClaims,
    ];

    // Deduplicate gaps by id
    const seen = new Set<string>();
    const deduped: InvestigationGap[] = [];

    for (const gap of allGaps) {
      if (!seen.has(gap.id)) {
        seen.add(gap.id);
        deduped.push(gap);
      }
    }

    // Sort by priorityScore descending
    return deduped.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  /**
   * Wraps active ContradictionAlerts as investigation gaps.
   */
  public findUnresolvedContradictions(): InvestigationGap[] {
    const store = this.getContradictionStore();
    const alerts = store.getActive ? store.getActive() : store.getAll().filter((a) => a.status === 'active');

    return alerts.map((alert) => {
      let priorityScore = 0.90;
      if (alert.severity === 'high') priorityScore = 0.98;
      else if (alert.severity === 'medium') priorityScore = 0.95;

      const entityName = alert.entityName || 'Conflicting Claims';
      let suggestedQuestion = `What is the consensus resolution regarding ${entityName}?`;
      if (alert.reconciliationHint) {
        suggestedQuestion = `What is the consensus resolution regarding ${entityName}: ${alert.reconciliationHint}?`;
      } else if (alert.quoteA && alert.quoteB) {
        const qA = alert.quoteA.length > 60 ? alert.quoteA.slice(0, 60) + '...' : alert.quoteA;
        const qB = alert.quoteB.length > 60 ? alert.quoteB.slice(0, 60) + '...' : alert.quoteB;
        suggestedQuestion = `What is the scientific consensus regarding ${entityName} between "${qA}" and "${qB}"?`;
      }

      return {
        id: `gap_contra_${alert.id}`,
        type: 'CONTRADICTION',
        title: `Contradiction: ${entityName}`,
        description: alert.explanation || `Contradicting claims detected between documents for ${entityName}.`,
        suggestedQuestion,
        priorityScore,
        targetEntityIds: alert.entityId ? [alert.entityId] : [],
        targetClaimIds: [alert.claimIdA, alert.claimIdB].filter(Boolean),
        contradictionId: alert.id,
        detectedAt: new Date(alert.detectedAt || Date.now()).toISOString(),
      };
    });
  }

  /**
   * Finds ClaimNodes with isStale: true.
   */
  public findStaleClaims(): InvestigationGap[] {
    const claims = this.graphStoreInstance.getAllClaims
      ? this.graphStoreInstance.getAllClaims()
      : this.graphStoreInstance.getAll().claims;

    const stale = claims.filter((c) => c.isStale === true);

    return stale.map((claim) => {
      const entity = claim.subjectEntityId
        ? this.graphStoreInstance.getEntity(claim.subjectEntityId)
        : undefined;
      const subjectName =
        entity?.name ||
        claim.subject ||
        (claim.claimText.length > 50 ? claim.claimText.slice(0, 50) + '...' : claim.claimText);
      return {
        id: `gap_stale_${claim.id}`,
        type: 'STALE_CLAIM',
        title: `Stale Claim: ${subjectName}`,
        description: `Claim "${claim.claimText}" is marked as stale or superseded by newer information.`,
        suggestedQuestion: `What is the latest updated research consensus on ${subjectName}?`,
        priorityScore: 0.75,
        targetEntityIds: claim.subjectEntityId ? [claim.subjectEntityId] : [],
        targetClaimIds: [claim.id],
        detectedAt: new Date(claim.createdAt || Date.now()).toISOString(),
      };
    });
  }

  /**
   * Detects entities with degree < threshold (default 2, counting non-rejected edges).
   */
  public findIsolatedEntities(minDegree = 2): InvestigationGap[] {
    const { nodes } = this.graphStoreInstance.getAll();
    const activeNodes = nodes.filter((n) => n.status !== 'merged');
    const gaps: InvestigationGap[] = [];

    for (const node of activeNodes) {
      const { incoming, outgoing } = this.graphStoreInstance.getIncidentEdges(node.id);
      const uniqueEdgeMap = new Map<string, (typeof incoming)[0]>();
      for (const e of [...incoming, ...outgoing]) {
        if (e.curationStatus !== 'rejected') {
          uniqueEdgeMap.set(e.id, e);
        }
      }

      const degree = uniqueEdgeMap.size;
      if (degree < minDegree) {
        gaps.push({
          id: `gap_iso_${node.id}`,
          type: 'ISOLATED_ENTITY',
          title: `Isolated Concept: ${node.name}`,
          description: `Concept has only ${degree} verified connection(s) in the knowledge base.`,
          suggestedQuestion: `What are the foundational principles, related concepts, and practical applications of ${node.name}?`,
          priorityScore: 0.45,
          targetEntityIds: [node.id],
          detectedAt: new Date(node.createdAt || Date.now()).toISOString(),
        });
      }
    }

    return gaps;
  }

  /**
   * Finds entities whose claims come from only a single document.
   */
  public findSingleSourceClaims(): InvestigationGap[] {
    const claims = this.graphStoreInstance.getAllClaims
      ? this.graphStoreInstance.getAllClaims()
      : this.graphStoreInstance.getAll().claims;

    // Group claims by subjectEntityId
    const claimsByEntity = new Map<string, typeof claims>();
    for (const c of claims) {
      if (!c.subjectEntityId) continue;
      const list = claimsByEntity.get(c.subjectEntityId) || [];
      list.push(c);
      claimsByEntity.set(c.subjectEntityId, list);
    }

    const gaps: InvestigationGap[] = [];

    for (const [entityId, entityClaims] of claimsByEntity.entries()) {
      const entity = this.graphStoreInstance.getEntity(entityId);
      if (!entity || entity.status === 'merged') continue;

      const docIds = new Set(
        entityClaims.map((c) => c.evidence?.docId).filter((d): d is string => Boolean(d))
      );

      if (docIds.size === 1 && entityClaims.length > 0) {
        gaps.push({
          id: `gap_weak_${entity.id}`,
          type: 'WEAK_GROUNDING',
          title: `Single-Source Grounding: ${entity.name}`,
          description: `All claims for ${entity.name} originate from a single document. External corroboration recommended.`,
          suggestedQuestion: `What independent literature, research papers, or textbooks corroborate ${entity.name}?`,
          priorityScore: 0.55,
          targetEntityIds: [entity.id],
          targetClaimIds: entityClaims.map((c) => c.id),
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return gaps;
  }

  /**
   * Formulates a targeted research prompt from a specific gap.
   */
  public formulateQuestionForGap(gap: InvestigationGap): string {
    if (gap.suggestedQuestion && gap.suggestedQuestion.trim().length > 0) {
      return gap.suggestedQuestion.trim();
    }

    switch (gap.type) {
      case 'CONTRADICTION':
        return `What is the scientific and academic consensus resolving ${gap.title}?`;
      case 'STALE_CLAIM':
        return `What is the updated research consensus on ${gap.title}?`;
      case 'ISOLATED_ENTITY':
        return `What are the foundational principles, related concepts, and applications of ${gap.title}?`;
      case 'WEAK_GROUNDING':
        return `What independent peer-reviewed literature or educational resources support ${gap.title}?`;
      default:
        return `Explain the details, properties, and relationships of ${gap.title}.`;
    }
  }
}

export const gapDetectionService = new GapDetectionService();
