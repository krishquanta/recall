import React, { useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ExternalLink, Sparkles } from 'lucide-react';
import { getFileUrl } from '../../api/client';

interface ImageViewerProps {
  docId: string;
  highlightQuote?: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ docId, highlightQuote }) => {
  const [scale, setScale] = useState<number>(1);
  const fileUrl = getFileUrl(docId);

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const resetZoom = () => setScale(1);

  return (
    <div className="flex flex-col h-full bg-slate-900/5 rounded-lg overflow-hidden border border-slate-200">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="p-1 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span className="font-medium text-slate-700 px-1">
            {Math.round(scale * 100)}%
          </span>

          <button
            onClick={zoomIn}
            disabled={scale >= 3}
            className="p-1 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {scale !== 1 && (
            <button
              onClick={resetZoom}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 transition-colors ml-1"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
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

      {/* Quoted OCR excerpt banner */}
      {highlightQuote && (
        <div className="bg-purple-50/90 border-b border-purple-200/80 px-3 py-2 text-xs text-purple-900 leading-snug">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 uppercase tracking-wider mb-1">
            <Sparkles className="w-3 h-3 text-purple-600" />
            <span>Extracted Handwriting / Text</span>
          </div>
          <p className="italic line-clamp-2">"{highlightQuote}"</p>
        </div>
      )}

      {/* Scrollable image viewport */}
      <div className="flex-1 w-full overflow-auto p-4 flex items-center justify-center bg-slate-900/5">
        <div
          className="transition-transform duration-150 ease-out flex items-center justify-center"
          style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
        >
          <img
            src={fileUrl}
            alt="Source scan preview"
            className="max-w-full max-h-[70vh] object-contain rounded-md shadow-md border border-slate-200 bg-white"
          />
        </div>
      </div>
    </div>
  );
};
