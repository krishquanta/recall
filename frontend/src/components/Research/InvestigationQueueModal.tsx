import React, { useState } from 'react';
import {
  X,
  Search,
  AlertTriangle,
  Clock,
  Link2,
  FileQuestion,
  HelpCircle,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { GapType, InvestigationGap } from '../../types';
import { ResearchProgressPanel } from './ResearchProgressPanel';

export const InvestigationQueueModal: React.FC = () => {
  const {
    isQueueModalOpen,
    setQueueModalOpen,
    researchGaps,
    isResearching,
    researchProgress,
    startResearchTask,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'ALL' | GapType>('ALL');
  const [customQuestion, setCustomQuestion] = useState('');
  const [activeInvestigationTopic, setActiveInvestigationTopic] = useState('');

  if (!isQueueModalOpen) return null;

  const filteredGaps = researchGaps.filter((gap) => {
    if (activeTab === 'ALL') return true;
    return gap.type === activeTab;
  });

  const contradictionCount = researchGaps.filter((g) => g.type === 'CONTRADICTION').length;
  const staleCount = researchGaps.filter((g) => g.type === 'STALE_CLAIM').length;
  const weakCount = researchGaps.filter((g) => g.type === 'WEAK_GROUNDING').length;
  const isolatedCount = researchGaps.filter((g) => g.type === 'ISOLATED_ENTITY').length;

  const handleInvestigate = (gap: InvestigationGap) => {
    setActiveInvestigationTopic(gap.suggestedQuestion);
    startResearchTask(gap.suggestedQuestion, gap.id);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuestion.trim() || isResearching) return;
    const q = customQuestion.trim();
    setActiveInvestigationTopic(q);
    startResearchTask(q);
    setCustomQuestion('');
  };

  const getPriorityBadge = (score: number) => {
    const pct = Math.round(score * 100);
    if (score >= 0.9) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
          {pct}% Priority
        </span>
      );
    }
    if (score >= 0.7) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          {pct}% Priority
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
        {pct}% Priority
      </span>
    );
  };

  const getGapIcon = (type: GapType) => {
    switch (type) {
      case 'CONTRADICTION':
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      case 'STALE_CLAIM':
        return <Clock className="w-4 h-4 text-amber-400" />;
      case 'WEAK_GROUNDING':
        return <FileQuestion className="w-4 h-4 text-purple-400" />;
      case 'ISOLATED_ENTITY':
        return <Link2 className="w-4 h-4 text-sky-400" />;
      default:
        return <HelpCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-white">Investigation Queue & Knowledge Gaps</h3>
              <p className="text-xs text-slate-400">
                Audited contradictions, orphan concepts, and single-source claims ready for web research
              </p>
            </div>
          </div>
          <button
            onClick={() => setQueueModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* In-progress Banner */}
        {isResearching && (
          <div className="p-4 bg-slate-950/60 border-b border-slate-800">
            <ResearchProgressPanel
              progress={researchProgress}
              currentQuery={activeInvestigationTopic}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1.5 px-6 pt-3 pb-2 border-b border-slate-800/80 bg-slate-900/50 overflow-x-auto">
          <button
            onClick={() => setActiveTab('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'ALL'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            All Gaps ({researchGaps.length})
          </button>
          <button
            onClick={() => setActiveTab('CONTRADICTION')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'CONTRADICTION'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Contradictions ({contradictionCount})
          </button>
          <button
            onClick={() => setActiveTab('STALE_CLAIM')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'STALE_CLAIM'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Stale ({staleCount})
          </button>
          <button
            onClick={() => setActiveTab('WEAK_GROUNDING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'WEAK_GROUNDING'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileQuestion className="w-3.5 h-3.5" />
            Weak Grounding ({weakCount})
          </button>
          <button
            onClick={() => setActiveTab('ISOLATED_ENTITY')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'ISOLATED_ENTITY'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Isolated ({isolatedCount})
          </button>
        </div>

        {/* Gap Cards List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {filteredGaps.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
                <Sparkles className="w-6 h-6 text-blue-400" />
              </div>
              <h4 className="text-sm font-semibold text-slate-300">
                {researchGaps.length === 0 ? 'No Knowledge Gaps Detected' : 'No Gaps In This Category'}
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {researchGaps.length === 0
                  ? 'Your knowledge base is well-connected and grounded. You can still initiate custom research inquiries below.'
                  : 'Try selecting another tab or start a custom research inquiry below.'}
              </p>
            </div>
          ) : (
            filteredGaps.map((gap) => (
              <div
                key={gap.id}
                className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-all space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
                      {getGapIcon(gap.type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">{gap.title}</h4>
                        {getPriorityBadge(gap.priorityScore)}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{gap.description}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleInvestigate(gap)}
                    disabled={isResearching}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none rounded-lg shadow-sm transition-all"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Investigate
                  </button>
                </div>

                {/* Suggested prompt preview */}
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-blue-300 truncate pr-2">
                    {gap.suggestedQuestion}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0 font-semibold">
                    Prompt
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer: Custom Inquiry Input */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90">
          <form onSubmit={handleCustomSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Custom Research Inquiry (e.g. Asymptotic runtime of Dijkstra with Fibonacci heaps)..."
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                disabled={isResearching}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={!customQuestion.trim() || isResearching}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-all shadow-sm shrink-0"
            >
              <span>Start Task</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
