import { create } from 'zustand';
import {
  EntityNode,
  RelationshipEdge,
  ClaimNode,
  ReviewQueueItem,
  EntityType,
  GraphData,
} from '../types';
import { fetchGraph, fetchReviewQueue, resolveReviewItem } from '../api/client';
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
    } catch (err: any) {
      console.error('Failed to fetch graph data:', err);
      set({ isLoading: false });
    }
  },

  fetchReviewQueue: async () => {
    try {
      const items = await fetchReviewQueue();
      // Keep only pending items
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

      // Remove the item from current review queue
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

      // Refetch the active graph to sync changes
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
}));
