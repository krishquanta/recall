import { Router, Request, Response } from 'express';
import { auditService } from '../services/AuditService';

export const auditRouter = Router();

/**
 * GET /api/graph/audit-log
 * Returns chronological mutation ledger (newest first) with pagination and filtering.
 */
export async function getAuditLogHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawLimit = req.query.limit as string | undefined;
    const rawOffset = req.query.offset as string | undefined;
    const limit = rawLimit ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 50), 500) : 50;
    const offset = rawOffset ? Math.max(0, parseInt(rawOffset, 10) || 0) : 0;
    const targetId =
      typeof req.query.targetId === 'string' && req.query.targetId.trim()
        ? req.query.targetId.trim()
        : undefined;

    const entries = await auditService.getEntries({ limit, offset, targetId });
    const totalCount = await auditService.getTotalCount({ targetId });

    res.status(200).json({
      success: true,
      entries,
      totalCount,
    });
  } catch (err: any) {
    console.error('Failed to retrieve audit log:', err);
    res.status(500).json({
      error: err?.message || 'Failed to retrieve audit log',
    });
  }
}

/**
 * POST /api/graph/audit-log/:id/rollback
 * Reverts the specified mutation, restores prior graph state, and logs rollback record.
 */
export async function rollbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !id.trim()) {
      res.status(400).json({ error: 'Audit entry ID is required' });
      return;
    }

    const trimmedId = id.trim();
    const existingEntry = await auditService.getEntryById(trimmedId);

    if (!existingEntry) {
      res.status(404).json({ error: `Audit entry "${trimmedId}" not found` });
      return;
    }

    if (existingEntry.rolledBack) {
      res.status(400).json({
        error: `Audit entry "${trimmedId}" has already been rolled back`,
      });
      return;
    }

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : undefined;

    const result = await auditService.rollback(trimmedId, reason);

    if (!result || !result.success) {
      res.status(400).json({
        error: `Failed to rollback audit entry "${trimmedId}"`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      ok: true,
      restoredAuditId: result.restoredAuditId,
      targetId: result.targetId,
      actionLogged: result.actionLogged,
      rollbackResult: result,
    });
  } catch (err: any) {
    console.error(`Error during rollback of entry ${req.params?.id}:`, err);
    const isValidationError =
      err?.name === 'TopologicalInvariantError' ||
      err?.name === 'AuditEntryAlreadyRolledBackError' ||
      err?.statusCode === 400 ||
      err?.message?.includes('already rolled back') ||
      err?.message?.includes('invalid target') ||
      err?.message?.includes('Cannot rollback');
    const isNotFound =
      err?.name === 'AuditEntryNotFoundError' ||
      err?.statusCode === 404 ||
      err?.message?.includes('not found');

    const status = isValidationError ? 400 : isNotFound ? 404 : 500;
    res.status(status).json({
      error: err?.message || 'Rollback execution failed',
    });
  }
}

// Router routes:
auditRouter.get('/audit-log', getAuditLogHandler);
auditRouter.post('/audit-log/:id/rollback', rollbackHandler);
auditRouter.get('/', getAuditLogHandler);
auditRouter.post('/:id/rollback', rollbackHandler);
