import React from 'react';
import { useGraphStore } from '../../store/graphStore';
import {
  AlertTriangle,
  X,
  FileText,
  Clock,
  ArrowRight,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';

export const ContradictionDrawer: React.FC = () => {
  const isContradictionDrawerOpen = useGraphStore(
    (state) => state.isContradictionDrawerOpen
  );
  const closeContradictionDrawer = useGraphStore(
    (state) => state.closeContradictionDrawer
  );
  const contradictions = useGraphStore((state) => state.contradictions);
  const selectedContradiction = useGraphStore(
    (state) => state.selectedContradiction
  );
  const resolveContradictionAlert = useGraphStore(
    (state) => state.resolveContradictionAlert
  );

  const activeAlert = selectedContradiction || contradictions[0];

  if (!isContradictionDrawerOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-rose-50/50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-rose-100 text-rose-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Contradictions & Stale Info ({contradictions.length})
            </h3>
            <p className="text-[11px] text-slate-500">Cross-source conflicting assertions</p>
          </div>
        </div>
        <button
          onClick={closeContradictionDrawer}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {contradictions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
            <CheckCircle className="w-10 h-10 text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No active contradictions!</p>
            <p className="text-xs text-slate-400 max-w-xs mt-1">
              All claims across ingested sources are concordant or resolved.
            </p>
          </div>
        ) : activeAlert ? (
          <div className="space-y-4">
            {/* Meta Tags */}
            <div className="flex items-center justify-between gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                {activeAlert.entityName}
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    activeAlert.severity === 'high'
                      ? 'bg-rose-100 text-rose-700 border border-rose-200'
                      : 'bg-amber-100 text-amber-700 border border-amber-200'
                  }`}
                >
                  {activeAlert.severity} severity
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                  {activeAlert.type.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Explanation card */}
            <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-bold mb-1 text-[11px] text-amber-800 uppercase tracking-wider">
                <HelpCircle className="w-3.5 h-3.5" />
                Conflict Summary
              </div>
              <p>{activeAlert.explanation}</p>
            </div>

            {/* Side-by-Side Comparison */}
            <div className="space-y-3">
              {/* Source A */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px]">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">Source A: {activeAlert.filenameA}</span>
                </div>
                <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200/70 border-l-2 border-l-rose-500">
                  "{activeAlert.quoteA}"
                </p>
              </div>

              {/* Source B */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px]">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">Source B: {activeAlert.filenameB}</span>
                </div>
                <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-slate-200/70 border-l-2 border-l-indigo-500">
                  "{activeAlert.quoteB}"
                </p>
              </div>
            </div>

            {/* Resolution Buttons */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Resolve Contradiction
              </span>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => resolveContradictionAlert(activeAlert.id, 'prefer_a')}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors truncate"
                  title="Mark Source A as correct / current"
                >
                  Prefer Source A
                </button>
                <button
                  onClick={() => resolveContradictionAlert(activeAlert.id, 'prefer_b')}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors truncate"
                  title="Mark Source B as correct / current"
                >
                  Prefer Source B
                </button>
              </div>

              <button
                onClick={() => resolveContradictionAlert(activeAlert.id, 'both_valid')}
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors"
                title="Both assertions valid in different contexts"
              >
                Both Valid in Different Contexts
              </button>

              <button
                onClick={() =>
                  resolveContradictionAlert(activeAlert.id, 'explicit_contradicts_edge')
                }
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
                title="Connect both concepts with a permanent CONTRADICTS edge in the graph"
              >
                Create Explicit CONTRADICTS Edge
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
