import React, { useState, useEffect } from 'react';
import { useGraphStore } from '../../store/graphStore';
import {
  Scale,
  X,
  CheckCircle,
  GitMerge,
  Split,
  FileText,
  Quote,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

export const ReviewQueueModal: React.FC = () => {
  const isOpen = useGraphStore((state) => state.isReviewModalOpen);
  const closeReviewModal = useGraphStore((state) => state.closeReviewModal);
  const reviewQueue = useGraphStore((state) => state.reviewQueue);
  const resolveQueueItem = useGraphStore((state) => state.resolveQueueItem);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Keep index within bounds
  useEffect(() => {
    if (currentIndex >= reviewQueue.length) {
      setCurrentIndex(Math.max(0, reviewQueue.length - 1));
    }
  }, [reviewQueue.length, currentIndex]);

  // Keyboard escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeReviewModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeReviewModal]);

  if (!isOpen) return null;

  const currentItem = reviewQueue[currentIndex];
  const total = reviewQueue.length;

  const handleResolve = async (action: 'merge' | 'separate') => {
    if (!currentItem || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await resolveQueueItem(currentItem.id, action);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSourceLocation = (ev?: {
    filename?: string;
    page?: number;
    slide?: number;
    rowStart?: number;
    lineStart?: number;
  }) => {
    if (!ev) return 'Document';
    const parts: string[] = [];
    if (ev.filename) parts.push(ev.filename);
    if (ev.page !== undefined) parts.push(`Page ${ev.page}`);
    if (ev.slide !== undefined) parts.push(`Slide ${ev.slide}`);
    if (ev.rowStart !== undefined) parts.push(`Row ${ev.rowStart}`);
    if (ev.lineStart !== undefined) parts.push(`Line ${ev.lineStart}`);
    return parts.join(' · ');
  };

  const similarityPercentage = currentItem
    ? Math.min(100, Math.round(currentItem.similarityScore * 1000) / 10)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shadow-2xs">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="review-modal-title"
                className="text-sm font-bold text-slate-900 tracking-tight"
              >
                Duplicate Entity Review Queue
              </h2>
              <p className="text-xs text-slate-500">
                {total > 0
                  ? `Reviewing match candidate ${currentIndex + 1} of ${total}`
                  : 'All candidate matches resolved'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {total > 1 && (
              <div className="flex items-center gap-1 mr-2 bg-slate-200/60 rounded-lg p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  className="p-1 rounded text-slate-600 hover:text-slate-900 disabled:opacity-30"
                  title="Previous match"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 text-slate-600 font-medium">
                  {currentIndex + 1} / {total}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentIndex((prev) => Math.min(total - 1, prev + 1))
                  }
                  disabled={currentIndex === total - 1}
                  className="p-1 rounded text-slate-600 hover:text-slate-900 disabled:opacity-30"
                  title="Next match"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={closeReviewModal}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close review queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        {total === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Review Queue Clear
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mb-6">
              All duplicate entity candidates have been resolved. The knowledge
              graph is fully deduplicated.
            </p>
            <button
              type="button"
              onClick={closeReviewModal}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            {/* Side-by-Side Comparison Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Proposed Candidate Card */}
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-md">
                      Proposed Candidate
                    </span>
                    <span className="text-xs font-semibold text-slate-600 bg-white/90 px-2 py-0.5 rounded-md border border-slate-200">
                      {currentItem.candidateEntity.type}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mb-2">
                    "{currentItem.candidateEntity.name}"
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-3">
                    <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="truncate">
                      {getSourceLocation(currentItem.candidateEntity.evidence)}
                    </span>
                  </div>

                  {currentItem.candidateEntity.evidence?.exactQuote && (
                    <div className="mt-3 p-3 bg-white/90 rounded-lg border border-amber-200/80">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        <Quote className="w-3 h-3 text-amber-600" />
                        <span>Supporting Passage</span>
                      </div>
                      <p className="text-xs text-slate-700 italic font-serif leading-relaxed line-clamp-4">
                        "{currentItem.candidateEntity.evidence.exactQuote}"
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Existing Graph Entity Card */}
              <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 bg-indigo-100/90 px-2 py-0.5 rounded-md">
                      Existing Graph Entity
                    </span>
                    <span className="text-xs font-semibold text-slate-600 bg-white/90 px-2 py-0.5 rounded-md border border-slate-200">
                      {currentItem.matchedEntity.type}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mb-2">
                    "{currentItem.matchedEntity.name}"
                  </h3>

                  {currentItem.matchedEntity.aliases &&
                    currentItem.matchedEntity.aliases.length > 0 && (
                      <div className="mb-3">
                        <span className="text-[11px] text-slate-500 font-medium">
                          Registered Aliases:{' '}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {currentItem.matchedEntity.aliases.map((alias) => (
                            <span
                              key={alias}
                              className="text-[10px] bg-indigo-100/80 text-indigo-800 px-2 py-0.5 rounded-md font-medium"
                            >
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {currentItem.matchedEntity.evidence?.exactQuote && (
                    <div className="mt-3 p-3 bg-white/90 rounded-lg border border-indigo-200/80">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        <Quote className="w-3 h-3 text-indigo-600" />
                        <span>Existing Entity Evidence</span>
                      </div>
                      <p className="text-xs text-slate-700 italic font-serif leading-relaxed line-clamp-4">
                        "{currentItem.matchedEntity.evidence.exactQuote}"
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Similarity Score Indicator Bar */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                <span className="text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Semantic Vector Match Score</span>
                </span>
                <span className="text-amber-800 font-bold">
                  {similarityPercentage}% Match (Uncertain Threshold)
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full transition-all duration-300"
                  style={{ width: `${similarityPercentage}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500 leading-normal">
                Matches between 78% and 92% semantic cosine similarity require human
                confirmation before automatic alias consolidation or edge repointing.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons Footer */}
        {total > 0 && (
          <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleResolve('separate')}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
            >
              <Split className="w-3.5 h-3.5 text-slate-500" />
              <span>Keep Separate (Different Concepts)</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleResolve('merge')}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Merge & Consolidate Aliases</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
