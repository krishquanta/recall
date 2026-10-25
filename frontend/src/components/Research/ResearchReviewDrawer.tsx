import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Network,
  ExternalLink,
  Check,
  CheckSquare,
  Square,
  Sparkles,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Globe,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export const ResearchReviewDrawer: React.FC = () => {
  const {
    isReviewDrawerOpen,
    setReviewDrawerOpen,
    activeProposal,
    importAcceptedUpdates,
    rejectProposal,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'REPORT' | 'UPDATES'>('REPORT');

  // Checkbox selection states
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [selectedRelationIds, setSelectedRelationIds] = useState<string[]>([]);
  const [selectedResolutionIds, setSelectedResolutionIds] = useState<string[]>([]);

  // Initialize selection when proposal changes
  useEffect(() => {
    if (activeProposal) {
      setSelectedEntityIds(activeProposal.proposedEntities.map((e) => e.tempId));
      setSelectedRelationIds(activeProposal.proposedRelations.map((r) => r.tempId));
      setSelectedResolutionIds(activeProposal.proposedResolutions.map((res) => res.contradictionId));
    } else {
      setSelectedEntityIds([]);
      setSelectedRelationIds([]);
      setSelectedResolutionIds([]);
    }
  }, [activeProposal]);

  if (!isReviewDrawerOpen || !activeProposal) return null;

  const totalCandidates =
    activeProposal.proposedEntities.length +
    activeProposal.proposedRelations.length +
    activeProposal.proposedResolutions.length;

  const totalSelected =
    selectedEntityIds.length + selectedRelationIds.length + selectedResolutionIds.length;

  const allSelected = totalSelected === totalCandidates && totalCandidates > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedEntityIds([]);
      setSelectedRelationIds([]);
      setSelectedResolutionIds([]);
    } else {
      setSelectedEntityIds(activeProposal.proposedEntities.map((e) => e.tempId));
      setSelectedRelationIds(activeProposal.proposedRelations.map((r) => r.tempId));
      setSelectedResolutionIds(activeProposal.proposedResolutions.map((res) => res.contradictionId));
    }
  };

  const toggleEntity = (tempId: string) => {
    setSelectedEntityIds((prev) =>
      prev.includes(tempId) ? prev.filter((id) => id !== tempId) : [...prev, tempId]
    );
  };

  const toggleRelation = (tempId: string) => {
    setSelectedRelationIds((prev) =>
      prev.includes(tempId) ? prev.filter((id) => id !== tempId) : [...prev, tempId]
    );
  };

  const toggleResolution = (contraId: string) => {
    setSelectedResolutionIds((prev) =>
      prev.includes(contraId) ? prev.filter((id) => id !== contraId) : [...prev, contraId]
    );
  };

  const handleImport = async () => {
    await importAcceptedUpdates(
      activeProposal.id,
      selectedEntityIds,
      selectedRelationIds,
      selectedResolutionIds
    );
  };

  const handleDiscard = async () => {
    if (window.confirm('Discard this research proposal and all discovered updates?')) {
      await rejectProposal(activeProposal.id);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col text-slate-100 animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wide">
              Research Dossier
            </span>
            <span className="text-xs text-slate-400">
              {new Date(activeProposal.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <h3 className="font-semibold text-base text-white mt-1 truncate max-w-md">
            {activeProposal.report.question}
          </h3>
        </div>

        <button
          onClick={() => setReviewDrawerOpen(false)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Two Tab Buttons */}
      <div className="flex border-b border-slate-800 bg-slate-950/40">
        <button
          onClick={() => setActiveTab('REPORT')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'REPORT'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Sourced Report</span>
        </button>
        <button
          onClick={() => setActiveTab('UPDATES')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'UPDATES'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Proposed Graph Updates ({totalCandidates})</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'REPORT' ? (
          <div className="space-y-6">
            {/* Executive Summary */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                Executive Summary
              </h4>
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs leading-relaxed text-slate-200">
                {activeProposal.report.summary}
              </div>
            </div>

            {/* What Changed & Why (Delta Card) */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                What Changed and Why
              </h4>
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs leading-relaxed text-emerald-100">
                {activeProposal.report.whatChangedAndWhy}
              </div>
            </div>

            {/* Detailed Analysis */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Detailed Analysis
              </h4>
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs leading-relaxed text-slate-300 whitespace-pre-line">
                {activeProposal.report.detailedAnalysis}
              </div>
            </div>

            {/* Sourced Citations */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                Verified Citations ({activeProposal.report.sources.length})
              </h4>
              <div className="space-y-2.5">
                {activeProposal.report.sources.map((source) => (
                  <div
                    key={source.id}
                    className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 hover:border-slate-700 transition-colors space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate max-w-xs">
                        {source.title}
                      </span>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 shrink-0"
                      >
                        <span>{source.domain}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    {source.snippet && (
                      <p className="text-[11px] text-slate-400 line-clamp-3 italic bg-slate-900/50 p-2 rounded border border-slate-800/50">
                        "{source.snippet}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Staging Control Bar */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white"
              >
                {allSelected ? (
                  <CheckSquare className="w-4 h-4 text-blue-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500" />
                )}
                <span>Select All Proposed Updates ({totalSelected} of {totalCandidates})</span>
              </button>
            </div>

            {/* Proposed Entities */}
            {activeProposal.proposedEntities.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Proposed Concepts & Entities ({activeProposal.proposedEntities.length})
                </h4>
                <div className="space-y-2">
                  {activeProposal.proposedEntities.map((ent) => {
                    const isChecked = selectedEntityIds.includes(ent.tempId);
                    return (
                      <div
                        key={ent.tempId}
                        onClick={() => toggleEntity(ent.tempId)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isChecked
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : 'bg-slate-950/30 border-slate-800/60 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleEntity(ent.tempId)}
                          className="mt-1 rounded border-slate-700 text-emerald-500 focus:ring-0"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">{ent.name}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {ent.type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{ent.description}</p>
                          {ent.evidenceQuote && (
                            <div className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded border border-slate-800">
                              Quote: "{ent.evidenceQuote}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Proposed Relations */}
            {activeProposal.proposedRelations.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  Proposed Relationships ({activeProposal.proposedRelations.length})
                </h4>
                <div className="space-y-2">
                  {activeProposal.proposedRelations.map((rel) => {
                    const isChecked = selectedRelationIds.includes(rel.tempId);
                    return (
                      <div
                        key={rel.tempId}
                        onClick={() => toggleRelation(rel.tempId)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isChecked
                            ? 'bg-blue-950/20 border-blue-500/40'
                            : 'bg-slate-950/30 border-slate-800/60 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRelation(rel.tempId)}
                          className="mt-1 rounded border-slate-700 text-blue-500 focus:ring-0"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-white flex-wrap">
                            <span>{rel.sourceEntityName}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              {rel.relationType}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span>{rel.targetEntityName}</span>
                          </div>
                          <p className="text-xs text-slate-300">{rel.description}</p>
                          {rel.evidenceQuote && (
                            <div className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded border border-slate-800">
                              Quote: "{rel.evidenceQuote}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Proposed Contradiction Resolutions */}
            {activeProposal.proposedResolutions.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  Contradiction Resolutions ({activeProposal.proposedResolutions.length})
                </h4>
                <div className="space-y-2">
                  {activeProposal.proposedResolutions.map((res) => {
                    const isChecked = selectedResolutionIds.includes(res.contradictionId);
                    return (
                      <div
                        key={res.contradictionId}
                        onClick={() => toggleResolution(res.contradictionId)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isChecked
                            ? 'bg-amber-950/20 border-amber-500/40'
                            : 'bg-slate-950/30 border-slate-800/60 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleResolution(res.contradictionId)}
                          className="mt-1 rounded border-slate-700 text-amber-500 focus:ring-0"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">
                              Resolution: {res.resolutionType}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{res.explanation}</p>
                          {res.winningClaimEvidenceQuote && (
                            <div className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded border border-slate-800">
                              Winning quote: "{res.winningClaimEvidenceQuote}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drawer Action Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
        <button
          onClick={handleDiscard}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-colors border border-rose-500/20"
        >
          <Trash2 className="w-4 h-4" />
          <span>Discard Proposal</span>
        </button>

        <button
          onClick={handleImport}
          disabled={totalSelected === 0}
          className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-all shadow-sm"
        >
          <Check className="w-4 h-4" />
          <span>Import Accepted Updates ({totalSelected})</span>
        </button>
      </div>
    </div>
  );
};
