import React from 'react';
import { ChunkMetadata } from '../../types';
import { Sparkles, FileText, Hash } from 'lucide-react';
import clsx from 'clsx';

interface SourceMetaBadgeProps {
  metadata?: ChunkMetadata;
  className?: string;
}

export const SourceMetaBadge: React.FC<SourceMetaBadgeProps> = ({ metadata, className }) => {
  if (!metadata) return null;

  const isOCR = metadata.isOCR;
  const page = metadata.page;
  const sheet = metadata.sheet;
  const rowStart = metadata.rowStart;
  const lineStart = metadata.lineStart;

  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5 text-xs', className)}>
      {/* Document Name */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-slate-100 text-slate-700 border border-slate-200">
        <FileText className="w-3 h-3 text-slate-500" />
        <span className="max-w-[150px] truncate" title={metadata.filename}>
          {metadata.filename}
        </span>
      </span>

      {/* Page / Slide / Row / Line Badge */}
      {page !== undefined && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          {metadata.filename?.toLowerCase().match(/\.(pptx|ppt|odp)$/) ? `Slide ${page}` : `Page ${page}`}
        </span>
      )}

      {sheet && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Sheet: {sheet}
        </span>
      )}

      {rowStart !== undefined && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Row {rowStart}
        </span>
      )}

      {lineStart !== undefined && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-medium bg-blue-50 text-blue-700 border border-blue-200">
          Line {lineStart}
        </span>
      )}

      {/* Chunk Index */}
      {metadata.chunkIndex !== undefined && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] bg-slate-50 text-slate-500 border border-slate-200">
          <Hash className="w-2.5 h-2.5" />
          Chunk {metadata.chunkIndex + 1}
        </span>
      )}

      {/* OCR Tag */}
      {isOCR && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-purple-50 text-purple-700 border border-purple-200 shadow-xs">
          <Sparkles className="w-3 h-3 text-purple-600" />
          🖼 OCR
        </span>
      )}
    </div>
  );
};
