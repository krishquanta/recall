import React, { useState, useEffect } from 'react';
import { getDocumentText } from '../../api/client';
import { Loader2 } from 'lucide-react';

interface TextHighlighterProps {
  docId: string;
  highlightQuote?: string;
  lineStart?: number;
  rowStart?: number;
}

export const TextHighlighter: React.FC<TextHighlighterProps> = ({
  docId,
  highlightQuote,
  lineStart,
  rowStart,
}) => {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    getDocumentText(docId)
      .then((text) => {
        if (isMounted) setContent(text);
      })
      .catch((err) => {
        console.error('Could not fetch document text:', err);
        // Fallback to highlight quote if full text is unavailable
        if (isMounted) setContent(highlightQuote || 'Document content preview not available.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [docId, highlightQuote]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
        <span className="text-xs">Loading document text...</span>
      </div>
    );
  }

  // Break text into lines
  const lines = content.split('\n');

  return (
    <div className="flex-1 flex flex-col bg-slate-900 text-slate-100 rounded-lg overflow-hidden border border-slate-700 text-xs font-mono">
      {/* Target indicator */}
      {(lineStart !== undefined || rowStart !== undefined) && (
        <div className="bg-slate-800/80 px-3 py-1.5 border-b border-slate-700 text-[11px] text-indigo-300 flex items-center justify-between">
          <span>
            {lineStart !== undefined ? `Target Line: ${lineStart}` : `Target Row: ${rowStart}`}
          </span>
          <span className="text-slate-400">{lines.length} lines total</span>
        </div>
      )}

      {/* Code / text viewer with line numbers */}
      <div className="flex-1 overflow-y-auto p-2">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const currentLineNumber = idx + 1;
              const isTargetLine =
                (lineStart && Math.abs(currentLineNumber - lineStart) < 3) ||
                (rowStart && currentLineNumber === rowStart);

              const containsQuote =
                highlightQuote &&
                highlightQuote.length > 5 &&
                line.toLowerCase().includes(highlightQuote.slice(0, 20).toLowerCase());

              const isHighlighted = isTargetLine || containsQuote;

              return (
                <tr
                  key={idx}
                  className={
                    isHighlighted
                      ? 'bg-indigo-900/40 text-indigo-200 border-l-2 border-indigo-400'
                      : 'hover:bg-slate-800/40 text-slate-300'
                  }
                >
                  <td className="w-10 select-none text-right pr-3 pl-1 text-[11px] text-slate-500 align-top">
                    {currentLineNumber}
                  </td>
                  <td className="whitespace-pre-wrap break-all pr-2 font-mono text-[11.5px] leading-relaxed">
                    {line || ' '}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
