import React, { memo } from 'react';
import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import {
  EntityNode,
  EntityType,
} from '../../types';
import {
  Sparkles,
  Cpu,
  Calculator,
  GraduationCap,
  Tag,
  Database,
  User,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';

export type EntityCustomNode = Node<{
  entity: EntityNode;
  isSelected?: boolean;
}, 'entity'>;

const TYPE_STYLES: Record<
  EntityType,
  {
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    badgeText: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  Concept: {
    bg: 'bg-indigo-50/90',
    border: 'border-indigo-200',
    text: 'text-indigo-950',
    badgeBg: 'bg-indigo-100/90',
    badgeText: 'text-indigo-800',
    icon: Sparkles,
  },
  Method: {
    bg: 'bg-teal-50/90',
    border: 'border-teal-200',
    text: 'text-teal-950',
    badgeBg: 'bg-teal-100/90',
    badgeText: 'text-teal-800',
    icon: Cpu,
  },
  Formula: {
    bg: 'bg-amber-50/90',
    border: 'border-amber-200',
    text: 'text-amber-950',
    badgeBg: 'bg-amber-100/90',
    badgeText: 'text-amber-800',
    icon: Calculator,
  },
  Theorem: {
    bg: 'bg-emerald-50/90',
    border: 'border-emerald-200',
    text: 'text-emerald-950',
    badgeBg: 'bg-emerald-100/90',
    badgeText: 'text-emerald-800',
    icon: GraduationCap,
  },
  Property: {
    bg: 'bg-purple-50/90',
    border: 'border-purple-200',
    text: 'text-purple-950',
    badgeBg: 'bg-purple-100/90',
    badgeText: 'text-purple-800',
    icon: Tag,
  },
  Dataset: {
    bg: 'bg-rose-50/90',
    border: 'border-rose-200',
    text: 'text-rose-950',
    badgeBg: 'bg-rose-100/90',
    badgeText: 'text-rose-800',
    icon: Database,
  },
  Person: {
    bg: 'bg-blue-50/90',
    border: 'border-blue-200',
    text: 'text-blue-950',
    badgeBg: 'bg-blue-100/90',
    badgeText: 'text-blue-800',
    icon: User,
  },
};

export const GraphNodeCard = memo((props: NodeProps<EntityCustomNode>) => {
  const { data, selected } = props;
  const entity = data.entity;

  if (!entity) return null;

  const styleConfig = TYPE_STYLES[entity.type] || TYPE_STYLES.Concept;
  const Icon = styleConfig.icon;
  const isPendingReview = entity.status === 'pending_review';
  const aliases = entity.aliases || [];

  return (
    <div
      className={clsx(
        'relative px-3.5 py-2.5 rounded-xl border transition-all duration-150 min-w-[160px] max-w-[240px] shadow-sm select-none',
        styleConfig.bg,
        isPendingReview
          ? 'border-dashed border-amber-400 ring-2 ring-amber-300/60 bg-amber-50/80'
          : styleConfig.border,
        selected && 'ring-2 ring-indigo-500 shadow-md scale-[1.02]'
      )}
    >
      {/* React Flow Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-slate-300 hover:!bg-indigo-500 !border-white transition-colors"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-slate-300 hover:!bg-indigo-500 !border-white transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-slate-300 hover:!bg-indigo-500 !border-white transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-slate-300 hover:!bg-indigo-500 !border-white transition-colors"
      />

      {/* Top row: Type Icon/Pill + Unreviewed Status */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider',
            styleConfig.badgeBg,
            styleConfig.badgeText
          )}
        >
          <Icon className="w-2.5 h-2.5" />
          <span>{entity.type}</span>
        </span>

        {isPendingReview && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-200 text-amber-900 border border-amber-300 shadow-2xs"
            title="Uncertain candidate match waiting for human review"
          >
            <AlertTriangle className="w-2.5 h-2.5 text-amber-700" />
            <span>Unreviewed</span>
          </span>
        )}
      </div>

      {/* Entity Canonical Name */}
      <div
        className={clsx(
          'text-xs font-bold leading-snug line-clamp-2 break-words',
          styleConfig.text
        )}
        title={entity.name}
      >
        {entity.name}
      </div>

      {/* Aliases badge */}
      {aliases.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
          <span
            className="text-[9px] font-medium text-slate-500 bg-white/70 px-1.5 py-0.2 rounded border border-slate-200/60 truncate max-w-[190px]"
            title={`Aliases: ${aliases.join(', ')}`}
          >
            aka: {aliases[0]}
            {aliases.length > 1 ? ` (+${aliases.length - 1})` : ''}
          </span>
        </div>
      )}
    </div>
  );
});

GraphNodeCard.displayName = 'GraphNodeCard';
