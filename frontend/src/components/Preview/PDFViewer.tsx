import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { getFileUrl } from '../../api/client';

interface PDFViewerProps {
  docId: string;
  initialPage?: number;
  highlightQuote?: string;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  docId,
  initialPage = 1,
  highlightQuote,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const fileUrl = getFileUrl(docId);

  useEffect(() => {
    if (initialPage) {
      setCurrentPage(initialPage);
    }
  }, [initialPage]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNextPage = () => {
    setCurrentPage(currentPage + 1);
  };

  const resetToCited = () => {
    if (initialPage) setCurrentPage(initialPage);
  };

  const pdfUrlWithPage = `${fileUrl}#page=${currentPage}&view=FitH`;

  return (
    <div className="flex flex-col h-full bg-slate-900/5 rounded-lg overflow-hidden border border-slate-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="font-medium text-slate-700 px-2">
            Page {currentPage}
          </span>

          <button
            onClick={handleNextPage}
            className="p-1 rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {currentPage !== initialPage && (
            <button
              onClick={resetToCited}
              className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
              title="Return to cited page"
            >
              <RotateCcw className="w-3 h-3" />
              Cited p.{initialPage}
            </button>
          )}
        </div>

        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium transition-colors"
          title="Open in new window"
        >
          <span>Open Full</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Quoted highlight pill banner if available */}
      {highlightQuote && (
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-3 py-2 text-xs text-amber-900 leading-snug">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
            <span>Quoted from Page {initialPage}</span>
          </div>
          <p className="italic line-clamp-2">"{highlightQuote}"</p>
        </div>
      )}

      {/* Embedded PDF container */}
      <div className="flex-1 w-full bg-slate-100 relative">
        <iframe
          src={pdfUrlWithPage}
          title="PDF Document Preview"
          className="w-full h-full border-none"
        />
      </div>
    </div>
  );
};
