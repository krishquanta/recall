import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react';
import { RelationshipEdge } from '../../types';

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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#4f46e5' : '#94a3b8',
          strokeWidth: selected ? 2.5 : 1.5,
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
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase shadow-2xs border transition-all cursor-pointer ${
              selected
                ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-200 shadow-xs'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 hover:text-indigo-600 hover:shadow-xs'
            }`}
            title={`Relationship: ${label}\nClick to inspect source passage & provenance`}
          >
            {label}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

RelationEdge.displayName = 'RelationEdge';
