import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Document,
  Message,
  Citation,
  Chunk,
  ProcessingStatus,
  Toast,
  PreviewableEvidence,
  EvidenceRef,
} from '../types';

interface AppState {
  // View mode
  activeView: 'chat' | 'graph';
  setActiveView: (view: 'chat' | 'graph') => void;

  // Data
  documents: Document[];
  messages: Message[];
  activeDocIds: string[]; // empty means all documents
  previewChunk: (Chunk | Citation | PreviewableEvidence) | null;
  previewMode: 'quote' | 'document';

  // UI status
  isUploading: boolean;
  isThinking: boolean;
  sidebarOpen: boolean;
  previewOpen: boolean;
  toasts: Toast[];

  // Document actions
  setDocuments: (documents: Document[]) => void;
  addDocument: (doc: Document) => void;
  updateDocumentStatus: (docId: string, patch: Partial<ProcessingStatus>) => void;
  removeDocument: (docId: string) => void;

  // Chat actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  setIsThinking: (thinking: boolean) => void;

  // Scope actions
  toggleDocScope: (docId: string) => void;
  clearDocScope: () => void;
  setActiveDocIds: (docIds: string[]) => void;

  // Preview actions
  setPreviewChunk: (chunk: (Chunk | Citation | PreviewableEvidence) | null) => void;
  showEvidence: (evidence: EvidenceRef, fallbackTitle?: string) => void;
  setPreviewMode: (mode: 'quote' | 'document') => void;
  closePreview: () => void;

  // Panel toggles
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setPreviewOpen: (open: boolean) => void;
  togglePreview: () => void;
  setIsUploading: (uploading: boolean) => void;

  // Toasts
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeView: 'chat',
      setActiveView: (activeView) => set({ activeView }),

      documents: [],
      messages: [],
      activeDocIds: [],
      previewChunk: null,
      previewMode: 'quote',

      isUploading: false,
      isThinking: false,
      sidebarOpen: true,
      previewOpen: false,
      toasts: [],

      setDocuments: (documents) => set({ documents }),

      addDocument: (doc) =>
        set((state) => {
          const existing = state.documents.findIndex((d) => d.docId === doc.docId);
          if (existing >= 0) {
            const next = [...state.documents];
            next[existing] = doc;
            return { documents: next };
          }
          return { documents: [doc, ...state.documents] };
        }),

      updateDocumentStatus: (docId, patch) =>
        set((state) => ({
          documents: state.documents.map((d) =>
            d.docId === docId
              ? {
                  ...d,
                  isOCR: patch.stage === 'ocr' ? true : d.isOCR,
                  status: { ...d.status, ...patch },
                }
              : d
          ),
        })),

      removeDocument: (docId) =>
        set((state) => ({
          documents: state.documents.filter((d) => d.docId !== docId),
          activeDocIds: state.activeDocIds.filter((id) => id !== docId),
          previewChunk:
            state.previewChunk?.metadata?.docId === docId ? null : state.previewChunk,
          previewOpen:
            state.previewChunk?.metadata?.docId === docId ? false : state.previewOpen,
        })),

      setMessages: (messages) => set({ messages }),

      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),

      clearMessages: () => set({ messages: [] }),

      setIsThinking: (isThinking) => set({ isThinking }),

      toggleDocScope: (docId) =>
        set((state) => {
          const exists = state.activeDocIds.includes(docId);
          if (exists) {
            return { activeDocIds: state.activeDocIds.filter((id) => id !== docId) };
          }
          return { activeDocIds: [...state.activeDocIds, docId] };
        }),

      clearDocScope: () => set({ activeDocIds: [] }),

      setActiveDocIds: (activeDocIds) => set({ activeDocIds }),

      setPreviewChunk: (chunk) =>
        set({
          previewChunk: chunk,
          previewOpen: Boolean(chunk),
        }),

      showEvidence: (evidence: EvidenceRef, fallbackTitle?: string) =>
        set({
          previewChunk: {
            chunkId: evidence.chunkId || `ev-${Date.now()}`,
            quote: evidence.exactQuote,
            text: evidence.exactQuote,
            metadata: {
              docId: evidence.docId || '',
              filename: evidence.filename || fallbackTitle || 'Document Source',
              page: evidence.page,
              slide: evidence.slide,
              sheet: evidence.sheet,
              rowStart: evidence.rowStart,
              lineStart: evidence.lineStart,
              charStart: evidence.charOffset?.start,
              charEnd: evidence.charOffset?.end,
            },
          },
          previewOpen: true,
          previewMode: 'quote',
        }),

      setPreviewMode: (previewMode) => set({ previewMode }),

      closePreview: () => set({ previewOpen: false }),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setPreviewOpen: (previewOpen) => set({ previewOpen }),
      togglePreview: () => set((state) => ({ previewOpen: !state.previewOpen })),

      setIsUploading: (isUploading) => set({ isUploading }),

      addToast: (toast) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((state) => ({
          toasts: [...state.toasts, { ...toast, id }],
        }));

        const duration = toast.duration ?? 4500;
        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
          }));
        }, duration);
      },

      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),
    }),
    {
      name: 'recall-storage',
      partialize: (state) => ({
        activeView: state.activeView,
        messages: state.messages,
        sidebarOpen: state.sidebarOpen,
        activeDocIds: state.activeDocIds,
      }),
    }
  )
);
