import React from 'react';
import { ViewModeSelector } from './ViewModeSelector';
import { useAppStore } from '../../store/appStore';
import { PanelLeft, PanelRight, GraduationCap } from 'lucide-react';

export const ChatHeaderWithViewSelector: React.FC = () => {
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const togglePreview = useAppStore((state) => state.togglePreview);
  const previewChunk = useAppStore((state) => state.previewChunk);
  const documents = useAppStore((state) => state.documents);
  const activeDocIds = useAppStore((state) => state.activeDocIds);

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
      <div className="flex items-center gap-1.5">
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
