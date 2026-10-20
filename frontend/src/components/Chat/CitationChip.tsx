import React from 'react';
import { Citation } from '../../types';
import { useAppStore } from '../../store/appStore';
import { Sparkles, FileText } from 'lucide-react';

export interface CitationChipProps {
  citation: Citation;
  inline?: boolean;
}

export const CitationChip: React.FC<CitationChipProps> = ({ citation, inline = false }) => {
  const { setPreviewChunk, previewChunk } = useAppStore();
  const isActive =
    previewChunk &&
    'index' in previewChunk &&
    (previewChunk as Citation).index === citation.index;
  const isOCR = citation.metadata?.isOCR;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewChunk(citation);
  };

  const getSourceLabel = () => {
    const meta = citation.metadata;
    if (!meta) return `[${citation.index}]`;

    const parts: string[] = [];
    if (meta.page !== undefined) {
      const isSlide = meta.filename?.toLowerCase().match(/\.(pptx|ppt|odp)$/);
      parts.push(isSlide ? `slide ${meta.page}` : `p.${meta.page}`);
    }
    if (meta.sheet) parts.push(`${meta.sheet}`);
    if (meta.rowStart !== undefined) parts.push(`r.${meta.rowStart}`);
    if (meta.lineStart !== undefined) parts.push(`L${meta.lineStart}`);

    return parts.length > 0 ? parts.join(', ') : meta.filename;
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${
        inline ? 'mx-0.5 align-baseline' : 'mx-1'
      } rounded text-xs font-medium cursor-pointer transition-all duration-150 border ${
        isActive
          ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm ring-2 ring-indigo-200'
          : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300'
      }`}
      title={`Source: ${citation.metadata?.filename || 'Document'} | Click to verify original passage`}
    >
      <span className="font-semibold">[{citation.index}]</span>
      <span className="truncate max-w-[120px] text-[11px] opacity-90">
        {getSourceLabel()}
      </span>
      {isOCR ? (
        <span
          className="inline-flex items-center text-[10px] bg-violet-100 text-violet-800 px-1 rounded-sm ml-0.5"
          title="Transcribed from handwriting / image scan"
        >
          <Sparkles className="w-2.5 h-2.5 mr-0.5" />
          OCR
        </span>
      ) : (
        <FileText className="w-2.5 h-2.5 opacity-60 ml-0.5" />
      )}
    </button>
  );
};
