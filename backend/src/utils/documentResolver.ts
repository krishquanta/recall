import { metadataStore, MetadataStore } from '../store/MetadataStore';
import { EvidenceRef } from '../types/graph';

export interface ResolvedDocumentMetadata {
  filename: string;
  documentDate?: string;
  documentVersion: number;
  uploadedAt?: string;
}

/**
 * Resolves document-level metadata (filename, publication/document date, version)
 * from MetadataStore with robust fallbacks from EvidenceRef and filename heuristics.
 */
export class DocumentMetadataResolver {
  constructor(private metaStore: MetadataStore = metadataStore) {}

  public resolve(docId: string, evidence?: EvidenceRef): ResolvedDocumentMetadata {
    const doc = this.metaStore.get(docId);

    // 1. Filename resolution
    const filename = doc?.filename || evidence?.filename || 'Unknown Document';

    // 2. Document Date resolution (explicit documentDate > uploadedAt > filename year heuristic)
    let documentDate: string | undefined = undefined;
    if ((doc as any)?.documentDate) {
      documentDate = (doc as any).documentDate;
    } else if (doc?.uploadedAt) {
      documentDate = doc.uploadedAt;
    } else {
      const yearMatch = filename.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        documentDate = `${yearMatch[1]}-01-01`;
      }
    }

    // 3. Document Version resolution (explicit version > filename version tag > 1)
    let documentVersion = 1;
    if (typeof (doc as any)?.version === 'number') {
      documentVersion = (doc as any).version;
    } else {
      const versionMatch = filename.match(/[._-]v(\d+)\b/i);
      if (versionMatch) {
        documentVersion = parseInt(versionMatch[1], 10);
      }
    }

    return {
      filename,
      documentDate,
      documentVersion,
      uploadedAt: doc?.uploadedAt,
    };
  }
}

export const documentMetadataResolver = new DocumentMetadataResolver();
