import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  Document,
  EntityNode,
  RelationshipEdge,
  EvidenceRef,
  Page,
  VectorRecord,
} from '../types';
import { GraphStore, graphStore } from '../store/GraphStore';
import { MetadataStore, metadataStore } from '../store/MetadataStore';
import { VectorStore, vectorStore } from '../store/VectorStore';
import { KeywordIndex, keywordIndex } from '../store/KeywordIndex';
import { ContradictionStore } from '../store/ContradictionStore';
import { AuditService, auditService } from './AuditService';
import { ChunkingService } from './ChunkingService';
import { EmbeddingService } from './EmbeddingService';
import { ResearchProposalStore, researchProposalStore } from '../store/ResearchProposalStore';

let defaultChunkingService: ChunkingService | null = null;
function getDefaultChunkingService(): ChunkingService {
  if (!defaultChunkingService) {
    defaultChunkingService = new ChunkingService();
  }
  return defaultChunkingService;
}

let defaultEmbeddingService: EmbeddingService | null = null;
function getDefaultEmbeddingService(): EmbeddingService {
  if (!defaultEmbeddingService) {
    defaultEmbeddingService = new EmbeddingService();
  }
  return defaultEmbeddingService;
}

let defaultContradictionStore: ContradictionStore | null = null;
function getDefaultContradictionStore(): ContradictionStore {
  if (!defaultContradictionStore) {
    defaultContradictionStore = new ContradictionStore();
  }
  return defaultContradictionStore;
}

export class ResearchImportService {
  constructor(
    private graphStoreInstance: GraphStore = graphStore,
    private metadataStoreInstance: MetadataStore = metadataStore,
    private vectorStoreInstance: VectorStore = vectorStore,
    private keywordIndexInstance: KeywordIndex = keywordIndex,
    private contradictionStoreInstance?: ContradictionStore,
    private auditServiceInstance: AuditService = auditService,
    private chunkingServiceInstance: ChunkingService = getDefaultChunkingService(),
    private embeddingServiceInstance: EmbeddingService = getDefaultEmbeddingService(),
    private proposalStoreInstance: ResearchProposalStore = researchProposalStore
  ) {}

  private getContradictionStore(): ContradictionStore {
    return this.contradictionStoreInstance || getDefaultContradictionStore();
  }

  /**
   * Atomically commits accepted proposal updates into knowledge base:
   * 1. Generate synthetic dossier .md file in uploads/.
   * 2. Register Document in MetadataStore (sourceType: 'web').
   * 3. Chunk, embed, and index the dossier (VectorStore + KeywordIndex).
   * 4. Resolve proposed entity names against existing graph entities (dedup).
   * 5. Insert new entities and edges into GraphStore with standard EvidenceRef.
   * 6. Mark resolved contradictions in ContradictionStore.
   * 7. Append research_import audit event to AuditStore.
   * 8. Mark proposal as IMPORTED in ProposalStore.
   */
  public async importProposal(
    proposalId: string,
    acceptedEntityTempIds: string[] = [],
    acceptedRelationTempIds: string[] = [],
    acceptedResolutionIds: string[] = []
  ): Promise<{
    success: boolean;
    researchDocId: string;
    auditEventId: string;
    importedEntitiesCount: number;
    importedRelationsCount: number;
    resolvedContradictionsCount: number;
  }> {
    const proposal = this.proposalStoreInstance.get(proposalId);
    if (!proposal) {
      throw new Error(`Research proposal "${proposalId}" not found or expired.`);
    }

    if (proposal.status === 'IMPORTED') {
      throw new Error(`Research proposal "${proposalId}" has already been imported.`);
    }

    // 1. Filter to accepted items
    const acceptedEntities = proposal.proposedEntities.filter((e) =>
      acceptedEntityTempIds.includes(e.tempId)
    );
    const acceptedRelations = proposal.proposedRelations.filter((r) =>
      acceptedRelationTempIds.includes(r.tempId)
    );
    const acceptedResolutions = proposal.proposedResolutions.filter((res) =>
      acceptedResolutionIds.includes(res.contradictionId)
    );

    // 2. Generate synthetic dossier markdown document
    const cleanId = proposal.id.replace(/^prop_/, '');
    const researchDocId = `doc_research_${cleanId}`;
    const filename = `research_${cleanId}.md`;

    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filePath = path.join(uploadDir, filename);

    const sourceCitationsMarkdown = proposal.report.sources
      .map(
        (s) =>
          `### [${s.title}](${s.url})\n- **Domain:** ${s.domain}\n- **Retrieved:** ${
            s.retrievedAt
          }\n\n> ${s.fullText || s.snippet}`
      )
      .join('\n\n');

    const dossierContent = `# Research Dossier: ${proposal.report.question}

**Generated:** ${proposal.report.generatedAt}
**Task ID:** ${proposal.report.taskId}
**Primary Sources:** ${proposal.report.sources.map((s) => s.url).join(', ')}

## Executive Summary
${proposal.report.summary}

## Detailed Analysis
${proposal.report.detailedAnalysis}

## What Changed and Why
${proposal.report.whatChangedAndWhy}

## Sourced Evidence Citations
${sourceCitationsMarkdown}
`;

    fs.writeFileSync(filePath, dossierContent, 'utf-8');

    // 3. Register in MetadataStore with sourceType: 'web'
    const primarySourceUrl =
      proposal.report.sources[0]?.url || 'https://web-research.internal';

    const document: Document = {
      docId: researchDocId,
      filename,
      mimeType: 'text/markdown',
      isOCR: false,
      size: Buffer.byteLength(dossierContent, 'utf-8'),
      uploadedAt: new Date().toISOString(),
      status: { stage: 'done', progress: 100 },
      filePath,
      sourceType: 'web',
      sourceUrl: primarySourceUrl,
      retrievedAt: proposal.report.generatedAt,
    };
    await this.metadataStoreInstance.set(document);

    // 4. Chunk, embed, and index into VectorStore & KeywordIndex
    const pages: Page[] = [{ text: dossierContent, page: 1, lineStart: 1 }];
    const chunks = this.chunkingServiceInstance.chunk(
      pages,
      researchDocId,
      filename,
      'text/markdown'
    );
    const embedded = await this.embeddingServiceInstance.embedChunks(chunks);

    const vectorRecords: VectorRecord[] = chunks.map((chunk, idx) => ({
      chunkId: chunk.chunkId,
      vector: embedded[idx]?.vector || [],
      text: chunk.text,
      metadata: chunk.metadata,
    }));

    await this.vectorStoreInstance.addAll(vectorRecords);
    this.keywordIndexInstance.addChunks(chunks);

    const defaultChunkId = chunks[0]?.chunkId || `${researchDocId}-0`;

    // 5. Entity Name Resolution & Insertion
    const entityNameToId = new Map<string, string>();
    const addedEntityIds: string[] = [];

    for (const propEnt of acceptedEntities) {
      const existing = this.graphStoreInstance.findEntityByName(propEnt.name);
      const evRef: EvidenceRef = {
        docId: researchDocId,
        chunkId: defaultChunkId,
        filename,
        exactQuote: propEnt.evidenceQuote,
        charOffset: { start: 0, end: propEnt.evidenceQuote.length },
      };

      if (existing) {
        entityNameToId.set(propEnt.name, existing.id);
        existing.evidence = [...(existing.evidence || []), evRef];
        this.graphStoreInstance.updateEntity(existing.id, existing);
      } else {
        const newEntityId = uuidv4();
        entityNameToId.set(propEnt.name, newEntityId);
        addedEntityIds.push(newEntityId);

        const newEntity: EntityNode = {
          id: newEntityId,
          name: propEnt.name,
          type: (propEnt.type as any) || 'Concept',
          aliases: [],
          description: propEnt.description,
          status: 'active',
          evidence: [evRef],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.graphStoreInstance.addEntity(newEntity);
      }
    }

    // 6. Edge Insertion with Resolved Entity IDs
    const addedRelationIds: string[] = [];

    for (const propRel of acceptedRelations) {
      let srcId =
        entityNameToId.get(propRel.sourceEntityName) ||
        this.graphStoreInstance.findEntityByName(propRel.sourceEntityName)?.id;

      if (!srcId) {
        srcId = uuidv4();
        entityNameToId.set(propRel.sourceEntityName, srcId);
        addedEntityIds.push(srcId);
        this.graphStoreInstance.addEntity({
          id: srcId,
          name: propRel.sourceEntityName,
          type: 'Concept',
          aliases: [],
          description: `Auto-created source node for ${propRel.relationType}`,
          status: 'active',
          evidence: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      let tgtId =
        entityNameToId.get(propRel.targetEntityName) ||
        this.graphStoreInstance.findEntityByName(propRel.targetEntityName)?.id;

      if (!tgtId) {
        tgtId = uuidv4();
        entityNameToId.set(propRel.targetEntityName, tgtId);
        addedEntityIds.push(tgtId);
        this.graphStoreInstance.addEntity({
          id: tgtId,
          name: propRel.targetEntityName,
          type: 'Concept',
          aliases: [],
          description: `Auto-created target node for ${propRel.relationType}`,
          status: 'active',
          evidence: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const edgeId = uuidv4();
      addedRelationIds.push(edgeId);

      const edgeEv: EvidenceRef = {
        docId: researchDocId,
        chunkId: defaultChunkId,
        filename,
        exactQuote: propRel.evidenceQuote,
        charOffset: { start: 0, end: propRel.evidenceQuote.length },
      };

      const newEdge: RelationshipEdge = {
        id: edgeId,
        sourceId: srcId,
        targetId: tgtId,
        relationType: propRel.relationType as any,
        description: propRel.description,
        confidence: 0.95,
        evidence: edgeEv,
        curationStatus: 'proposed',
        createdAt: Date.now(),
      };

      this.graphStoreInstance.addEdge(newEdge);
    }

    // 7. Contradiction Resolution
    const resolvedContradictionIds: string[] = [];
    const contraStore = this.getContradictionStore();

    for (const res of acceptedResolutions) {
      contraStore.resolve(res.contradictionId, 'both_valid', res.explanation);
      resolvedContradictionIds.push(res.contradictionId);
    }
    await contraStore.save();

    // 8. Atomic Audit Entry Recording
    const auditEntry = await this.auditServiceInstance.recordMutation({
      action: 'research_import',
      targetType: 'research',
      targetId: proposal.id,
      beforeState: {
        existingEntityIds: Array.from(entityNameToId.values()).filter(
          (id) => !addedEntityIds.includes(id)
        ),
      },
      afterState: {
        addedEntityIds,
        addedRelationIds,
        resolvedContradictionIds,
        researchDocId,
        filePath,
      },
      reason: `Imported research proposal for: ${proposal.report.question}`,
      sourceDocId: researchDocId,
    });

    // 9. Persist all GraphStore mutations & update ProposalStore status
    await this.graphStoreInstance.save();
    proposal.status = 'IMPORTED';

    return {
      success: true,
      researchDocId,
      auditEventId: auditEntry.auditId,
      importedEntitiesCount: addedEntityIds.length,
      importedRelationsCount: addedRelationIds.length,
      resolvedContradictionsCount: resolvedContradictionIds.length,
    };
  }
}

export const researchImportService = new ResearchImportService();
