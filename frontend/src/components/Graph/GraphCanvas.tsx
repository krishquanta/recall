import React, { useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  MarkerType,
  Node,
  Edge,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useGraphStore } from '../../store/graphStore';
import { useAppStore } from '../../store/appStore';
import { GraphNodeCard, EntityCustomNode } from './GraphNodeCard';
import { RelationEdge } from './RelationEdge';
import { RelationCurationPopover } from './RelationCurationPopover';
import {
  EntityType,
  EntityNode,
  RelationshipEdge,
} from '../../types';
import { reindexGraph } from '../../api/client';
import {
  Search,
  Filter,
  RefreshCw,
  Network,
  Sparkles,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';

const nodeTypes = {
  entity: GraphNodeCard,
};

const edgeTypes = {
  relation: RelationEdge,
};

const ENTITY_TYPES: Array<EntityType | 'all'> = [
  'all',
  'Concept',
  'Method',
  'Formula',
  'Theorem',
  'Property',
  'Dataset',
  'Person',
];

/**
 * Arrange nodes in an aesthetic concentric/circular layout
 */
function layoutNodes(
  entities: EntityNode[],
  edges: RelationshipEdge[]
): EntityCustomNode[] {
  const count = entities.length;
  if (count === 0) return [];

  // Calculate degrees to place highly connected nodes toward center
  const degreeMap = new Map<string, number>();
  entities.forEach((e) => degreeMap.set(e.id, 0));
  edges.forEach((e) => {
    degreeMap.set(e.sourceId, (degreeMap.get(e.sourceId) || 0) + 1);
    degreeMap.set(e.targetId, (degreeMap.get(e.targetId) || 0) + 1);
  });

  // Sort descending by degree
  const sorted = [...entities].sort(
    (a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0)
  );

  const centerX = 500;
  const centerY = 350;

  if (count <= 8) {
    const radius = Math.max(180, count * 40);
    return sorted.map((entity, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        id: entity.id,
        type: 'entity' as const,
        position: {
          x: Math.round(centerX + radius * Math.cos(angle)),
          y: Math.round(centerY + radius * Math.sin(angle)),
        },
        data: { entity },
      };
    });
  }

  // Multi-tier concentric circles
  const innerCount = Math.min(6, Math.ceil(count * 0.25));
  const middleCount = Math.min(14, Math.ceil(count * 0.45));
  const outerCount = count - innerCount - middleCount;

  return sorted.map((entity, i) => {
    let radius = 180;
    let angle = 0;

    if (i < innerCount) {
      radius = 160;
      angle = (2 * Math.PI * i) / innerCount;
    } else if (i < innerCount + middleCount) {
      const midIdx = i - innerCount;
      radius = 340;
      angle = (2 * Math.PI * midIdx) / middleCount + Math.PI / middleCount;
    } else {
      const outIdx = i - innerCount - middleCount;
      radius = 520;
      angle = (2 * Math.PI * outIdx) / Math.max(1, outerCount);
    }

    return {
      id: entity.id,
      type: 'entity' as const,
      position: {
        x: Math.round(centerX + radius * Math.cos(angle)),
        y: Math.round(centerY + radius * Math.sin(angle)),
      },
      data: { entity },
    };
  });
}

export const GraphCanvas: React.FC = () => {
  const nodesData = useGraphStore((state) => state.nodes);
  const edgesData = useGraphStore((state) => state.edges);
  const isLoading = useGraphStore((state) => state.isLoading);
  const filterType = useGraphStore((state) => state.filterType);
  const searchQuery = useGraphStore((state) => state.searchQuery);
  const selectedEntity = useGraphStore((state) => state.selectedEntity);
  const selectedEdge = useGraphStore((state) => state.selectedEdge);

  const setFilterType = useGraphStore((state) => state.setFilterType);
  const setSearchQuery = useGraphStore((state) => state.setSearchQuery);
  const selectEntity = useGraphStore((state) => state.selectEntity);
  const selectEdge = useGraphStore((state) => state.selectEdge);
  const fetchGraphData = useGraphStore((state) => state.fetchGraphData);

  const showEvidence = useAppStore((state) => state.showEvidence);
  const activeDocIds = useAppStore((state) => state.activeDocIds);
  const addToast = useAppStore((state) => state.addToast);

  const [nodes, setNodes, onNodesChange] = useNodesState<EntityCustomNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Fetch initial graph data
  useEffect(() => {
    fetchGraphData(activeDocIds.length > 0 ? activeDocIds : undefined);
  }, [fetchGraphData, activeDocIds]);

  // Filter nodes & edges according to search query, entity type, and active documents
  const filteredEntities = useMemo(() => {
    return nodesData.filter((entity) => {
      // Type filter
      if (filterType !== 'all' && entity.type !== filterType) {
        return false;
      }

      // Search query filter (matches name or aliases)
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = entity.name.toLowerCase().includes(q);
        const matchesAlias = entity.aliases?.some((a) =>
          a.toLowerCase().includes(q)
        );
        if (!matchesName && !matchesAlias) return false;
      }

      // Doc filter if doc scope is active
      if (activeDocIds.length > 0 && entity.evidence && entity.evidence.length > 0) {
        const belongsToScope = entity.evidence.some(
          (ev) => ev.docId && activeDocIds.includes(ev.docId)
        );
        if (!belongsToScope) return false;
      }

      return true;
    });
  }, [nodesData, filterType, searchQuery, activeDocIds]);

  const visibleEntityIdSet = useMemo(() => {
    return new Set(filteredEntities.map((e) => e.id));
  }, [filteredEntities]);

  const filteredEdges = useMemo(() => {
    return edgesData.filter(
      (edge) =>
        visibleEntityIdSet.has(edge.sourceId) &&
        visibleEntityIdSet.has(edge.targetId)
    );
  }, [edgesData, visibleEntityIdSet]);

  // Sync ReactFlow nodes & edges whenever filtered entities/edges or selection change
  useEffect(() => {
    const layoutedNodes = layoutNodes(filteredEntities, filteredEdges);
    const flowNodes: EntityCustomNode[] = layoutedNodes.map((n) => ({
      ...n,
      type: 'entity' as const,
      selected: selectedEntity?.id === n.id,
    }));

    const flowEdges: Edge[] = filteredEdges.map((edge) => {
      const isSelected = selectedEdge?.id === edge.id;
      return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: 'relation',
        selected: isSelected,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? '#4f46e5' : '#94a3b8',
          width: 14,
          height: 14,
        },
        data: {
          edgeData: edge,
        },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [
    filteredEntities,
    filteredEdges,
    selectedEntity,
    selectedEdge,
    setNodes,
    setEdges,
  ]);

  // Node click handler -> Open Evidence Preview in right panel
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const entity = (node.data as any)?.entity as EntityNode | undefined;
      if (!entity) return;

      selectEntity(entity);

      if (entity.evidence && entity.evidence.length > 0) {
        showEvidence(entity.evidence[0], entity.name);
      } else {
        // Fallback evidence if entity has description
        showEvidence(
          {
            exactQuote: entity.description || entity.name,
            filename: 'Knowledge Graph Reference',
          },
          entity.name
        );
      }
    },
    [selectEntity, showEvidence]
  );

  // Edge click handler -> Open Exact Relationship Provenance in right panel
  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const relation = (edge.data as any)?.edgeData as RelationshipEdge | undefined;
      if (!relation) return;

      selectEdge(relation);

      if (relation.evidence && relation.evidence.exactQuote) {
        showEvidence(
          relation.evidence,
          `${relation.relationType} Relationship Evidence`
        );
      } else {
        showEvidence(
          {
            exactQuote:
              relation.description ||
              `Relationship [${relation.relationType}] between graph concepts.`,
            filename: 'Relationship Provenance',
          },
          relation.relationType
        );
      }
    },
    [selectEdge, showEvidence]
  );

  // Trigger re-indexing
  const handleReindex = async () => {
    try {
      addToast({
        type: 'info',
        title: 'Extracting Knowledge Graph',
        message: 'Analyzing documents for concepts and relationships...',
      });
      await reindexGraph();
      await fetchGraphData();
      addToast({
        type: 'success',
        title: 'Graph Refreshed',
        message: 'Knowledge graph extracted successfully.',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Re-index Failed',
        message: err.message || 'Could not extract graph relationships.',
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-hidden">
      {/* Top Controls & Filter Panel */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 flex-shrink-0 z-10 shadow-2xs">
        {/* Search bar & Type Filter */}
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-xl">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search concepts, methods, formulas, aliases..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white text-slate-800 placeholder-slate-400 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600 bg-slate-200 rounded-full w-4 h-4 flex items-center justify-center"
              >
                ×
              </button>
            )}
          </div>

          {/* Type Filter Dropdown */}
          <div className="relative flex items-center">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="pl-7 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 font-medium cursor-pointer"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'all' ? 'All Types' : t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats & Actions */}
        <div className="flex items-center gap-2 text-xs">
          <div className="hidden sm:flex items-center gap-2 text-slate-500 font-medium">
            <span className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-md border border-slate-200/80">
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              <span>{filteredEntities.length}</span>
              <span className="text-[10px] text-slate-400">nodes</span>
            </span>

            <span className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-md border border-slate-200/80">
              <Network className="w-3.5 h-3.5 text-slate-400" />
              <span>{filteredEdges.length}</span>
              <span className="text-[10px] text-slate-400">edges</span>
            </span>
          </div>

          <button
            type="button"
            onClick={handleReindex}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg font-medium transition-colors disabled:opacity-50"
            title="Re-run graph extraction on documents"
          >
            <RefreshCw
              className={clsx('w-3.5 h-3.5', isLoading && 'animate-spin')}
            />
            <span className="hidden sm:inline">Re-index</span>
          </button>
        </div>
      </div>

      {/* Main Canvas View */}
      {filteredEntities.length === 0 && !isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-4 text-indigo-600 shadow-xs">
            <Network className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">
            No Knowledge Graph Extracted Yet
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mb-5 leading-relaxed">
            Upload course materials, textbooks, or slides in the sidebar, or
            click Re-index to extract interconnected concepts, theorems, and
            provenance.
          </p>
          <button
            type="button"
            onClick={handleReindex}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Knowledge Graph</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 relative w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            connectionLineType={ConnectionLineType.Bezier}
            fitView
            minZoom={0.2}
            maxZoom={2.0}
            attributionPosition="bottom-left"
          >
            <Background color="#cbd5e1" gap={18} size={1} />
            <Controls
              position="bottom-left"
              className="!bg-white !border-slate-200 !shadow-sm !rounded-lg overflow-hidden"
              showInteractive={false}
            />
            <MiniMap
              position="bottom-right"
              zoomable
              pannable
              nodeColor={(node: any) => {
                const type = node.data?.entity?.type;
                switch (type) {
                  case 'Method':
                    return '#0d9488';
                  case 'Formula':
                    return '#f59e0b';
                  case 'Theorem':
                    return '#10b981';
                  case 'Property':
                    return '#a855f7';
                  case 'Dataset':
                    return '#f43f5e';
                  case 'Person':
                    return '#3b82f6';
                  default:
                    return '#6366f1';
                }
              }}
              className="!bg-white/90 !border-slate-200 !shadow-sm !rounded-lg"
            />

            {/* Quick Helper Panel */}
            <Panel position="top-right" className="!m-3">
              <div className="bg-white/90 backdrop-blur-xs border border-slate-200 rounded-lg p-2.5 text-[11px] text-slate-500 shadow-xs max-w-xs space-y-1">
                <div className="font-semibold text-slate-700 flex items-center gap-1">
                  <span>💡 Provenance Inspection</span>
                </div>
                <p>
                  Click any concept node or relation badge to snap open the
                  original verbatim citation in the Source Preview panel.
                </p>
              </div>
            </Panel>
          </ReactFlow>

          {/* Relation Curation Popover */}
          {selectedEdge && <RelationCurationPopover />}
        </div>
      )}
    </div>
  );
};
