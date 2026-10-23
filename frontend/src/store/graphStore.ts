import { create } from 'zustand';
import {
  EntityNode,
  RelationshipEdge,
  ClaimNode,
  ReviewQueueItem,
  EntityType,
  GraphData,
  ContradictionAlert,
  ContradictionResolution,
  AuditLogEntry,
  RelationType,
} from '../types';
import {
  fetchGraph,
  fetchReviewQueue,
  resolveReviewItem,
  curateEdge,
  fetchContradictions,
  resolveContradiction,
  fetchAuditLog,
  rollbackAudit,
} from '../api/client';
import { useAppStore } from './appStore';

interface GraphState {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  claims: ClaimNode[];
  reviewQueue: ReviewQueueItem[];
  selectedEntity: EntityNode | null;
  selectedEdge: RelationshipEdge | null;
  filterType: EntityType | 'all';
  searchQuery: string;
  isLoading: boolean;
  isReviewModalOpen: boolean;

  // Phase 3: Curation, Contradictions, and History state
  contradictions: ContradictionAlert[];
  isContradictionDrawerOpen: boolean;
  selectedContradiction: ContradictionAlert | null;
  curatingEdge: RelationshipEdge | null;
  isCorrectModalOpen: boolean;
  auditEntries: AuditLogEntry[];
  isHistoryModalOpen: boolean;

  setGraphData: (data: GraphData) => void;
  selectEntity: (entity: EntityNode | null) => void;
  selectEdge: (edge: RelationshipEdge | null) => void;
  setFilterType: (filter: EntityType | 'all') => void;
  setSearchQuery: (query: string) => void;
  fetchGraphData: (docIds?: string[]) => Promise<void>;
  fetchReviewQueue: () => Promise<void>;
  resolveQueueItem: (
    id: string,
    action: 'merge' | 'separate' | 'redirect',
    targetEntityId?: string
  ) => Promise<void>;
  openReviewModal: () => void;
  closeReviewModal: () => void;

  // Phase 3: Actions
  fetchContradictions: () => Promise<void>;
  resolveContradictionAlert: (
    id: string,
    resolution: ContradictionResolution,
    note?: string
  ) => Promise<void>;
  openContradictionDrawer: (alert?: ContradictionAlert) => void;
  closeContradictionDrawer: () => void;

  curateRelationship: (
    edgeId: string,
    params: {
      action: 'accept' | 'reject' | 'correct';
      relationType?: RelationType;
      invertDirection?: boolean;
      description?: string;
      reason?: string;
    }
  ) => Promise<void>;
  openCorrectModal: (edge: RelationshipEdge) => void;
  closeCorrectModal: () => void;

  fetchAuditHistory: () => Promise<void>;
  rollbackAuditEntry: (auditId: string, reason?: string) => Promise<void>;
  openHistoryModal: () => void;
  closeHistoryModal: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  claims: [],
  reviewQueue: [],
  selectedEntity: null,
  selectedEdge: null,
  filterType: 'all',
  searchQuery: '',
  isLoading: false,
  isReviewModalOpen: false,

  contradictions: [],
  isContradictionDrawerOpen: false,
  selectedContradiction: null,
  curatingEdge: null,
  isCorrectModalOpen: false,
  auditEntries: [],
  isHistoryModalOpen: false,

  setGraphData: (data: GraphData) =>
    set({
      nodes: data.nodes || [],
      edges: data.edges || [],
      claims: data.claims || [],
    }),

  selectEntity: (entity) =>
    set({
      selectedEntity: entity,
      selectedEdge: null,
    }),

  selectEdge: (edge) =>
    set({
      selectedEdge: edge,
      selectedEntity: null,
      curatingEdge: edge,
    }),

  setFilterType: (filterType) => set({ filterType }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  fetchGraphData: async (docIds?: string[]) => {
    set({ isLoading: true });
    try {
      const data = await fetchGraph(docIds);
      set({
        nodes: data.nodes || [],
        edges: data.edges || [],
        claims: data.claims || [],
        isLoading: false,
      });
      // Also fetch contradictions
      get().fetchContradictions();
    } catch (err: any) {
      console.error('Failed to fetch graph data:', err);
      set({ isLoading: false });
    }
  },

  fetchReviewQueue: async () => {
    try {
      const items = await fetchReviewQueue();
      const pending = items.filter((item) => item.status === 'pending');
      set({ reviewQueue: pending });
    } catch (err: any) {
      console.error('Failed to fetch review queue:', err);
    }
  },

  resolveQueueItem: async (
    id: string,
    action: 'merge' | 'separate' | 'redirect',
    targetEntityId?: string
  ) => {
    try {
      await resolveReviewItem(id, action, targetEntityId);

      const currentQueue = get().reviewQueue;
      const updatedQueue = currentQueue.filter((item) => item.id !== id);
      set({ reviewQueue: updatedQueue });

      if (updatedQueue.length === 0) {
        set({ isReviewModalOpen: false });
      }

      useAppStore.getState().addToast({
        type: 'success',
        title: action === 'merge' ? 'Entity Merged' : 'Entity Kept Separate',
        message:
          action === 'merge'
            ? 'Entity aliases and incident edges consolidated successfully.'
            : 'Entity registered as an independent node in the knowledge graph.',
      });

      await get().fetchGraphData();
    } catch (err: any) {
      console.error('Failed to resolve review item:', err);
      useAppStore.getState().addToast({
        type: 'error',
        title: 'Action Failed',
        message: err.message || 'Could not resolve duplicate entity match.',
      });
    }
  },

  openReviewModal: () => set({ isReviewModalOpen: true }),
  closeReviewModal: () => set({ isReviewModalOpen: false }),

  // Phase 3 Actions
  fetchContradictions: async () => {
    try {
      const data = await fetchContradictions('active');
      set({ contradictions: data.alerts || [] });
    } catch (err: any) {
      console.error('Failed to fetch contradictions:', err);
    }
  },

  resolveContradictionAlert: async (
    id: string,
    resolution: ContradictionResolution,
    note?: string
  ) => {
    try {
      await resolveContradiction(id, resolution, note);

      const current = get().contradictions;
      set({ contradictions: current.filter((c) => c.id !== id) });

      useAppStore.getState().addToast({
        type: 'success',
        title: 'Contradiction Resolved',
        message: `Resolution recorded: ${resolution.replace(/_/g, ' ')}`,
      });

      await get().fetchGraphData();
    } catch (err: any) {
      console.error('Failed to resolve contradiction:', err);
      useAppStore.getState().addToast({
        type: 'error',
        title: 'Resolution Failed',
        message: err.message || 'Could not resolve contradiction.',
      });
    }
  },

  openContradictionDrawer: (alert?: ContradictionAlert) =>
    set({
      isContradictionDrawerOpen: true,
      selectedContradiction: alert || get().contradictions[0] || null,
    }),

  closeContradictionDrawer: () =>
    set({ isContradictionDrawerOpen: false, selectedContradiction: null }),

  curateRelationship: async (
    edgeId: string,
    params: {
      action: 'accept' | 'reject' | 'correct';
      relationType?: RelationType;
      invertDirection?: boolean;
      description?: string;
      reason?: string;
    }
  ) => {
    try {
      const res = await curateEdge(edgeId, params);

      // Update edge in local state immediately
      const updatedEdges = get().edges.map((e) =>
        e.id === edgeId ? { ...e, ...res.edge } : e
      );
      set({ edges: updatedEdges, curatingEdge: res.edge });

      useAppStore.getState().addToast({
        type: 'success',
        title:
          params.action === 'accept'
            ? 'Relationship Verified'
            : params.action === 'reject'
            ? 'Relationship Rejected'
            : 'Relationship Corrected',
        message: `Relationship updated successfully.`,
      });

      await get().fetchGraphData();
    } catch (err: any) {
      console.error('Failed to curate relationship:', err);
      useAppStore.getState().addToast({
        type: 'error',
        title: 'Curation Failed',
        message: err.message || 'Could not curate relationship.',
      });
    }
  },

  openCorrectModal: (edge: RelationshipEdge) =>
    set({ isCorrectModalOpen: true, curatingEdge: edge }),

  closeCorrectModal: () => set({ isCorrectModalOpen: false }),

  fetchAuditHistory: async () => {
    try {
      const res = await fetchAuditLog(100);
      set({ auditEntries: res.entries || [] });
    } catch (err: any) {
      console.error('Failed to fetch audit log:', err);
    }
  },

  rollbackAuditEntry: async (auditId: string, reason?: string) => {
    try {
      await rollbackAudit(auditId, reason);

      useAppStore.getState().addToast({
        type: 'success',
        title: 'Action Reverted',
        message: 'Prior knowledge graph state has been restored.',
      });

      await Promise.all([get().fetchGraphData(), get().fetchAuditHistory()]);
    } catch (err: any) {
      console.error('Failed to rollback audit entry:', err);
      useAppStore.getState().addToast({
        type: 'error',
        title: 'Rollback Failed',
        message: err.message || 'Could not revert this action.',
      });
    }
  },

  openHistoryModal: () => {
    get().fetchAuditHistory();
    set({ isHistoryModalOpen: true });
  },

  closeHistoryModal: () => set({ isHistoryModalOpen: false }),
}));
