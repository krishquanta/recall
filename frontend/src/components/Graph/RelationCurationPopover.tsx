import React from 'react';
import { useGraphStore } from '../../store/graphStore';
import { Check, X, Edit2, FileText, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

export const RelationCurationPopover: React.FC = () => {
  const selectedEdge = useGraphStore((state) => state.selectedEdge);
  const selectEdge = useGraphStore((state) => state.selectEdge);
  const curateRelationship = useGraphStore((state) => state.curateRelationship);
  const openCorrectModal = useGraphStore((state) => state.openCorrectModal);
  const nodes = useGraphStore((state) => state.nodes);

  if (!selectedEdge) return null;

  const sourceNode = nodes.find((n) => n.id === selectedEdge.sourceId);
  const targetNode = nodes.find((n) => n.id === selectedEdge.targetId);
  const status = selectedEdge.curationStatus || 'proposed';

  const handleAccept = () => {
    curateRelationship(selectedEdge.id, { action: 'accept' });
  };

  const handleReject = () => {
    curateRelationship(selectedEdge.id, { action: 'reject' });
  };

  const handleCorrect = () => {
    openCorrectModal(selectedEdge);
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl p-4 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-800">
            {sourceNode?.name || 'Source Entity'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-tight uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
            <ArrowRight className="w-2.5 h-2.5" />
            {selectedEdge.relationType}
          </span>
          <span className="text-xs font-bold text-slate-800">
            {targetNode?.name || 'Target Entity'}
          </span>
        </div>

        <button
          onClick={() => selectEdge(null)}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Close curation panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Status & Evidence quote */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-700">Status:</span>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
              status === 'verified'
                ? 'bg-emerald-100 text-emerald-800'
                : status === 'corrected'
                ? 'bg-indigo-100 text-indigo-800'
                : status === 'rejected'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {status === 'verified' && <ShieldCheck className="w-3 h-3 text-emerald-600" />}
            {status}
          </span>
          {selectedEdge.curationReason && (
            <span className="truncate italic text-slate-400">
              "{selectedEdge.curationReason}"
            </span>
          )}
        </div>

        {selectedEdge.evidence && (
          <div className="bg-slate-50 rounded-lg border border-slate-200/80 p-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-500 font-medium text-[10px] uppercase tracking-wider mb-1">
              <FileText className="w-3 h-3 text-slate-400" />
              <span>
                {selectedEdge.evidence.filename || 'Source Document'}
                {selectedEdge.evidence.page && ` · Page ${selectedEdge.evidence.page}`}
                {selectedEdge.evidence.slide && ` · Slide ${selectedEdge.evidence.slide}`}
                {selectedEdge.evidence.lineStart && ` · Line ${selectedEdge.evidence.lineStart}`}
              </span>
            </div>
            <p className="text-slate-700 italic border-l-2 border-indigo-400 pl-2">
              "{selectedEdge.evidence.exactQuote}"
            </p>
          </div>
        )}
      </div>

      {/* Curation Action Buttons */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          onClick={handleReject}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
          title="Mark relationship as rejected (soft delete)"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>

        <button
          onClick={handleCorrect}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors"
          title="Change relation type, swap direction, or add note"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Correct / Edit
        </button>

        <button
          onClick={handleAccept}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-colors"
          title="Accept and verify relationship"
        >
          <Check className="w-3.5 h-3.5" />
          Accept & Verify
        </button>
      </div>
    </div>
  );
};
