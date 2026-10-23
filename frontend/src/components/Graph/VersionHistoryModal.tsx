import React, { useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { AuditLogEntry, AuditActionType } from '../../types';
import {
  History,
  X,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Edit3,
  GitMerge,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Clock,
} from 'lucide-react';

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function getActionBadge(action: AuditActionType) {
  switch (action) {
    case 'edge_curate_accept':
    case 'relationship_created':
      return {
        label: 'Accepted / Verified',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />,
      };
    case 'edge_curate_reject':
    case 'relationship_deleted':
      return {
        label: 'Rejected',
        className: 'bg-rose-50 text-rose-700 border-rose-200',
        icon: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
      };
    case 'edge_curate_correct':
    case 'relationship_curated':
      return {
        label: 'Corrected',
        className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        icon: <Edit3 className="w-3.5 h-3.5 text-indigo-600" />,
      };
    case 'contradiction_resolved':
    case 'contradiction_resolve':
      return {
        label: 'Contradiction Resolved',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
      };
    case 'entity_merge':
      return {
        label: 'Entity Merged',
        className: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: <GitMerge className="w-3.5 h-3.5 text-blue-600" />,
      };
    case 'rollback':
      return {
        label: 'Reverted / Rollback',
        className: 'bg-purple-50 text-purple-700 border-purple-200',
        icon: <RotateCcw className="w-3.5 h-3.5 text-purple-600" />,
      };
    default:
      return {
        label: action.replace(/_/g, ' '),
        className: 'bg-slate-50 text-slate-700 border-slate-200',
        icon: <History className="w-3.5 h-3.5 text-slate-500" />,
      };
  }
}

export const VersionHistoryModal: React.FC = () => {
  const isHistoryModalOpen = useGraphStore((state) => state.isHistoryModalOpen);
  const closeHistoryModal = useGraphStore((state) => state.closeHistoryModal);
  const auditEntries = useGraphStore((state) => state.auditEntries);
  const rollbackAuditEntry = useGraphStore((state) => state.rollbackAuditEntry);

  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  if (!isHistoryModalOpen) return null;

  const handleRollback = async (entry: AuditLogEntry) => {
    if (entry.rolledBack || entry.action === 'rollback') return;

    const confirmMsg = `Are you sure you want to revert this action (${entry.action})? This will restore the prior graph state.`;
    if (!window.confirm(confirmMsg)) return;

    setRollingBackId(entry.auditId);
    try {
      await rollbackAuditEntry(entry.auditId, `Reverting audit action: ${entry.action}`);
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-800">
                  Version History & Audit Log
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                  {auditEntries.length} events
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Immutable record of all relationship curations, entity merges, and resolutions
              </p>
            </div>
          </div>

          <button
            onClick={closeHistoryModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Close audit log"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Audit Log Entries List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {auditEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
              <Clock className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No mutations recorded yet</p>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Curating relationships (accept, reject, correct) or resolving contradictions will automatically append audit entries here.
              </p>
            </div>
          ) : (
            auditEntries.map((entry) => {
              const badge = getActionBadge(entry.action);
              const isReverting = rollingBackId === entry.auditId;
              const canRollback = !entry.rolledBack && entry.action !== 'rollback';

              return (
                <div
                  key={entry.auditId}
                  className={`p-4 rounded-xl border transition-all ${
                    entry.rolledBack
                      ? 'bg-slate-50/70 border-slate-200 opacity-60'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      {/* Badge & Timestamp row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.className}`}
                        >
                          {badge.icon}
                          {badge.label}
                        </span>

                        <span className="text-[11px] text-slate-400 font-medium">
                          {formatTimestamp(entry.timestamp)}
                        </span>

                        {entry.rolledBack && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 uppercase tracking-tight">
                            Reverted
                          </span>
                        )}
                      </div>

                      {/* Target info */}
                      <div className="text-xs text-slate-700">
                        <span className="font-semibold text-slate-500 uppercase text-[10px] tracking-wide mr-1.5">
                          Target:
                        </span>
                        <span className="font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                          {entry.targetType}:{entry.targetId}
                        </span>
                        {entry.reason && (
                          <span className="ml-2 italic text-slate-500">
                            — "{entry.reason}"
                          </span>
                        )}
                      </div>

                      {/* State preview / diff if present */}
                      {(entry.beforeState || entry.afterState) && (
                        <div className="mt-2 text-xs grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                              Before
                            </span>
                            <pre className="text-[11px] text-slate-600 font-mono overflow-x-auto whitespace-pre-wrap line-clamp-3">
                              {entry.beforeState
                                ? typeof entry.beforeState === 'object'
                                  ? JSON.stringify(entry.beforeState, null, 1)
                                  : String(entry.beforeState)
                                : '(empty / none)'}
                            </pre>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                              After
                            </span>
                            <pre className="text-[11px] text-slate-600 font-mono overflow-x-auto whitespace-pre-wrap line-clamp-3">
                              {entry.afterState
                                ? typeof entry.afterState === 'object'
                                  ? JSON.stringify(entry.afterState, null, 1)
                                  : String(entry.afterState)
                                : '(removed)'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action button */}
                    {canRollback && (
                      <button
                        onClick={() => handleRollback(entry)}
                        disabled={isReverting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors disabled:opacity-50 flex-shrink-0"
                        title="Revert graph to state before this action"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${isReverting ? 'animate-spin' : ''}`} />
                        <span>Revert</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
          <span>All mutations are saved to local append-only event store (audit_log.jsonl)</span>
          <button
            onClick={closeHistoryModal}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 font-medium text-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
