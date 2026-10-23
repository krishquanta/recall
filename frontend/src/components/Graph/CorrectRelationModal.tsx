import React, { useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { RelationType } from '../../types';
import { X, ArrowRightLeft, Check, Sparkles } from 'lucide-react';

const RELATION_TYPES: RelationType[] = [
  'DEFINES',
  'IS_A',
  'PART_OF',
  'PREREQUISITE_FOR',
  'CAUSES',
  'USES',
  'CONTRADICTS',
  'PROVES',
  'EQUIVALENT_TO',
  'RELATED_TO',
];

export const CorrectRelationModal: React.FC = () => {
  const isCorrectModalOpen = useGraphStore((state) => state.isCorrectModalOpen);
  const curatingEdge = useGraphStore((state) => state.curatingEdge);
  const closeCorrectModal = useGraphStore((state) => state.closeCorrectModal);
  const curateRelationship = useGraphStore((state) => state.curateRelationship);
  const nodes = useGraphStore((state) => state.nodes);

  const [selectedType, setSelectedType] = useState<RelationType>(
    curatingEdge?.relationType || 'RELATED_TO'
  );
  const [invertDirection, setInvertDirection] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync state when edge changes
  React.useEffect(() => {
    if (curatingEdge) {
      setSelectedType(curatingEdge.relationType);
      setInvertDirection(false);
      setReason('');
    }
  }, [curatingEdge]);

  if (!isCorrectModalOpen || !curatingEdge) return null;

  const sourceNode = nodes.find((n) => n.id === curatingEdge.sourceId);
  const targetNode = nodes.find((n) => n.id === curatingEdge.targetId);

  const displaySource = invertDirection ? targetNode?.name : sourceNode?.name;
  const displayTarget = invertDirection ? sourceNode?.name : targetNode?.name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await curateRelationship(curatingEdge.id, {
        action: 'correct',
        relationType: selectedType,
        invertDirection,
        reason: reason.trim() || undefined,
      });
      closeCorrectModal();
    } catch (err) {
      console.error('Correction submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Correct Relationship</h3>
              <p className="text-xs text-slate-500">Edit relation semantics or swap edge direction</p>
            </div>
          </div>
          <button
            onClick={closeCorrectModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Edge Preview with direction swap */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Connected Entities
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-slate-800 truncate">
                  {displaySource || 'Source Entity'}
                </span>
                <span className="text-[10px] text-slate-400">Source</span>
              </div>

              <button
                type="button"
                onClick={() => setInvertDirection((prev) => !prev)}
                className={`p-2 rounded-lg border transition-all ${
                  invertDirection
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 hover:text-indigo-600'
                }`}
                title="Swap edge direction"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>

              <div className="flex-1 min-w-0 text-right">
                <span className="block text-xs font-bold text-slate-800 truncate">
                  {displayTarget || 'Target Entity'}
                </span>
                <span className="text-[10px] text-slate-400">Target</span>
              </div>
            </div>
          </div>

          {/* Relation Type Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Relation Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as RelationType)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {RELATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Optional Reason / Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Correction Reason (Optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Textbook chapter 4 notes this concept is a mandatory prerequisite rather than just related."
              rows={3}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={closeCorrectModal}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {isSubmitting ? 'Saving...' : 'Save Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
