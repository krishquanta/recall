import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ReviewQueueItem } from '../types';
import {
  safeUnlink,
  safeUnlinkSync,
  cleanupStaleTempFiles,
  cleanupStaleTempFilesSync,
  atomicWriteJson,
} from '../utils/fileStorage';

export class ReviewStore {
  private filePath: string;
  private items: Map<string, ReviewQueueItem> = new Map();
  private isLoaded = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = filePath || path.join(dataDir, 'review_queue.json');
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

  public loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: ReviewQueueItem[] = JSON.parse(raw);
        this.items.clear();
        for (const item of list) {
          if (item && item.id) {
            this.items.set(item.id, item);
          }
        }
      }
      this.isLoaded = true;
    } catch (err) {
      console.error(`Failed to load review queue from ${this.filePath}:`, err);
      this.items.clear();
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
        const list = Array.from(this.items.values());
        await atomicWriteJson(this.filePath, list, { space: 2 });
      })
      .catch((err) => {
        console.error(`Error saving review queue to ${this.filePath}:`, err);
      });

    return this.writeLock;
  }

  public enqueue(item: Omit<ReviewQueueItem, 'id' | 'status'>): ReviewQueueItem {
    if (!this.isLoaded) this.loadSync();
    const id = uuidv4();
    const queueItem: ReviewQueueItem = {
      ...item,
      id,
      status: 'pending',
    };
    this.items.set(id, queueItem);
    return queueItem;
  }

  public getPending(): ReviewQueueItem[] {
    if (!this.isLoaded) this.loadSync();
    return Array.from(this.items.values()).filter((item) => item.status === 'pending');
  }

  public getAll(): ReviewQueueItem[] {
    if (!this.isLoaded) this.loadSync();
    return Array.from(this.items.values());
  }

  public get(id: string): ReviewQueueItem | undefined {
    if (!this.isLoaded) this.loadSync();
    return this.items.get(id);
  }

  public resolve(id: string, status: 'accepted' | 'rejected'): void {
    if (!this.isLoaded) this.loadSync();
    const item = this.items.get(id);
    if (!item) return;

    item.status = status;
    item.resolvedAt = Date.now();
  }

  public deleteByDocId(docId: string): void {
    if (!this.isLoaded) this.loadSync();
    for (const [id, item] of this.items.entries()) {
      if (item.candidateEntity?.evidence?.docId === docId) {
        this.items.delete(id);
      }
    }
  }

  public clear(): void {
    this.items.clear();
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // ignore
      }
    }
  }
}

export const reviewStore = new ReviewStore();
