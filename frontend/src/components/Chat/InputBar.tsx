import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { useAppStore } from '../../store/appStore';
import clsx from 'clsx';

export const InputBar: React.FC = () => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isThinking } = useChat();
  const documents = useAppStore((state) => state.documents);
  const activeDocIds = useAppStore((state) => state.activeDocIds);

  const hasReadyDocs = documents.some((d) => d.status.stage === 'done');

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [text]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() || isThinking) return;

    sendMessage(text);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  let placeholder = 'Ask anything about your study materials...';
  if (documents.length === 0) {
    placeholder = 'Upload your documents or notes first to start asking questions...';
  } else if (activeDocIds.length > 0) {
    placeholder = `Ask a question scoped to ${activeDocIds.length} selected document${activeDocIds.length > 1 ? 's' : ''}...`;
  }

  return (
    <div className="p-3 sm:p-4 bg-white border-t border-slate-200">
      <form onSubmit={handleSubmit} className="relative flex flex-col gap-1.5">
        <div
          className={clsx(
            'relative flex items-end gap-2 bg-slate-50 border rounded-2xl p-2 transition-all duration-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-200 focus-within:border-indigo-500',
            isThinking ? 'opacity-80' : 'border-slate-300/80 shadow-2xs'
          )}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isThinking}
            className="flex-1 bg-transparent border-0 outline-hidden resize-none py-1.5 px-2 text-sm text-slate-800 placeholder-slate-400 max-h-[140px] leading-relaxed"
          />

          <button
            type="submit"
            disabled={!text.trim() || isThinking}
            className={clsx(
              'p-2 rounded-xl transition-all duration-200 flex items-center justify-center flex-shrink-0 cursor-pointer',
              text.trim() && !isThinking
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs hover:scale-105 active:scale-95'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            )}
            title="Send message (Enter)"
            aria-label="Send message"
          >
            {isThinking ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Keyboard shortcut hint */}
        <div className="flex items-center justify-between px-2 text-[11px] text-slate-400 select-none">
          <span>
            {hasReadyDocs ? (
              <span>
                Press <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-[10px]">Enter</kbd> to send · <kbd className="px-1 py-0.5 rounded bg-slate-100 border text-[10px]">Shift+Enter</kbd> for new line
              </span>
            ) : (
              <span>Add PDF, MD, XLSX, or handwritten scans in the Library</span>
            )}
          </span>
          {text.length > 0 && (
            <span>{text.length} chars</span>
          )}
        </div>
      </form>
    </div>
  );
};
