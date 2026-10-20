import React from 'react';
import { EvidenceRef } from '../../types';
import { MathContent } from '../Chat/MathContent';
import { Quote, FileText, Check, Copy, ExternalLink } from 'lucide-react';
import { getFileUrl } from '../../api/client';

interface EvidenceCardProps {
  evidence: EvidenceRef;
  title?: string;
  relationshipType?: string;
  confidence?: number;
  onOpenDocument?: () => void;
}

export const EvidenceCard: React.FC<EvidenceCardProps> = ({
  evidence,
  title,
  relationshipType,
  confidence,
  onOpenDocument,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (!evidence.exactQuote) return;
    navigator.clipboard.writeText(evidence.exactQuote);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const locationInfo = [
    evidence.page !== undefined ? `Page ${evidence.page}` : null,
    evidence.slide !== undefined ? `Slide ${evidence.slide}` : null,
    evidence.sheet ? `Sheet ${evidence.sheet}` : null,
    evidence.rowStart !== undefined ? `Row ${evidence.rowStart}` : null,
    evidence.lineStart !== undefined ? `Line ${evidence.lineStart}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-800 truncate">
              {title || evidence.filename || 'Evidence Reference'}
            </span>
            {relationshipType && (
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                {relationshipType}
              </span>
            )}
          </div>
          {locationInfo && (
            <p className="text-[10px] text-slate-400 font-medium">
              {locationInfo}
            </p>
          )}
        </div>

        <button
          onClick={handleCopy}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Copy exact quote"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Quote with amber marker highlight */}
      <div className="p-3.5">
        <div className="flex items-center gap-1 text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2">
          <Quote className="w-3 h-3 text-amber-600" />
          <span>Verbatim Supporting Passage</span>
        </div>

        <div className="bg-amber-100/70 border-l-4 border-amber-500 pl-3 py-2 rounded-r-md font-serif text-xs text-slate-800 leading-relaxed italic select-text">
          <MathContent content={evidence.exactQuote} />
        </div>

        {/* Confidence rating */}
        {confidence !== undefined && (
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Extraction Confidence</span>
            <span className="font-semibold text-slate-700">
              {Math.round(confidence * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Footer link to view full document */}
      {onOpenDocument && (
        <div className="px-3.5 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between">
          {evidence.docId ? (
            <a
              href={getFileUrl(evidence.docId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-500 hover:text-indigo-600 flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Original File</span>
            </a>
          ) : (
            <div />
          )}

          <button
            onClick={onOpenDocument}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            <FileText className="w-3 h-3" />
            <span>View in Document</span>
          </button>
        </div>
      )}
    </div>
  );
};
