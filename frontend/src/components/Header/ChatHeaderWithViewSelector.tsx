import React, { useEffect } from 'react';
import { ViewModeSelector } from './ViewModeSelector';
import { useAppStore } from '../../store/appStore';
import { useGraphStore } from '../../store/graphStore';
import {
  PanelLeft,
  PanelRight,
  GraduationCap,
  Settings,
  AlertTriangle,
  History,
  Search,
} from 'lucide-react';

export const ChatHeaderWithViewSelector: React.FC = () => {
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const togglePreview = useAppStore((state) => state.togglePreview);
  const openSettings = useAppStore((state) => state.openSettings);
  const previewChunk = useAppStore((state) => state.previewChunk);
  const documents = useAppStore((state) => state.documents);
  const activeDocIds = useAppStore((state) => state.activeDocIds);
  const researchGaps = useAppStore((state) => state.researchGaps);
  const fetchResearchGaps = useAppStore((state) => state.fetchResearchGaps);
  const setQueueModalOpen = useAppStore((state) => state.setQueueModalOpen);

  const contradictions = useGraphStore((state) => state.contradictions);
  const openContradictionDrawer = useGraphStore(
    (state) => state.openContradictionDrawer
  );
  const openHistoryModal = useGraphStore((state) => state.openHistoryModal);
  const fetchContradictions = useGraphStore(
    (state) => state.fetchContradictions
  );

  useEffect(() => {
    fetchContradictions();
    fetchResearchGaps();
    const interval = setInterval(() => {
      fetchContradictions();
      fetchResearchGaps();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchContradictions, fetchResearchGaps]);

  const scopeLabel =
    activeDocIds.length === 0
      ? 'All Documents'
      : `${activeDocIds.length} Scoped`;

  return (
    <header className="h-14 px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 flex-shrink-0 z-10 shadow-2xs">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          title="Toggle Library Sidebar"
          aria-label="Toggle Library Sidebar"
        >
          <PanelLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div className="min-w-0 hidden md:block">
            <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">
              Recall
            </h1>
            <span className="text-[10px] text-slate-400 font-medium">
              {documents.length} materials · {scopeLabel}
            </span>
          </div>
        </div>
      </div>

      {/* View Mode Toggle & Review Queue Indicator */}
      <ViewModeSelector />

      {/* Action Controls */}
      <div className="flex items-center gap-2">
        {/* Contradictions Alert Button */}
        {contradictions.length > 0 && (
          <button
            onClick={() => openContradictionDrawer()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 transition-colors shadow-2xs"
            title={`${contradictions.length} active contradiction${
              contradictions.length > 1 ? 's' : ''
            } detected across sources`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
            <span className="hidden sm:inline">Contradictions</span>
            <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-200 text-rose-800">
              {contradictions.length}
            </span>
          </button>
        )}

        {/* Research Gaps Button */}
        <button
          onClick={() => setQueueModalOpen(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors shadow-2xs ${
            researchGaps.length > 0
              ? 'bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
          }`}
          title={`${researchGaps.length} knowledge gap${
            researchGaps.length === 1 ? '' : 's'
          } detected`}
        >
          <Search className="w-3.5 h-3.5 text-blue-600" />
          <span className="hidden sm:inline">Gaps</span>
          <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-200 text-blue-800">
            {researchGaps.length}
          </span>
        </button>

        {/* Audit / Version History Button */}
        <button
          onClick={openHistoryModal}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center gap-1.5 text-xs font-medium"
          title="Version History & Audit Log"
          aria-label="History"
        >
          <History className="w-4 h-4" />
          <span className="hidden lg:inline text-xs">History</span>
        </button>

        {/* Gemini API & Cache Settings */}
        <button
          onClick={openSettings}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          title="Gemini API & Cache Settings"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {previewChunk && (
          <button
            onClick={togglePreview}
            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 border border-indigo-200 transition-colors text-xs flex items-center gap-1.5"
            title="Toggle Source Preview"
          >
            <PanelRight className="w-4 h-4" />
            <span className="hidden sm:inline text-xs font-medium">Evidence</span>
          </button>
        )}
      </div>
    </header>
  );
};
