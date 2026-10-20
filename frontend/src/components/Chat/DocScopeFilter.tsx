import React from 'react';
import { useAppStore } from '../../store/appStore';
import { Layers, X } from 'lucide-react';
import clsx from 'clsx';

export const DocScopeFilter: React.FC = () => {
  const documents = useAppStore((state) => state.documents);
  const activeDocIds = useAppStore((state) => state.activeDocIds);
  const toggleDocScope = useAppStore((state) => state.toggleDocScope);
  const clearDocScope = useAppStore((state) => state.clearDocScope);

  if (documents.length === 0) return null;

  const isAllSelected = activeDocIds.length === 0;

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border-b border-slate-200/80 overflow-x-auto text-xs no-scrollbar">
      <div className="flex items-center gap-1 text-slate-400 mr-1 flex-shrink-0">
        <Layers className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wider">Search Scope:</span>
      </div>

      {/* "All Documents" pill */}
      <button
        onClick={clearDocScope}
        className={clsx(
          'px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 cursor-pointer',
          isAllSelected
            ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
            : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
        )}
      >
        All Documents ({documents.length})
      </button>

      {/* Document Pills */}
      {documents.map((doc) => {
        const isSelected = activeDocIds.includes(doc.docId);
        return (
          <button
            key={doc.docId}
            onClick={() => toggleDocScope(doc.docId)}
            className={clsx(
              'px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 flex-shrink-0 max-w-[180px] cursor-pointer',
              isSelected
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 font-semibold'
                : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
            )}
            title={doc.filename}
          >
            <span className="truncate">{doc.filename}</span>
            {isSelected && <X className="w-3 h-3 text-indigo-600" />}
          </button>
        );
      })}

      {!isAllSelected && (
        <button
          onClick={clearDocScope}
          className="text-[11px] text-slate-400 hover:text-slate-600 underline ml-1 flex-shrink-0"
        >
          Reset to All
        </button>
      )}
    </div>
  );
};
