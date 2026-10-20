import React from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useAppStore } from '../../store/appStore';
import { Network, ExternalLink } from 'lucide-react';

interface RelationChipProps {
  raw: string; // e.g. "PCA -> USES -> Eigenvalues" or "PCA → USES → Eigenvalues"
  inline?: boolean;
}

export const RelationChip: React.FC<RelationChipProps> = ({ raw, inline = true }) => {
  const edges = useGraphStore((state) => state.edges);
  const nodes = useGraphStore((state) => state.nodes);
  const selectEdge = useGraphStore((state) => state.selectEdge);
  const selectEntity = useGraphStore((state) => state.selectEntity);
  const showEvidence = useAppStore((state) => state.showEvidence);

  // Clean raw string (e.g., remove "🔗 " if passed)
  const cleanText = raw.replace(/^🔗\s*/, '').trim();

  // Parse Source, Relation, Target (supports ->, →, etc.)
  const parts = cleanText.split(/\s*(?:->|→)\s*/);
  const sourceName = parts[0]?.trim();
  const relationType = parts.length > 2 ? parts[1]?.trim() : undefined;
  const targetName = parts.length > 2 ? parts[2]?.trim() : parts[1]?.trim();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // 1. Try to find matching edge in graph store
    let matchedEdge = edges.find((edge) => {
      const srcNode = nodes.find((n) => n.id === edge.sourceId);
      const tgtNode = nodes.find((n) => n.id === edge.targetId);

      const srcMatch =
        sourceName &&
        srcNode &&
        (srcNode.name.toLowerCase() === sourceName.toLowerCase() ||
          srcNode.aliases.some((a) => a.toLowerCase() === sourceName.toLowerCase()));

      const tgtMatch =
        targetName &&
        tgtNode &&
        (tgtNode.name.toLowerCase() === targetName.toLowerCase() ||
          tgtNode.aliases.some((a) => a.toLowerCase() === targetName.toLowerCase()));

      const relMatch =
        !relationType || edge.relationType.toLowerCase() === relationType.toLowerCase();

      return (srcMatch && tgtMatch && relMatch) || (srcMatch && relMatch);
    });

    if (matchedEdge && matchedEdge.evidence?.exactQuote) {
      selectEdge(matchedEdge);
      showEvidence(
        matchedEdge.evidence,
        `${matchedEdge.relationType} Provenance`
      );
      return;
    }

    // 2. Try to find source entity
    const matchedNode = nodes.find(
      (n) =>
        sourceName &&
        (n.name.toLowerCase() === sourceName.toLowerCase() ||
          n.aliases.some((a) => a.toLowerCase() === sourceName.toLowerCase()))
    );

    if (matchedNode) {
      selectEntity(matchedNode);
      if (matchedNode.evidence && matchedNode.evidence.length > 0) {
        showEvidence(matchedNode.evidence[0], matchedNode.name);
        return;
      }
    }

    // 3. Fallback: Show relation evidence with clean text
    showEvidence(
      {
        exactQuote: `Graph relationship: ${cleanText}`,
        filename: 'Knowledge Graph Provenance',
      },
      cleanText
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 ${
        inline ? 'mx-1 align-baseline' : 'my-1'
      } rounded-full text-[11px] font-semibold bg-indigo-50/90 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 hover:border-indigo-300 shadow-2xs transition-all duration-150 cursor-pointer`}
      title={`Graph Relation: ${cleanText}\nClick to inspect source passage in Preview Panel`}
    >
      <Network className="w-3 h-3 text-indigo-500 flex-shrink-0" />
      <span className="font-semibold text-indigo-900">{sourceName}</span>
      {relationType ? (
        <>
          <span className="text-[9px] uppercase tracking-wider text-indigo-500 font-bold">
            → {relationType} →
          </span>
          <span className="font-semibold text-indigo-900">{targetName}</span>
        </>
      ) : targetName ? (
        <>
          <span className="text-indigo-400">→</span>
          <span className="font-semibold text-indigo-900">{targetName}</span>
        </>
      ) : null}
      <ExternalLink className="w-2.5 h-2.5 text-indigo-400 ml-0.5" />
    </button>
  );
};
