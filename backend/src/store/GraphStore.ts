import fs from 'fs';
import path from 'path';
import {
  EntityNode,
  RelationshipEdge,
  ClaimNode,
  EvidenceRef,
  CurationStatus,
} from '../types';
import {
  safeUnlink,
  safeUnlinkSync,
  cleanupStaleTempFiles,
  cleanupStaleTempFilesSync,
  atomicWriteJson,
} from '../utils/fileStorage';

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
    cleanupStaleTempFilesSync(this.filePath, 0);
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
            if (!e.curationStatus) {
              e.curationStatus = 'proposed';
            }
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
    const op = async () => {
      this.ensureDir();
      // SDD format: Record of nodes, edges, claims
      const serialized = {
        nodes: Object.fromEntries(this.nodes.entries()),
        edges: Object.fromEntries(this.edges.entries()),
        claims: Object.fromEntries(this.claims.entries()),
      };
      await atomicWriteJson(this.filePath, serialized, { space: 2 });
    };

    this.writeLock = this.writeLock.then(op, op);
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
    if (!edge.curationStatus) {
      edge.curationStatus = 'proposed';
    }
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

  public getEdge(id: string): RelationshipEdge | undefined {
    if (!this.isLoaded) this.loadSync();
    const edge = this.edges.get(id);
    if (!edge) return undefined;
    return {
      ...edge,
      curationStatus: edge.curationStatus || 'proposed',
    };
  }

  public updateEdge(id: string, updatedEdge: RelationshipEdge): void {
    if (!this.isLoaded) this.loadSync();
    const existing = this.edges.get(id);
    if (!existing) {
      this.addEdge(updatedEdge);
      return;
    }

    const oldSourceId = existing.sourceId;
    const oldTargetId = existing.targetId;
    const newSourceId = updatedEdge.sourceId;
    const newTargetId = updatedEdge.targetId;

    // 1. Reconcile outgoing edges if source changed
    if (oldSourceId !== newSourceId) {
      const oldOut = this.outgoingEdges.get(oldSourceId) || [];
      this.outgoingEdges.set(oldSourceId, oldOut.filter((eId) => eId !== id));
    }
    // Sweep any stale outgoing registrations (including in-place mutation edge cases)
    for (const [sId, outList] of this.outgoingEdges.entries()) {
      if (sId !== newSourceId && outList.includes(id)) {
        this.outgoingEdges.set(sId, outList.filter((eId) => eId !== id));
      }
    }
    const newOut = this.outgoingEdges.get(newSourceId) || [];
    if (!newOut.includes(id)) newOut.push(id);
    this.outgoingEdges.set(newSourceId, newOut);

    // 2. Reconcile incoming edges if target changed
    if (oldTargetId !== newTargetId) {
      const oldIn = this.incomingEdges.get(oldTargetId) || [];
      this.incomingEdges.set(oldTargetId, oldIn.filter((eId) => eId !== id));
    }
    // Sweep any stale incoming registrations (including in-place mutation edge cases)
    for (const [tId, inList] of this.incomingEdges.entries()) {
      if (tId !== newTargetId && inList.includes(id)) {
        this.incomingEdges.set(tId, inList.filter((eId) => eId !== id));
      }
    }
    const newIn = this.incomingEdges.get(newTargetId) || [];
    if (!newIn.includes(id)) newIn.push(id);
    this.incomingEdges.set(newTargetId, newIn);

    // 3. Persist updated edge with guaranteed curationStatus invariant
    this.edges.set(id, {
      ...updatedEdge,
      curationStatus: updatedEdge.curationStatus || existing.curationStatus || 'proposed',
    });
  }

  public deleteEdge(id: string): boolean {
    if (!this.isLoaded) this.loadSync();
    const existing = this.edges.get(id);
    if (!existing) return false;

    const outList = this.outgoingEdges.get(existing.sourceId) || [];
    this.outgoingEdges.set(existing.sourceId, outList.filter((eId) => eId !== id));

    const inList = this.incomingEdges.get(existing.targetId) || [];
    this.incomingEdges.set(existing.targetId, inList.filter((eId) => eId !== id));

    return this.edges.delete(id);
  }

  public getClaim(id: string): ClaimNode | undefined {
    if (!this.isLoaded) this.loadSync();
    return this.claims.get(id);
  }

  public deleteClaim(id: string): boolean {
    if (!this.isLoaded) this.loadSync();
    return this.claims.delete(id);
  }

  public captureSnapshot(): {
    nodes: Map<string, EntityNode>;
    edges: Map<string, RelationshipEdge>;
    claims: Map<string, ClaimNode>;
  } {
    if (!this.isLoaded) this.loadSync();
    return {
      nodes: new Map(Array.from(this.nodes.entries()).map(([k, v]) => [k, { ...v }])),
      edges: new Map(Array.from(this.edges.entries()).map(([k, v]) => [k, { ...v }])),
      claims: new Map(Array.from(this.claims.entries()).map(([k, v]) => [k, { ...v }])),
    };
  }

  public restoreSnapshot(snapshot: {
    nodes: Map<string, EntityNode>;
    edges: Map<string, RelationshipEdge>;
    claims: Map<string, ClaimNode>;
  }): void {
    this.nodes = snapshot.nodes;
    this.edges = snapshot.edges;
    this.claims = snapshot.claims;
    this.rebuildIndices();
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

  public findEntityByName(name: string): EntityNode | undefined {
    return this.getEntityByName(name);
  }

  public getAllClaims(): ClaimNode[] {
    if (!this.isLoaded) this.loadSync();
    return Array.from(this.claims.values());
  }

  public removeEdge(id: string): boolean {
    return this.deleteEdge(id);
  }

  public removeEntity(id: string): void {
    this.deleteEntity(id);
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

  public getSubgraph(
    entityIds: string | string[],
    depth = 1,
    options?: { includeRejected?: boolean }
  ): { nodes: EntityNode[]; edges: RelationshipEdge[] } {
    if (!this.isLoaded) this.loadSync();
    const includeRejected = options?.includeRejected ?? false;
    const idList = Array.isArray(entityIds) ? entityIds : [entityIds];

    const visitedNodes = new Set<string>();
    let currentFrontier = new Set<string>(idList.filter((id) => this.nodes.has(id)));

    for (const id of currentFrontier) {
      visitedNodes.add(id);
    }

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const currId of currentFrontier) {
        const outIds = this.outgoingEdges.get(currId) || [];
        for (const edgeId of outIds) {
          const edge = this.edges.get(edgeId);
          if (!edge) continue;
          if (!includeRejected && edge.curationStatus === 'rejected') continue;

          if (this.nodes.has(edge.targetId)) {
            if (!visitedNodes.has(edge.targetId)) {
              visitedNodes.add(edge.targetId);
              nextFrontier.add(edge.targetId);
            }
          }
        }

        const inIds = this.incomingEdges.get(currId) || [];
        for (const edgeId of inIds) {
          const edge = this.edges.get(edgeId);
          if (!edge) continue;
          if (!includeRejected && edge.curationStatus === 'rejected') continue;

          if (this.nodes.has(edge.sourceId)) {
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
      if (!includeRejected && edge.curationStatus === 'rejected') {
        continue;
      }
      if (nodeSet.has(edge.sourceId) && nodeSet.has(edge.targetId)) {
        resultEdges.push({ ...edge });
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  public getEdgesByEntity(
    entityId: string,
    options?: { includeRejected?: boolean }
  ): RelationshipEdge[] {
    if (!this.isLoaded) this.loadSync();
    const includeRejected = options?.includeRejected ?? false;

    const inIds = this.incomingEdges.get(entityId) || [];
    const outIds = this.outgoingEdges.get(entityId) || [];
    const edgeIdSet = new Set<string>([...inIds, ...outIds]);

    const result: RelationshipEdge[] = [];
    for (const edgeId of edgeIdSet) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      if (!includeRejected && edge.curationStatus === 'rejected') continue;
      result.push({ ...edge });
    }

    return result;
  }

  public getActiveEdges(): RelationshipEdge[] {
    if (!this.isLoaded) this.loadSync();
    return Array.from(this.edges.values())
      .filter((e) => e.curationStatus !== 'rejected')
      .map((e) => ({ ...e }));
  }

  public getEdgesByStatus(status: CurationStatus): RelationshipEdge[] {
    if (!this.isLoaded) this.loadSync();
    return Array.from(this.edges.values())
      .filter((e) => e.curationStatus === status)
      .map((e) => ({ ...e }));
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
