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
  InvestigationGap,
  ResearchProposal,
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
  isSettingsOpen: boolean;
  toasts: Toast[];

  // Settings actions
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;

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

  // Phase 4 Autonomous Research
  researchGaps: InvestigationGap[];
  activeProposal: ResearchProposal | null;
  isResearching: boolean;
  researchProgress: { queriesUsed: number; sourcesFetched: number; elapsedMs: number } | null;
  isQueueModalOpen: boolean;
  isReviewDrawerOpen: boolean;

  fetchResearchGaps: () => Promise<void>;
  startResearchTask: (question: string, gapId?: string) => Promise<void>;
  importAcceptedUpdates: (
    proposalId: string,
    acceptedEntityIds: string[],
    acceptedRelationIds: string[],
    acceptedResolutionIds: string[]
  ) => Promise<void>;
  rejectProposal: (proposalId: string) => Promise<void>;
  setQueueModalOpen: (open: boolean) => void;
  setReviewDrawerOpen: (open: boolean) => void;
  clearActiveProposal: () => void;
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
      isSettingsOpen: false,
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

      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),
      toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

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

      // Phase 4 Autonomous Research
      researchGaps: [],
      activeProposal: null,
      isResearching: false,
      researchProgress: null,
      isQueueModalOpen: false,
      isReviewDrawerOpen: false,

      fetchResearchGaps: async () => {
        try {
          const res = await fetch('/api/research/gaps');
          if (res.ok) {
            const data = await res.json();
            set({ researchGaps: data.gaps || [] });
          }
        } catch {
          // ignore error
        }
      },

      startResearchTask: async (question: string, gapId?: string) => {
        set({
          isResearching: true,
          researchProgress: { queriesUsed: 1, sourcesFetched: 0, elapsedMs: 0 },
        });

        const startTime = Date.now();
        const interval = setInterval(() => {
          set((state) => {
            if (!state.isResearching || !state.researchProgress) return {};
            return {
              researchProgress: {
                ...state.researchProgress,
                elapsedMs: Date.now() - startTime,
              },
            };
          });
        }, 1000);

        try {
          const res = await fetch('/api/research/investigate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, gapId }),
          });

          clearInterval(interval);

          if (res.status === 408) {
            const data = await res.json();
            set({
              isResearching: false,
              researchProgress: null,
            });
            const { addToast } = useAppStore.getState();
            addToast({
              type: 'warning',
              title: 'Insufficient Sources',
              message: data.error || 'No approved sources could be retrieved within budget.',
            });
            return;
          }

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Research task failed');
          }

          const data = await res.json();
          set({
            isResearching: false,
            researchProgress: null,
            activeProposal: data.proposal,
            isQueueModalOpen: false,
            isReviewDrawerOpen: true,
          });

          const { addToast } = useAppStore.getState();
          addToast({
            type: 'success',
            title: 'Research Completed',
            message: `Retrieved ${data.proposal?.report?.sources?.length || 0} source(s). Review proposed updates.`,
          });
        } catch (err: any) {
          clearInterval(interval);
          set({ isResearching: false, researchProgress: null });
          const { addToast } = useAppStore.getState();
          addToast({
            type: 'error',
            title: 'Research Task Error',
            message: err?.message || 'Failed to complete research task',
          });
        }
      },

      importAcceptedUpdates: async (
        proposalId: string,
        acceptedEntityIds: string[],
        acceptedRelationIds: string[],
        acceptedResolutionIds: string[]
      ) => {
        try {
          const res = await fetch('/api/research/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proposalId,
              acceptedEntityTempIds: acceptedEntityIds,
              acceptedRelationTempIds: acceptedRelationIds,
              acceptedContradictionIds: acceptedResolutionIds,
            }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to import updates');
          }

          const data = await res.json();

          // Refresh documents and gaps
          const docRes = await fetch('/api/documents');
          if (docRes.ok) {
            const docs = await docRes.json();
            set({ documents: docs });
          }

          const { fetchResearchGaps, addToast } = useAppStore.getState();
          await fetchResearchGaps();

          // Refresh graph data, contradictions, and history in graphStore so canvas updates
          try {
            const { useGraphStore } = await import('./graphStore');
            const graphStore = useGraphStore.getState();
            await Promise.all([
              graphStore.fetchGraphData(),
              graphStore.fetchContradictions(),
              graphStore.fetchAuditHistory(),
            ]);
          } catch {
            // Ignore if graphStore not available
          }

          set({
            activeProposal: null,
            isReviewDrawerOpen: false,
          });

          addToast({
            type: 'success',
            title: 'Import Successful',
            message: `Imported ${data.importedEntitiesCount} concepts, ${data.importedRelationsCount} relations into knowledge base.`,
          });
        } catch (err: any) {
          const { addToast } = useAppStore.getState();
          addToast({
            type: 'error',
            title: 'Import Failed',
            message: err?.message || 'Error importing research updates',
          });
        }
      },

      rejectProposal: async (proposalId: string) => {
        try {
          await fetch('/api/research/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proposalId }),
          });
          set({
            activeProposal: null,
            isReviewDrawerOpen: false,
          });
        } catch {
          set({
            activeProposal: null,
            isReviewDrawerOpen: false,
          });
        }
      },

      setQueueModalOpen: (isQueueModalOpen) => set({ isQueueModalOpen }),
      setReviewDrawerOpen: (isReviewDrawerOpen) => set({ isReviewDrawerOpen }),
      clearActiveProposal: () => set({ activeProposal: null }),
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
