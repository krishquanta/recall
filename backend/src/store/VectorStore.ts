import fs from 'fs';
import path from 'path';
import { ChunkMetadata, RankedChunk, VectorRecord } from '../types';

export class VectorStore {
  private filePath: string;
  private records: Map<string, VectorRecord> = new Map();
  private isLoaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = filePath || path.join(dataDir, 'vectors.json');
    this.ensureDir();
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
        const list: VectorRecord[] = JSON.parse(raw);
        this.records.clear();
        for (const item of list) {
          this.records.set(item.chunkId, item);
        }
      }
      this.isLoaded = true;
    } catch (err) {
      console.error(`Failed to load vectors from ${this.filePath}:`, err);
      this.records.clear();
      this.isLoaded = true;
    }
  }

  private async persist(): Promise<void> {
    this.writeLock = this.writeLock.then(async () => {
      this.ensureDir();
      const list = Array.from(this.records.values());
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      try {
        await fs.promises.writeFile(tempPath, JSON.stringify(list), 'utf-8');
        try {
          await fs.promises.rename(tempPath, this.filePath);
        } catch {
          await fs.promises.copyFile(tempPath, this.filePath);
          await fs.promises.unlink(tempPath).catch(() => {});
        }
      } catch (err) {
        await fs.promises.writeFile(this.filePath, JSON.stringify(list), 'utf-8');
      }
    }).catch(err => {
      console.error(`Error saving vectors to ${this.filePath}:`, err);
    });

    return this.writeLock;
  }

  public getAll(): VectorRecord[] {
    if (!this.isLoaded) this.load();
    return Array.from(this.records.values());
  }

  public async upsertBatch(records: VectorRecord[]): Promise<void> {
    if (!this.isLoaded) this.load();
    for (const rec of records) {
      this.records.set(rec.chunkId, rec);
    }
    await this.persist();
  }

  public async deleteByDocId(docId: string): Promise<void> {
    if (!this.isLoaded) this.load();
    let changed = false;
    for (const [chunkId, rec] of this.records.entries()) {
      if (rec.metadata.docId === docId) {
        this.records.delete(chunkId);
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
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

  public query(queryVector: number[], topK = 10, docIds?: string[]): RankedChunk[] {
    if (!this.isLoaded) this.load();
    if (this.records.size === 0 || queryVector.length === 0) return [];

    const scored: RankedChunk[] = [];
    const filterDocIds = docIds && docIds.length > 0 ? new Set(docIds) : null;

    for (const record of this.records.values()) {
      if (filterDocIds && !filterDocIds.has(record.metadata.docId)) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryVector, record.vector);
      // Normalize cosine score from [-1, 1] to [0, 1]
      const normalizedScore = Math.max(0, Math.min(1, (similarity + 1) / 2));

      scored.push({
        chunkId: record.chunkId,
        text: record.text,
        metadata: record.metadata,
        score: normalizedScore,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  public clear(): void {
    this.records.clear();
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // ignore
      }
    }
  }

  public getCount(): number {
    if (!this.isLoaded) this.load();
    return this.records.size;
  }
}

export const vectorStore = new VectorStore();
