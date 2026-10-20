import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { UserBubble } from './UserBubble';
import { AssistantBubble } from './AssistantBubble';
import { GraduationCap, Sparkles, HelpCircle, ArrowRight } from 'lucide-react';
import { useChat } from '../../hooks/useChat';

export const MessageList: React.FC = () => {
  const messages = useAppStore((state) => state.messages);
  const isThinking = useAppStore((state) => state.isThinking);
  const documents = useAppStore((state) => state.documents);
  const { sendMessage } = useChat();

  const scrollBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message or thinking
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const starterPrompts = [
    'Summarize the core concepts covered in my uploaded notes.',
    'What are the key formulas and rules mentioned?',
    'Explain the handwritten diagram and equations in simple terms.',
    'Generate 3 practice quiz questions based on the material.',
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center px-4 py-12">
          {/* Welcome Banner */}
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4 shadow-xs">
            <GraduationCap className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-bold text-slate-800 tracking-tight">
            Smart Teacher AI Study Companion
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-md leading-relaxed">
            Ask questions, understand complex topics, and review lecture notes. Every factual claim is backed by exact, clickable source citations.
          </p>

          {/* Starter Suggestions */}
          <div className="mt-8 w-full">
            <div className="flex items-center gap-1.5 justify-center text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              <span>Try asking</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
              {starterPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(prompt)}
                  disabled={documents.length === 0}
                  className="p-3 bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-xl transition-all duration-150 text-xs text-slate-700 hover:text-indigo-900 group flex items-center justify-between gap-2 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span className="line-clamp-2">{prompt}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>
              ))}
            </div>

            {documents.length === 0 && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-4 flex items-center justify-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Upload at least one document in the sidebar to enable suggestions</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserBubble key={msg.id} message={msg} />
            ) : (
              <AssistantBubble key={msg.id} message={msg} />
            )
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="flex items-start gap-2.5 mb-4 animate-in fade-in">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl rounded-tl-xs px-4 py-3 shadow-2xs">
                <div className="flex items-center gap-2">
                  <div className="flex space-x-1.5">
                    <div className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce"></div>
                  </div>
                  <span className="text-xs text-slate-500 font-medium ml-1">
                    Searching notes & reasoning...
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={scrollBottomRef} />
        </div>
      )}
    </div>
  );
};
