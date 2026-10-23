import fs from 'fs';
import path from 'path';
import { Document, ProcessingStatus } from '../types';
import {
  safeUnlink,
  safeUnlinkSync,
  cleanupStaleTempFiles,
  cleanupStaleTempFilesSync,
  atomicWriteJson,
} from '../utils/fileStorage';

export class MetadataStore {
  private filePath: string;
  private documents: Map<string, Document> = new Map();
  private isLoaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = filePath || path.join(dataDir, 'metadata.json');
    this.ensureDir();
    cleanupStaleTempFilesSync(this.filePath, 0);
    this.load();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: Document[] = JSON.parse(raw);
        this.documents.clear();
        for (const doc of list) {
          this.documents.set(doc.docId, doc);
        }
      }
      this.isLoaded = true;
    } catch (err) {
      console.error(`Failed to load metadata from ${this.filePath}:`, err);
      this.documents.clear();
      this.isLoaded = true;
    }
  }

  private async persist(): Promise<void> {
    this.writeLock = this.writeLock
      .then(async () => {
        this.ensureDir();
        const list = Array.from(this.documents.values());
        await atomicWriteJson(this.filePath, list, { space: 2 });
      })
      .catch((err) => {
        console.error(`Error saving metadata to ${this.filePath}:`, err);
      });

    return this.writeLock;
  }

  public getAll(): Document[] {
    if (!this.isLoaded) this.load();
    return Array.from(this.documents.values()).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  }

  public get(docId: string): Document | undefined {
    if (!this.isLoaded) this.load();
    return this.documents.get(docId);
  }

  public async set(doc: Document): Promise<void> {
    if (!this.isLoaded) this.load();
    this.documents.set(doc.docId, doc);
    await this.persist();
  }

  public async updateStatus(docId: string, status: Partial<ProcessingStatus>): Promise<Document | undefined> {
    if (!this.isLoaded) this.load();
    const doc = this.documents.get(docId);
    if (!doc) return undefined;

    doc.status = {
      ...doc.status,
      ...status,
    };
    await this.persist();
    return doc;
  }

  public async update(docId: string, partial: Partial<Document>): Promise<Document | undefined> {
    if (!this.isLoaded) this.load();
    const doc = this.documents.get(docId);
    if (!doc) return undefined;

    Object.assign(doc, partial);
    await this.persist();
    return doc;
  }

  public async delete(docId: string): Promise<boolean> {
    if (!this.isLoaded) this.load();
    const existed = this.documents.delete(docId);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  public clear(): void {
    this.documents.clear();
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // ignore
      }
    }
  }
}

export const metadataStore = new MetadataStore();
