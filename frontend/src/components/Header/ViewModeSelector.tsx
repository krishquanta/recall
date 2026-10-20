import React, { useEffect } from 'react';
import { MessageSquare, Network, Scale } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useGraphStore } from '../../store/graphStore';
import clsx from 'clsx';

interface ViewModeSelectorProps {
  className?: string;
}

export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({ className }) => {
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);

  const reviewQueue = useGraphStore((state) => state.reviewQueue);
  const openReviewModal = useGraphStore((state) => state.openReviewModal);
  const fetchReviewQueue = useGraphStore((state) => state.fetchReviewQueue);

  useEffect(() => {
    fetchReviewQueue();
    // Poll review queue periodically or on interval
    const interval = setInterval(fetchReviewQueue, 30000);
    return () => clearInterval(interval);
  }, [fetchReviewQueue]);

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      {/* Segmented Control */}
      <div className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg shadow-inner">
        <button
          type="button"
          onClick={() => setActiveView('chat')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150',
            activeView === 'chat'
              ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-900/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          )}
          title="Switch to Chat Mode"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('graph')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150',
            activeView === 'graph'
              ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-900/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
          )}
          title="Switch to Knowledge Graph Mode"
        >
          <Network className="w-3.5 h-3.5" />
          <span>Graph</span>
        </button>
      </div>

      {/* Review Queue Badge button */}
      {reviewQueue.length > 0 && (
        <button
          type="button"
          onClick={openReviewModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 hover:border-amber-400 shadow-xs transition-colors animate-pulse"
          title={`${reviewQueue.length} uncertain duplicate entity match${
            reviewQueue.length > 1 ? 'es' : ''
          } waiting for review`}
        >
          <Scale className="w-3.5 h-3.5 text-amber-600" />
          <span className="hidden sm:inline">Review Queue</span>
          <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900">
            {reviewQueue.length}
          </span>
        </button>
      )}
    </div>
  );
};
