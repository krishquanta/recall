import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface CacheStats {
  embeddingHits: number;
  embeddingMisses: number;
  qaHits: number;
  qaMisses: number;
  totalRequestsSaved: number;
}

export interface GeminiCacheSchema {
  version: number;
  stats: CacheStats;
  embeddings: Record<string, number[]>;
  qa: Record<string, string>;
}

export class CacheService {
  private filePath: string;
  private embeddingsMap: Map<string, number[]> = new Map();
  private qaMap: Map<string, string> = new Map();
  private stats: CacheStats = {
    embeddingHits: 0,
    embeddingMisses: 0,
    qaHits: 0,
    qaMisses: 0,
    totalRequestsSaved: 0,
  };
  private isLoaded = false;
  private static writeLocks: Map<string, Promise<void>> = new Map();
  private writeLock: Promise<void> = Promise.resolve();

  constructor(storagePath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = storagePath || path.join(dataDir, 'gemini_cache.json');
    this.ensureDir();
    this.cleanupStaleTempFilesSync();
    this.loadSync();
  }

  public static async safeUnlink(filePath: string, retries = 3, delayMs = 40): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
        return;
      } catch (err: any) {
        if (attempt < retries - 1 && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          return;
        }
      }
    }
  }

  public static safeUnlinkSync(filePath: string, retries = 3, delayMs = 30): void {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return;
      } catch (err: any) {
        if (attempt < retries - 1 && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
          const start = Date.now();
          while (Date.now() - start < delayMs) {
            // busy wait
          }
        } else {
          return;
        }
      }
    }
  }

  public async cleanupStaleTempFiles(maxAgeMs = 60000): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) return;
      const baseName = path.basename(this.filePath);
      const prefix = `${baseName}.tmp.`;
      const entries = await fs.promises.readdir(dir);
      const now = Date.now();
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          const fullPath = path.join(dir, entry);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (now - stat.mtimeMs >= maxAgeMs) {
              await CacheService.safeUnlink(fullPath);
            }
          } catch {
            // Ignore stat/unlink race
          }
        }
      }
    } catch (err) {
      // Non-fatal cleanup
    }
  }

  public cleanupStaleTempFilesSync(maxAgeMs = 60000): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) return;
      const baseName = path.basename(this.filePath);
      const prefix = `${baseName}.tmp.`;
      const entries = fs.readdirSync(dir);
      const now = Date.now();
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          const fullPath = path.join(dir, entry);
          try {
            const stat = fs.statSync(fullPath);
            if (now - stat.mtimeMs >= maxAgeMs) {
              CacheService.safeUnlinkSync(fullPath);
            }
          } catch {
            // Ignore stat/unlink race
          }
        }
      }
    } catch (err) {
      // Non-fatal cleanup
    }
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public hashEmbeddingKey(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  public hashQAKey(question: string, docIds?: string[]): string {
    const normalizedQuestion = (question || '').trim().toLowerCase();
    const sortedDocIds = docIds && Array.isArray(docIds) && docIds.length > 0 ? [...docIds].sort() : [];
    return crypto
      .createHash('sha256')
      .update(normalizedQuestion + '::' + sortedDocIds.join(','))
      .digest('hex');
  }

  private loadSync(): void {
    try {
      this.ensureDir();
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.embeddings && typeof parsed.embeddings === 'object') {
              this.embeddingsMap.clear();
              for (const [k, v] of Object.entries(parsed.embeddings)) {
                if (Array.isArray(v)) {
                  this.embeddingsMap.set(k, v as number[]);
                }
              }
            }
            if (parsed.qa && typeof parsed.qa === 'object') {
              this.qaMap.clear();
              for (const [k, v] of Object.entries(parsed.qa)) {
                if (typeof v === 'string') {
                  this.qaMap.set(k, v);
                } else if (v && typeof v === 'object' && typeof (v as any).answer === 'string') {
                  this.qaMap.set(k, (v as any).answer);
                }
              }
            }
          }
        }
      }
      this.isLoaded = true;
    } catch (err) {
      console.error(`Failed to load cache from ${this.filePath}:`, err);
      this.embeddingsMap.clear();
      this.qaMap.clear();
      this.isLoaded = true;
    }
  }

  public async initialize(maxAgeMs = 60000): Promise<void> {
    await this.cleanupStaleTempFiles(maxAgeMs);
    this.loadSync();
  }

  private async persist(): Promise<void> {
    const normalizedPath = path.resolve(this.filePath);
    const currentLock = CacheService.writeLocks.get(normalizedPath) || Promise.resolve();

    const nextLock = currentLock
      .then(async () => {
        this.ensureDir();
        if (fs.existsSync(this.filePath)) {
          try {
            const raw = await fs.promises.readFile(this.filePath, 'utf-8');
            if (raw.trim()) {
              const diskData = JSON.parse(raw);
              if (diskData && typeof diskData === 'object') {
                if (diskData.embeddings && typeof diskData.embeddings === 'object') {
                  for (const [k, v] of Object.entries(diskData.embeddings)) {
                    if (!this.embeddingsMap.has(k) && Array.isArray(v)) {
                      this.embeddingsMap.set(k, v as number[]);
                    }
                  }
                }
                if (diskData.qa && typeof diskData.qa === 'object') {
                  for (const [k, v] of Object.entries(diskData.qa)) {
                    if (!this.qaMap.has(k) && typeof v === 'string') {
                      this.qaMap.set(k, v);
                    }
                  }
                }
              }
            }
          } catch {
            // Non-fatal disk read error
          }
        }

        const data: GeminiCacheSchema = {
          version: 1,
          stats: { ...this.stats },
          embeddings: Object.fromEntries(this.embeddingsMap.entries()),
          qa: Object.fromEntries(this.qaMap.entries()),
        };
        const serialized = JSON.stringify(data);
        const tempPath = `${this.filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        try {
          await fs.promises.writeFile(tempPath, serialized, 'utf-8');
          try {
            await fs.promises.rename(tempPath, this.filePath);
          } catch {
            await fs.promises.copyFile(tempPath, this.filePath);
            await CacheService.safeUnlink(tempPath);
          }
        } catch (err) {
          try {
            await fs.promises.writeFile(this.filePath, serialized, 'utf-8');
          } catch (directWriteErr) {
            console.error(`Direct write failed to ${this.filePath}:`, directWriteErr);
          }
        } finally {
          await CacheService.safeUnlink(tempPath);
        }
      })
      .catch((err) => {
        console.error(`Error saving cache to ${this.filePath}:`, err);
      });

    CacheService.writeLocks.set(normalizedPath, nextLock);
    this.writeLock = nextLock;
    return nextLock;
  }

  public getEmbedding(text: string): number[] | null {
    if (!this.isLoaded) {
      this.loadSync();
    }
    const key = this.hashEmbeddingKey(text);
    const vector = this.embeddingsMap.get(key);
    if (vector) {
      this.stats.embeddingHits++;
      this.stats.totalRequestsSaved++;
      return vector;
    }
    this.stats.embeddingMisses++;
    return null;
  }

  public async setEmbedding(text: string, vector: number[]): Promise<void> {
    if (!this.isLoaded) {
      this.loadSync();
    }
    const key = this.hashEmbeddingKey(text);
    this.embeddingsMap.set(key, vector);
    await this.persist();
  }

  public async setEmbeddingBatch(entries: Array<{ text: string; vector: number[] }>): Promise<void> {
    if (!this.isLoaded) {
      this.loadSync();
    }
    for (const entry of entries) {
      const key = this.hashEmbeddingKey(entry.text);
      this.embeddingsMap.set(key, entry.vector);
    }
    await this.persist();
  }

  public getQA(normalizedQuestion: string, docIds?: string[]): string | null {
    if (!this.isLoaded) {
      this.loadSync();
    }
    const key = this.hashQAKey(normalizedQuestion, docIds);
    const answer = this.qaMap.get(key);
    if (answer !== undefined) {
      this.stats.qaHits++;
      this.stats.totalRequestsSaved++;
      return answer;
    }
    this.stats.qaMisses++;
    return null;
  }

  public async setQA(normalizedQuestion: string, docIds: string[] | undefined, answer: string): Promise<void> {
    if (!this.isLoaded) {
      this.loadSync();
    }
    const key = this.hashQAKey(normalizedQuestion, docIds);
    this.qaMap.set(key, answer);
    await this.persist();
  }

  public getStats(): CacheStats {
    return { ...this.stats };
  }

  public async flush(): Promise<void> {
    await this.persist();
    const normalizedPath = path.resolve(this.filePath);
    const lock = CacheService.writeLocks.get(normalizedPath);
    if (lock) {
      await lock;
    }
  }

  public clear(): void {
    this.embeddingsMap.clear();
    this.qaMap.clear();
    this.stats = {
      embeddingHits: 0,
      embeddingMisses: 0,
      qaHits: 0,
      qaMisses: 0,
      totalRequestsSaved: 0,
    };
  }
}

export const cacheService = new CacheService();

// Register .ts extension for CommonJS dynamic require (used by e2e tests)
if (typeof require !== 'undefined' && (require as any).extensions) {
  const ext = (require as any).extensions;
  if (!ext['.ts']) {
    ext['.ts'] = function (module: any, filename: string) {
      if (filename.includes('CacheService')) {
        module.exports = { CacheService, cacheService };
        return;
      }
      const content = fs.readFileSync(filename, 'utf-8');
      module._compile(content, filename);
    };
  }
}
