import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  AuditLogEntry,
  AuditQueryOptions,
  AuditQueryResult,
  IAuditStore,
} from '../types/audit';
import { safeAppendFile, safeUnlinkSync } from '../utils/fileStorage';

export class AuditStore implements IAuditStore {
  private filePath: string;
  private entries: AuditLogEntry[] = [];
  private idMap: Map<string, AuditLogEntry> = new Map();
  private targetIndex: Map<string, AuditLogEntry[]> = new Map();
  private writeLock: Promise<void> = Promise.resolve();
  private isLoaded = false;

  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = path.resolve(filePath);
    } else {
      const defaultDataDir =
        process.env.DATA_DIR ||
        (fs.existsSync(path.join(process.cwd(), 'data'))
          ? path.join(process.cwd(), 'data')
          : fs.existsSync(path.join(process.cwd(), 'backend', 'data'))
            ? path.join(process.cwd(), 'backend', 'data')
            : path.join(process.cwd(), 'data'));
      this.filePath = path.join(defaultDataDir, 'audit_log.jsonl');
    }

    this.ensureDir();
    this.loadSync();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Synchronously rehydrates the in-memory index from disk.
   * Tolerates corrupt lines, blank lines, and recovers rollback references.
   */
  public loadSync(): void {
    this.entries = [];
    this.idMap.clear();
    this.targetIndex.clear();

    if (!fs.existsSync(this.filePath)) {
      this.isLoaded = true;
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const lines = raw.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (this.isValidEntry(parsed)) {
            this.indexEntry(parsed);
          } else {
            console.warn(`[AuditStore] Skipping invalid schema at line ${i + 1}`);
          }
        } catch (jsonErr) {
          console.warn(`[AuditStore] Skipping malformed JSON line ${i + 1}: ${jsonErr}`);
        }
      }

      // Replay rollback state links across history
      for (const entry of this.entries) {
        if (entry.action === 'rollback' && entry.rollbackRefId) {
          const ref = this.idMap.get(entry.rollbackRefId);
          if (ref) {
            ref.rolledBack = true;
            ref.rolledBackBy = entry.auditId;

            // If the referenced entry was itself a rollback, reactivate its predecessor
            if (ref.action === 'rollback' && ref.rollbackRefId) {
              const original = this.idMap.get(ref.rollbackRefId);
              if (original) {
                original.rolledBack = false;
                delete original.rolledBackBy;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[AuditStore] Failed to read audit log at ${this.filePath}:`, err);
    }

    this.isLoaded = true;
  }

  private isValidEntry(obj: any): obj is AuditLogEntry {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.auditId === 'string' &&
      typeof obj.timestamp === 'number' &&
      typeof obj.action === 'string' &&
      typeof obj.targetType === 'string' &&
      typeof obj.targetId === 'string' &&
      'beforeState' in obj &&
      'afterState' in obj
    );
  }

  private indexEntry(entry: AuditLogEntry): void {
    this.entries.push(entry);
    this.idMap.set(entry.auditId, entry);

    let targetList = this.targetIndex.get(entry.targetId);
    if (!targetList) {
      targetList = [];
      this.targetIndex.set(entry.targetId, targetList);
    }
    targetList.push(entry);
  }

  /**
   * Appends a new immutable mutation entry to the audit trail.
   */
  public async append(
    entryData: Omit<AuditLogEntry, 'auditId' | 'timestamp'>
  ): Promise<AuditLogEntry> {
    if (!this.isLoaded) this.loadSync();

    const fullEntry: AuditLogEntry = {
      ...entryData,
      auditId: uuidv4(),
      timestamp: Date.now(),
      rolledBack: false,
    };

    // Serialize disk append via mutex BEFORE mutating in-memory state
    const writeOp = async () => {
      this.ensureDir();
      const line = JSON.stringify(fullEntry) + '\n';
      await safeAppendFile(this.filePath, line);

      // Only update in-memory state after safeAppendFile succeeds on disk
      this.indexEntry(fullEntry);

      // If this action was a rollback, link the original in memory
      if (fullEntry.action === 'rollback' && fullEntry.rollbackRefId) {
        this.markRolledBack(fullEntry.rollbackRefId, fullEntry.auditId);
      }
    };

    this.writeLock = this.writeLock.then(writeOp, writeOp);
    await this.writeLock;

    return fullEntry;
  }

  /**
   * Retrieves an audit entry by its unique auditId in O(1) time.
   */
  public getById(auditId: string): AuditLogEntry | undefined {
    if (!this.isLoaded) this.loadSync();
    return this.idMap.get(auditId);
  }

  public getEntry(auditId: string): AuditLogEntry | undefined {
    return this.getById(auditId);
  }

  /**
   * Marks an original entry as rolled back in memory.
   */
  public markRolledBack(originalAuditId: string, rollbackAuditId: string): void {
    const original = this.getById(originalAuditId);
    if (original) {
      original.rolledBack = true;
      original.rolledBackBy = rollbackAuditId;
    }
  }

  /**
   * Unmarks an entry as rolled back (reactivating it for cascading rollbacks).
   */
  public unmarkRolledBack(auditId: string): void {
    const entry = this.getById(auditId);
    if (entry) {
      entry.rolledBack = false;
      delete entry.rolledBackBy;
    }
  }

  /**
   * Returns paginated entries in reverse chronological order.
   */
  public query(options: AuditQueryOptions = {}): AuditQueryResult {
    if (!this.isLoaded) this.loadSync();

    const {
      limit = 50,
      offset = 0,
      targetId,
      targetType,
      action,
      includeRolledBack = true,
    } = options;

    const pool = targetId ? this.targetIndex.get(targetId) || [] : this.entries;
    const matched: AuditLogEntry[] = [];

    // Scan backwards from newest to oldest
    for (let i = pool.length - 1; i >= 0; i--) {
      const entry = pool[i];
      if (targetType && entry.targetType !== targetType) continue;
      if (action && entry.action !== action) continue;
      if (!includeRolledBack && entry.rolledBack) continue;
      matched.push(entry);
    }

    const totalCount = matched.length;
    const sliced = matched.slice(offset, offset + limit);

    return {
      entries: sliced,
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  /**
   * Flexible retrieval supporting both options object and (limit, targetId) parameters.
   */
  public getEntries(
    optionsOrLimit?: { limit?: number; offset?: number; targetId?: string } | number,
    targetIdParam?: string
  ): AuditLogEntry[] {
    if (!this.isLoaded) this.loadSync();

    let limit = 50;
    let offset = 0;
    let targetId: string | undefined;

    if (typeof optionsOrLimit === 'number') {
      limit = optionsOrLimit;
      targetId = targetIdParam;
    } else if (optionsOrLimit && typeof optionsOrLimit === 'object') {
      limit = optionsOrLimit.limit ?? 50;
      offset = optionsOrLimit.offset ?? 0;
      targetId = optionsOrLimit.targetId;
    } else if (targetIdParam) {
      targetId = targetIdParam;
    }

    return this.query({ limit, offset, targetId }).entries;
  }

  /**
   * Returns newest entries for a target or global ledger.
   */
  public getHistory(limit = 100, targetId?: string): AuditLogEntry[] {
    return this.getEntries(limit, targetId);
  }

  /**
   * Total count of valid audit entries currently stored.
   */
  public count(): number {
    if (!this.isLoaded) this.loadSync();
    return this.entries.length;
  }

  /**
   * Total count of entries, optionally filtered by targetId.
   */
  public getTotalCount(options?: { targetId?: string }): number {
    if (!this.isLoaded) this.loadSync();
    if (options?.targetId) {
      return this.targetIndex.get(options.targetId)?.length || 0;
    }
    return this.entries.length;
  }

  /**
   * Clears in-memory index and truncates audit file (for testing isolation).
   */
  public async clear(): Promise<void> {
    const clearOp = async () => {
      this.entries = [];
      this.idMap.clear();
      this.targetIndex.clear();
      if (fs.existsSync(this.filePath)) {
        safeUnlinkSync(this.filePath);
      }
      this.isLoaded = true;
    };

    this.writeLock = this.writeLock.then(clearOp, clearOp);
    await this.writeLock;
  }
}

export const auditStore = new AuditStore();
