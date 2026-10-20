import fs from 'fs';
import path from 'path';
import {
  EntityNode,
  RelationshipEdge,
  ClaimNode,
  EvidenceRef,
} from '../types';

export interface GraphData {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  claims: ClaimNode[];
}

export class GraphStore {
  private filePath: string;
  private nodes: Map<string, EntityNode> = new Map();
  private edges: Map<string, RelationshipEdge> = new Map();
  private claims: Map<string, ClaimNode> = new Map();
  private incomingEdges: Map<string, string[]> = new Map();
  private outgoingEdges: Map<string, string[]> = new Map();
  private nameToEntityId: Map<string, string> = new Map();
  private isLoaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = filePath || path.join(dataDir, 'graph.json');
    this.ensureDir();
    this.loadSync();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');
  }

  private indexEntityName(entity: EntityNode): void {
    const norm = this.normalizeName(entity.name);
    if (norm) {
      this.nameToEntityId.set(norm, entity.id);
    }
    if (entity.aliases && Array.isArray(entity.aliases)) {
      for (const alias of entity.aliases) {
        const normAlias = this.normalizeName(alias);
        if (normAlias) {
          this.nameToEntityId.set(normAlias, entity.id);
        }
      }
    }
  }

  private rebuildIndices(): void {
    this.incomingEdges.clear();
    this.outgoingEdges.clear();
    this.nameToEntityId.clear();

    for (const node of this.nodes.values()) {
      if (node.status !== 'merged') {
        this.indexEntityName(node);
      }
    }

    for (const edge of this.edges.values()) {
      // Outgoing from sourceId
      const outList = this.outgoingEdges.get(edge.sourceId) || [];
      outList.push(edge.id);
      this.outgoingEdges.set(edge.sourceId, outList);

      // Incoming to targetId
      const inList = this.incomingEdges.get(edge.targetId) || [];
      inList.push(edge.id);
      this.incomingEdges.set(edge.targetId, inList);
    }
  }

  public loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        this.nodes.clear();
        this.edges.clear();
        this.claims.clear();

        const rawNodes = parsed.nodes
          ? Array.isArray(parsed.nodes)
            ? parsed.nodes
            : Object.values(parsed.nodes)
          : [];
        for (const n of rawNodes as EntityNode[]) {
          if (n && n.id) {
            this.nodes.set(n.id, n);
          }
        }

        const rawEdges = parsed.edges
          ? Array.isArray(parsed.edges)
            ? parsed.edges
            : Object.values(parsed.edges)
          : [];
        for (const e of rawEdges as RelationshipEdge[]) {
          if (e && e.id) {
            this.edges.set(e.id, e);
          }
        }

        const rawClaims = parsed.claims
          ? Array.isArray(parsed.claims)
            ? parsed.claims
            : Object.values(parsed.claims)
          : [];
        for (const c of rawClaims as ClaimNode[]) {
          if (c && c.id) {
            this.claims.set(c.id, c);
          }
        }

        this.rebuildIndices();
      }
      this.isLoaded = true;
    } catch (err) {
      console.error(`Failed to load graph from ${this.filePath}:`, err);
      this.nodes.clear();
      this.edges.clear();
      this.claims.clear();
      this.rebuildIndices();
      this.isLoaded = true;
    }
  }

  public async load(): Promise<void> {
    this.loadSync();
  }

  public async save(): Promise<void> {
    return this.persist();
  }

  private async persist(): Promise<void> {
    this.writeLock = this.writeLock
      .then(async () => {
        this.ensureDir();
        // SDD format: Record of nodes, edges, claims
        const serialized = {
          nodes: Object.fromEntries(this.nodes.entries()),
          edges: Object.fromEntries(this.edges.entries()),
          claims: Object.fromEntries(this.claims.entries()),
        };

        const tempPath = `${this.filePath}.tmp.${Date.now()}`;
        try {
          await fs.promises.writeFile(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
          try {
            await fs.promises.rename(tempPath, this.filePath);
          } catch {
            await fs.promises.copyFile(tempPath, this.filePath);
            await fs.promises.unlink(tempPath).catch(() => {});
          }
        } catch (err) {
          await fs.promises.writeFile(this.filePath, JSON.stringify(serialized, null, 2), 'utf-8');
        }
      })
      .catch((err) => {
        console.error(`Error saving graph to ${this.filePath}:`, err);
      });

    return this.writeLock;
  }

  public addEntity(entity: EntityNode): void {
    if (!this.isLoaded) this.loadSync();
    this.nodes.set(entity.id, entity);
    this.indexEntityName(entity);
  }

  public updateEntity(id: string, patch: Partial<EntityNode>): void {
    if (!this.isLoaded) this.loadSync();
    const existing = this.nodes.get(id);
    if (!existing) return;

    const updated: EntityNode = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    this.indexEntityName(updated);
  }

  public addEdge(edge: RelationshipEdge): void {
    if (!this.isLoaded) this.loadSync();
    this.edges.set(edge.id, edge);

    const outList = this.outgoingEdges.get(edge.sourceId) || [];
    if (!outList.includes(edge.id)) {
      outList.push(edge.id);
      this.outgoingEdges.set(edge.sourceId, outList);
    }

    const inList = this.incomingEdges.get(edge.targetId) || [];
    if (!inList.includes(edge.id)) {
      inList.push(edge.id);
      this.incomingEdges.set(edge.targetId, inList);
    }
  }

  public addClaim(claim: ClaimNode): void {
    if (!this.isLoaded) this.loadSync();
    this.claims.set(claim.id, claim);
  }

  public getEntity(id: string): EntityNode | undefined {
    if (!this.isLoaded) this.loadSync();
    return this.nodes.get(id);
  }

  public getEntityByName(name: string): EntityNode | undefined {
    if (!this.isLoaded) this.loadSync();
    const norm = this.normalizeName(name);
    const id = this.nameToEntityId.get(norm);
    if (id) {
      const node = this.nodes.get(id);
      if (node && node.status !== 'merged') return node;
    }

    // Direct iteration fallback (checking alias or exact match)
    for (const node of this.nodes.values()) {
      if (node.status === 'merged') continue;
      if (this.normalizeName(node.name) === norm) return node;
      if (node.aliases?.some((a) => this.normalizeName(a) === norm)) return node;
    }

    return undefined;
  }

  public getAll(): { nodes: EntityNode[]; edges: RelationshipEdge[]; claims: ClaimNode[] } {
    if (!this.isLoaded) this.loadSync();
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      claims: Array.from(this.claims.values()),
    };
  }

  public getIncidentEdges(entityId: string): { incoming: RelationshipEdge[]; outgoing: RelationshipEdge[] } {
    if (!this.isLoaded) this.loadSync();
    const inIds = this.incomingEdges.get(entityId) || [];
    const outIds = this.outgoingEdges.get(entityId) || [];

    const incoming = inIds.map((id) => this.edges.get(id)!).filter(Boolean);
    const outgoing = outIds.map((id) => this.edges.get(id)!).filter(Boolean);

    return { incoming, outgoing };
  }

  public getClaimsForEntity(entityId: string): ClaimNode[] {
    if (!this.isLoaded) this.loadSync();
    const result: ClaimNode[] = [];
    for (const claim of this.claims.values()) {
      if (claim.subjectEntityId === entityId) {
        result.push(claim);
      }
    }
    return result;
  }

  public getSubgraph(entityIds: string[], depth = 1): { nodes: EntityNode[]; edges: RelationshipEdge[] } {
    if (!this.isLoaded) this.loadSync();
    const visitedNodes = new Set<string>();
    let currentFrontier = new Set<string>(entityIds.filter((id) => this.nodes.has(id)));

    for (const id of currentFrontier) {
      visitedNodes.add(id);
    }

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const currId of currentFrontier) {
        const outIds = this.outgoingEdges.get(currId) || [];
        for (const edgeId of outIds) {
          const edge = this.edges.get(edgeId);
          if (edge && this.nodes.has(edge.targetId)) {
            if (!visitedNodes.has(edge.targetId)) {
              visitedNodes.add(edge.targetId);
              nextFrontier.add(edge.targetId);
            }
          }
        }

        const inIds = this.incomingEdges.get(currId) || [];
        for (const edgeId of inIds) {
          const edge = this.edges.get(edgeId);
          if (edge && this.nodes.has(edge.sourceId)) {
            if (!visitedNodes.has(edge.sourceId)) {
              visitedNodes.add(edge.sourceId);
              nextFrontier.add(edge.sourceId);
            }
          }
        }
      }
      currentFrontier = nextFrontier;
      if (currentFrontier.size === 0) break;
    }

    const resultNodes: EntityNode[] = [];
    for (const id of visitedNodes) {
      const n = this.nodes.get(id);
      if (n && n.status !== 'merged') {
        resultNodes.push(n);
      }
    }

    const nodeSet = new Set(resultNodes.map((n) => n.id));
    const resultEdges: RelationshipEdge[] = [];
    for (const edge of this.edges.values()) {
      if (nodeSet.has(edge.sourceId) && nodeSet.has(edge.targetId)) {
        resultEdges.push(edge);
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  public mergeEntities(sourceId: string, targetId: string): void {
    if (!this.isLoaded) this.loadSync();
    if (sourceId === targetId) return;

    const source = this.nodes.get(sourceId);
    const target = this.nodes.get(targetId);
    if (!source || !target) return;

    // 1. Merge aliases
    const aliasSet = new Set<string>(target.aliases || []);
    aliasSet.add(source.name);
    if (source.aliases) {
      for (const a of source.aliases) {
        aliasSet.add(a);
      }
    }
    aliasSet.delete(target.name);
    target.aliases = Array.from(aliasSet);

    // 2. Merge evidence
    const evidenceKey = (ev: EvidenceRef) => `${ev.chunkId}::${ev.exactQuote}`;
    const seenEvidence = new Set<string>((target.evidence || []).map(evidenceKey));
    const mergedEvidence = [...(target.evidence || [])];

    if (source.evidence) {
      for (const ev of source.evidence) {
        const key = evidenceKey(ev);
        if (!seenEvidence.has(key)) {
          seenEvidence.add(key);
          mergedEvidence.push(ev);
        }
      }
    }
    target.evidence = mergedEvidence;
    target.updatedAt = Date.now();

    // 3. Mark source as merged
    source.status = 'merged';
    source.mergedIntoId = targetId;
    source.updatedAt = Date.now();

    // 4. Repoint edges
    for (const edge of this.edges.values()) {
      let changed = false;
      if (edge.sourceId === sourceId) {
        edge.sourceId = targetId;
        changed = true;
      }
      if (edge.targetId === sourceId) {
        edge.targetId = targetId;
        changed = true;
      }
      // If edge became a self-loop with source and target identical, we can either keep or discard
      if (edge.sourceId === edge.targetId) {
        // Discard self-loops produced by merge
        this.edges.delete(edge.id);
      }
    }

    // 5. Repoint claims
    for (const claim of this.claims.values()) {
      if (claim.subjectEntityId === sourceId) {
        claim.subjectEntityId = targetId;
      }
    }

    this.rebuildIndices();
  }

  public deleteEntity(id: string): void {
    if (!this.isLoaded) this.loadSync();
    this.nodes.delete(id);

    // Remove incident edges
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.sourceId === id || edge.targetId === id) {
        this.edges.delete(edgeId);
      }
    }

    // Remove claims
    for (const [claimId, claim] of this.claims.entries()) {
      if (claim.subjectEntityId === id) {
        this.claims.delete(claimId);
      }
    }

    this.rebuildIndices();
  }

  public deleteByDocId(docId: string): void {
    if (!this.isLoaded) this.loadSync();

    // Remove edges belonging to this docId
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.evidence?.docId === docId) {
        this.edges.delete(edgeId);
      }
    }

    // Remove claims belonging to this docId
    for (const [claimId, claim] of this.claims.entries()) {
      if (claim.evidence?.docId === docId) {
        this.claims.delete(claimId);
      }
    }

    // For entities, filter out evidence from this docId
    for (const [nodeId, node] of this.nodes.entries()) {
      node.evidence = (node.evidence || []).filter((e) => e.docId !== docId);
      if (node.evidence.length === 0) {
        // Entity has no other document evidence
        this.nodes.delete(nodeId);
      }
    }

    this.rebuildIndices();
  }

  public clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.claims.clear();
    this.incomingEdges.clear();
    this.outgoingEdges.clear();
    this.nameToEntityId.clear();
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // ignore
      }
    }
  }
}

export const graphStore = new GraphStore();
