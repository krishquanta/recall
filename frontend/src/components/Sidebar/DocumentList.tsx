import React, { useState } from 'react';
import { Search, FolderOpen, RefreshCw } from 'lucide-react';
import { DocumentCard } from './DocumentCard';
import { useDocuments } from '../../hooks/useDocuments';

export const DocumentList: React.FC = () => {
  const { documents, isLoading, refreshDocuments, handleDelete, handleReindex, handleDownload } =
    useDocuments();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search and count header */}
      <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <span>Library</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 border border-slate-200">
              {documents.length}
            </span>
          </div>

          <button
            onClick={refreshDocuments}
            disabled={isLoading}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-50"
            title="Refresh document list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100/80 hover:bg-slate-100 focus:bg-white border border-transparent focus:border-indigo-400 rounded-lg outline-hidden transition-all text-slate-800 placeholder-slate-400"
          />
        </div>
      </div>

      {/* Documents scroll area */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-2">
        {filteredDocs.length > 0 ? (
          filteredDocs.map((doc) => (
            <DocumentCard
              key={doc.docId}
              document={doc}
              onDelete={handleDelete}
              onReindex={handleReindex}
              onDownload={handleDownload}
            />
          ))
        ) : documents.length === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center text-center p-4 rounded-xl border border-dashed border-slate-200 text-slate-400">
            <FolderOpen className="w-8 h-8 mb-2 stroke-1 text-slate-300" />
            <p className="text-xs font-medium text-slate-600">No documents yet</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-[180px]">
              Upload notes, textbooks, slides, or handwritten scans above.
            </p>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            No documents matching "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
};
