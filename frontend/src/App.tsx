import React from 'react';
import { UploadDropzone } from './components/Sidebar/UploadDropzone';
import { DocumentList } from './components/Sidebar/DocumentList';
import { ChatPanel } from './components/Chat/ChatPanel';
import { PreviewPanel } from './components/Preview/PreviewPanel';
import { StatusToast } from './components/StatusToast';
import { GraphCanvas } from './components/Graph/GraphCanvas';
import { ChatHeaderWithViewSelector } from './components/Header/ChatHeaderWithViewSelector';
import { ReviewQueueModal } from './components/Graph/ReviewQueueModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import { ContradictionDrawer } from './components/Graph/ContradictionDrawer';
import { CorrectRelationModal } from './components/Graph/CorrectRelationModal';
import { VersionHistoryModal } from './components/Graph/VersionHistoryModal';
import { InvestigationQueueModal } from './components/Research/InvestigationQueueModal';
import { ResearchReviewDrawer } from './components/Research/ResearchReviewDrawer';
import { useAppStore } from './store/appStore';
import { BookOpen, X } from 'lucide-react';
import clsx from 'clsx';

export const App: React.FC = () => {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const previewOpen = useAppStore((state) => state.previewOpen);
  const activeView = useAppStore((state) => state.activeView);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-800 antialiased font-sans select-none">
      {/* Toast notifications container */}
      <StatusToast />

      {/* Global Modals & Drawers */}
      <ReviewQueueModal />
      <SettingsModal />
      <ContradictionDrawer />
      <CorrectRelationModal />
      <VersionHistoryModal />
      <InvestigationQueueModal />
      <ResearchReviewDrawer />

      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-slate-900/40 z-30 md:hidden backdrop-blur-xs animate-in fade-in"
        />
      )}

      {/* Panel 1: Library Sidebar (240px wide) */}
      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 lg:w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:-translate-x-full md:w-0 md:border-r-0'
        )}
        aria-label="Document Library"
      >
        {/* Sidebar Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold tracking-tight text-slate-800 uppercase">
              Recall
            </span>
          </div>

          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 rounded-md text-slate-400 hover:text-slate-600"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Upload Zone */}
        <div className="p-3 border-b border-slate-100 bg-white">
          <UploadDropzone compact={false} />
        </div>

        {/* Scrollable Document List */}
        <DocumentList />

        {/* Sidebar Footer info */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400 flex items-center justify-between">
          <span>v2.0 · Knowledge Graph</span>
          <span className="text-emerald-600 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Online
          </span>
        </div>
      </aside>

      {/* Panel 2: Center Panel (Chat or Knowledge Graph) */}
      {activeView === 'chat' ? (
        <ChatPanel />
      ) : (
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
          <ChatHeaderWithViewSelector />
          <GraphCanvas />
        </div>
      )}

      {/* Panel 3: Source Preview Panel (380px wide) */}
      {previewOpen && <PreviewPanel />}
    </div>
  );
};

export default App;
