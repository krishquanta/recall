/**
 * Types and interfaces for the Recall Phase 3 Audit Trail & Rollback Engine.
 */

export type AuditActionType =
  // Edge curation actions
  | 'edge_curate_accept'
  | 'edge_curate_reject'
  | 'edge_curate_correct'
  // High-level relationship actions
  | 'relationship_curated'
  | 'relationship_created'
  | 'relationship_deleted'
  // Entity mutations
  | 'entity_updated'
  | 'entity_merge'
  | 'entity_edit'
  // Claim mutations
  | 'claim_curate'
  | 'claim_updated'
  // Contradiction engine actions
  | 'contradiction_resolved'
  | 'contradiction_resolve'
  // Research agent actions
  | 'research_import'
  // Rollback action
  | 'rollback';

export type AuditTargetType = 'relationship' | 'entity' | 'claim' | 'contradiction' | 'research';

export interface AuditLogEntry {
  auditId: string;              // UUID v4 unique identifier
  timestamp: number;            // UTC epoch milliseconds
  action: AuditActionType;      // The specific mutation performed
  targetType: AuditTargetType;  // Category of target entity
  targetId: string;             // ID of the target
  beforeState: any;             // Snapshot prior to mutation (null if created)
  afterState: any;              // Snapshot post mutation (null if deleted)
  reason?: string;              // Human explanation or curation note
  sourceDocId?: string;         // Originating document ID for provenance
  rolledBack?: boolean;         // True if this mutation has been reverted
  rollbackRefId?: string;       // References target auditId (if rollback) or reverse
  rolledBackBy?: string;        // ID of the rollback audit entry that reverted this
}

export interface AuditQueryOptions {
  limit?: number;               // Max records to return (default: 50, max: 500)
  offset?: number;              // Offset for pagination (default: 0)
  targetId?: string;            // Filter by specific target ID
  targetType?: AuditTargetType; // Filter by target type category
  action?: AuditActionType;     // Filter by action type
  includeRolledBack?: boolean;  // Whether to include rolled back events (default: true)
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];     // Reverse chronological entries
  totalCount: number;           // Total matching records
  hasMore: boolean;             // True if more matching records exist
}

export interface RollbackResult {
  success: boolean;
  restoredAuditId: string;      // The original auditId that was reverted
  targetId: string;             // Target entity/edge ID that was restored
  targetType: AuditTargetType;  // Target type restored
  actionLogged: AuditLogEntry;  // The new rollback audit entry appended to log
}

export interface IAuditStore {
  append(entryData: Omit<AuditLogEntry, 'auditId' | 'timestamp'>): Promise<AuditLogEntry>;
  getById(auditId: string): AuditLogEntry | undefined;
  getEntry(auditId: string): AuditLogEntry | undefined;
  query(options?: AuditQueryOptions): AuditQueryResult;
  getEntries(options?: { limit?: number; offset?: number; targetId?: string } | number, targetId?: string): AuditLogEntry[];
  getHistory(limit?: number, targetId?: string): AuditLogEntry[];
  markRolledBack(originalAuditId: string, rollbackAuditId: string): void;
  unmarkRolledBack(auditId: string): void;
  count(): number;
  getTotalCount(options?: { targetId?: string }): number;
  clear(): Promise<void>;
  loadSync(): void;
}

export interface IAuditService {
  recordMutation(entry: Omit<AuditLogEntry, 'auditId' | 'timestamp'>): Promise<AuditLogEntry>;
  getEntries(options?: { limit?: number; offset?: number; targetId?: string }): Promise<AuditLogEntry[]>;
  getEntry(auditId: string): Promise<AuditLogEntry | undefined>;
  getEntryById(auditId: string): Promise<AuditLogEntry | undefined>;
  getTotalCount(options?: { targetId?: string }): Promise<number>;
  rollback(auditId: string, reason?: string): Promise<RollbackResult>;
}
