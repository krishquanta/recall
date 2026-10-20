import React, { useState } from 'react';
import { Bot, Copy, Check, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { Message, Citation } from '../../types';
import { CitationChip } from './CitationChip';
import { MathContent } from './MathContent';

interface AssistantBubbleProps {
  message: Message;
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const citations = message.citations || [];

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start justify-start gap-2.5 mb-6 group">
      {/* Bot Icon */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
        <Bot className="w-4 h-4" />
      </div>

      <div className="flex flex-col items-start max-w-[85%] sm:max-w-[80%] min-w-0">
        {/* Main message bubble */}
        <div className="bg-white border border-slate-200/90 rounded-2xl rounded-tl-xs p-4 shadow-2xs text-slate-800 text-sm w-full">
          {/* Header row in bubble */}
          <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
              <span>Recall</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">{time}</span>
              <button
                onClick={handleCopy}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-50 transition-colors"
                title="Copy response"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Formatted body with KaTeX and math symbol support */}
          <div className="text-slate-700 font-normal leading-relaxed prose-chat break-words">
            <MathContent content={message.content} citations={citations} />
          </div>

          {/* Bottom Citations Drawer */}
          {citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setSourcesOpen(!sourcesOpen)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-indigo-600 py-1 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span>
                    Sources Cited ({citations.length})
                  </span>
                </div>
                {sourcesOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {sourcesOpen && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 pt-1 animate-in fade-in">
                  {citations.map((c) => (
                    <CitationChip
                      key={`card-${c.chunkId}-${c.index}`}
                      citation={c}
                      inline={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
