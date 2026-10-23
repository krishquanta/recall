import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react';
import { RelationshipEdge } from '../../types';
import { useGraphStore } from '../../store/graphStore';
import { CheckCircle2, Edit3, AlertTriangle } from 'lucide-react';

export const RelationEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
    markerEnd,
  } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const relation = data?.edgeData as RelationshipEdge | undefined;
  const label = relation?.relationType || 'RELATED_TO';
  const status = relation?.curationStatus || 'proposed';
  const hasContradiction = relation?.hasContradiction;
  const selectEdge = useGraphStore((state) => state.selectEdge);

  // Derive dynamic stroke and style
  let strokeColor = '#94a3b8';
  let strokeWidth = 1.5;
  let strokeDasharray = undefined;

  if (hasContradiction) {
    strokeColor = '#e11d48';
    strokeWidth = 2.5;
    strokeDasharray = '5 3';
  } else if (status === 'verified') {
    strokeColor = '#059669';
    strokeWidth = 2.5;
  } else if (status === 'corrected') {
    strokeColor = '#6366f1';
    strokeWidth = 2.2;
  } else if (status === 'rejected') {
    strokeColor = '#cbd5e1';
    strokeWidth = 1.2;
    strokeDasharray = '4 4';
  } else if (status === 'proposed') {
    strokeDasharray = '4 4';
  }

  if (selected) {
    strokeColor = '#4f46e5';
    strokeWidth = 3;
    strokeDasharray = undefined;
  }

  const handleLabelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (relation) {
      selectEdge(relation);
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray,
          transition: 'stroke 0.15s ease, stroke-width 0.15s ease',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            type="button"
            onClick={handleLabelClick}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase shadow-2xs border transition-all cursor-pointer ${
              hasContradiction
                ? 'bg-rose-50 text-rose-700 border-rose-300 ring-2 ring-rose-200 animate-pulse'
                : selected
                ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-200 shadow-xs'
                : status === 'verified'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:border-emerald-500'
                : status === 'corrected'
                ? 'bg-indigo-50 text-indigo-700 border-indigo-300 hover:border-indigo-500'
                : status === 'rejected'
                ? 'bg-slate-100 text-slate-400 border-slate-200 line-through opacity-70'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 hover:text-indigo-600 hover:shadow-xs'
            }`}
            title={`Relationship: ${label} (${status})\nClick to curate or inspect source quote`}
          >
            {hasContradiction && <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />}
            {status === 'verified' && !hasContradiction && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />}
            {status === 'corrected' && !hasContradiction && <Edit3 className="w-2.5 h-2.5 text-indigo-600" />}
            <span>{label}</span>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

RelationEdge.displayName = 'RelationEdge';
