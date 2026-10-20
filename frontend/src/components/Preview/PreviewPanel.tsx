import React, { useState } from 'react';
import { X, Quote, FileText, Copy, Check, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { SourceMetaBadge } from './SourceMetaBadge';
import { PDFViewer } from './PDFViewer';
import { ImageViewer } from './ImageViewer';
import { TextHighlighter } from './TextHighlighter';
import { getFileUrl } from '../../api/client';
import { Citation } from '../../types';
import { MathContent } from '../Chat/MathContent';
import clsx from 'clsx';

export const PreviewPanel: React.FC = () => {
  const previewOpen = useAppStore((state) => state.previewOpen);
  const previewChunk = useAppStore((state) => state.previewChunk);
  const previewMode = useAppStore((state) => state.previewMode);
  const setPreviewMode = useAppStore((state) => state.setPreviewMode);
  const closePreview = useAppStore((state) => state.closePreview);

  const [copied, setCopied] = useState(false);

  if (!previewOpen) return null;

  const metadata = previewChunk?.metadata;
  const quoteText =
    (previewChunk as any)?.quote ||
    (previewChunk as any)?.text ||
    '';

  const docId = metadata?.docId;
  const filename = metadata?.filename || 'Document Preview';
  const mimeType = metadata?.mimeType || '';
  const ext = filename.split('.').pop()?.toLowerCase();

  const isPDF = ext === 'pdf' || mimeType.includes('pdf');
  const isImage =
    ['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext || '') ||
    mimeType.startsWith('image/');

  const handleCopyQuote = () => {
    if (!quoteText) return;
    navigator.clipboard.writeText(quoteText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside
      className="w-full sm:w-[380px] h-full flex flex-col bg-white border-l border-slate-200 z-30 shadow-lg sm:shadow-none animate-in slide-in-from-right duration-200"
      aria-label="Source Document Preview"
    >
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3
              className="text-xs font-semibold text-slate-800 truncate"
              title={filename}
            >
              {filename}
            </h3>
            <p className="text-[10px] text-slate-400">Source Reference</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {docId && (
            <a
              href={getFileUrl(docId)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Open raw document"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={closePreview}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Metadata Badges Bar */}
      <div className="px-3.5 py-2 bg-white border-b border-slate-100">
        <SourceMetaBadge metadata={metadata} />
      </div>

      {/* Mode Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50/50 px-3 pt-2 gap-1 text-xs font-medium text-slate-600">
        <button
          onClick={() => setPreviewMode('quote')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg transition-colors border-b-2',
            previewMode === 'quote'
              ? 'bg-white text-indigo-600 border-indigo-600 font-semibold shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/60'
          )}
        >
          <Quote className="w-3.5 h-3.5" />
          <span>Quoted Passage</span>
        </button>

        <button
          onClick={() => setPreviewMode('document')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg transition-colors border-b-2',
            previewMode === 'document'
              ? 'bg-white text-indigo-600 border-indigo-600 font-semibold shadow-2xs'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/60'
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Full Document</span>
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 min-h-0 p-3 overflow-hidden flex flex-col">
        {previewMode === 'quote' ? (
          <div className="flex-1 flex flex-col justify-between overflow-y-auto bg-slate-50/50 rounded-xl border border-slate-200/80 p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Cited Excerpt
                </span>
                <button
                  onClick={handleCopyQuote}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {quoteText ? (
                <div className="relative bg-amber-100/70 border-l-4 border-amber-500 pl-3.5 py-2.5 rounded-r-md font-serif">
                  <div className="text-xs text-slate-800 leading-relaxed italic select-text">
                    <MathContent content={quoteText} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  No specific quote snippet available for this reference.
                </p>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-slate-200/60 flex flex-col gap-2">
              <button
                onClick={() => setPreviewMode('document')}
                className="w-full py-2 px-3 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View in Document Context</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {docId ? (
              isPDF ? (
                <PDFViewer
                  docId={docId}
                  initialPage={metadata?.page || 1}
                  highlightQuote={quoteText}
                />
              ) : isImage ? (
                <ImageViewer docId={docId} highlightQuote={quoteText} />
              ) : (
                <TextHighlighter
                  docId={docId}
                  highlightQuote={quoteText}
                  lineStart={metadata?.lineStart}
                  rowStart={metadata?.rowStart}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                Select a document to preview.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
