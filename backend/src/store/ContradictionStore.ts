import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ContradictionAlert,
  ContradictionResolution,
  ContradictionStoreData,
} from '../types/contradiction';
import { safeAtomicWriteSync, sweepAllTempFilesSync } from '../utils/fileStorage';

export class ContradictionStore {
  private filePath: string;
  private alerts: Map<string, ContradictionAlert> = new Map();
  private entityIndex: Map<string, Set<string>> = new Map();

  constructor(customPath?: string) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.filePath = customPath || path.join(dataDir, 'contradictions.json');

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.loadSync();
  }

  public loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw && raw.trim().length > 0) {
          const parsed: ContradictionStoreData = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.alerts)) {
            this.alerts.clear();
            this.entityIndex.clear();
            for (const alert of parsed.alerts) {
              this.indexAlert(alert);
            }
            return;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ContradictionStore] Failed to load from ${this.filePath}: ${err?.message || err}. Initializing empty store.`);
    }

    this.alerts.clear();
    this.entityIndex.clear();
  }

  private indexAlert(alert: ContradictionAlert): void {
    this.alerts.set(alert.id, alert);
    if (alert.entityId) {
      if (!this.entityIndex.has(alert.entityId)) {
        this.entityIndex.set(alert.entityId, new Set());
      }
      this.entityIndex.get(alert.entityId)!.add(alert.id);
    }
  }

  public async save(): Promise<void> {
    const data: ContradictionStoreData = {
      alerts: Array.from(this.alerts.values()),
      version: 1,
      lastUpdated: Date.now(),
    };
    safeAtomicWriteSync(this.filePath, JSON.stringify(data, null, 2));
  }

  public create(
    params: Omit<ContradictionAlert, 'id' | 'detectedAt' | 'status'>
  ): ContradictionAlert {
    // Deduplicate existing identical pair alert
    const existing = Array.from(this.alerts.values()).find(
      (a) =>
        (a.claimIdA === params.claimIdA && a.claimIdB === params.claimIdB) ||
        (a.claimIdA === params.claimIdB && a.claimIdB === params.claimIdA)
    );

    if (existing) {
      return existing;
    }

    const alert: ContradictionAlert = {
      ...params,
      id: uuidv4(),
      detectedAt: Date.now(),
      status: 'active',
    };

    this.indexAlert(alert);
    this.save().catch((err) => console.error('[ContradictionStore] Save error:', err));
    return alert;
  }

  public getAlert(id: string): ContradictionAlert | undefined {
    return this.alerts.get(id);
  }

  public getAll(): ContradictionAlert[] {
    return Array.from(this.alerts.values());
  }

  public getActive(): ContradictionAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.status === 'active');
  }

  public getAlertsForEntity(entityId: string): ContradictionAlert[] {
    const ids = this.entityIndex.get(entityId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.alerts.get(id))
      .filter((a): a is ContradictionAlert => Boolean(a));
  }

  public resolve(
    id: string,
    resolution: ContradictionResolution,
    note?: string
  ): ContradictionAlert {
    const alert = this.alerts.get(id);
    if (!alert) {
      throw new Error(`Contradiction alert with ID "${id}" not found`);
    }

    if (resolution === 'prefer_a') {
      alert.status = 'resolved_claim_a';
    } else if (resolution === 'prefer_b') {
      alert.status = 'resolved_claim_b';
    } else if (resolution === 'both_valid') {
      alert.status = 'dismissed_both_valid';
    } else if (resolution === 'explicit_contradicts_edge') {
      alert.status = 'active'; // Remains active as edge is created
    }

    alert.resolvedAt = Date.now();
    if (note) alert.resolutionNote = note;

    this.alerts.set(id, alert);
    this.save().catch((err) => console.error('[ContradictionStore] Save error:', err));
    return alert;
  }

  public deleteByDocId(docId: string): void {
    let changed = false;
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.docIdA === docId || alert.docIdB === docId) {
        this.alerts.delete(id);
        if (alert.entityId && this.entityIndex.has(alert.entityId)) {
          this.entityIndex.get(alert.entityId)!.delete(id);
        }
        changed = true;
      }
    }
    if (changed) {
      this.save().catch((err) => console.error('[ContradictionStore] Save error:', err));
    }
  }

  public clear(): void {
    this.alerts.clear();
    this.entityIndex.clear();
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch (e) {
        // ignore
      }
    }
  }
}

export const contradictionStore = new ContradictionStore();
