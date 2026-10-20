import React, { useMemo } from 'react';
import katex from 'katex';
import { Citation } from '../../types';
import { CitationChip } from './CitationChip';
import { RelationChip } from './RelationChip';

interface MathContentProps {
  content: string;
  citations?: Citation[];
  className?: string;
}

/**
 * Safely renders LaTeX math using KaTeX
 */
function renderKatex(math: string, displayMode: boolean): string {
  try {
    return katex.renderToString(math.trim(), {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    });
  } catch (err) {
    console.warn('KaTeX rendering error:', err);
    return `<span class="font-mono text-red-500">${math}</span>`;
  }
}

/**
 * Clean up raw base64 data URIs from Word/MathType preview images
 */
function sanitizeContent(text: string): string {
  if (!text) return '';
  return text
    // Replace markdown base64 images (like MathType WMF/EMF preview images) with clean tags
    .replace(/!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]+\)/gi, (_match, alt) => {
      const cleanAlt = alt?.replace(/\\-/g, '-').trim();
      return cleanAlt ? `*[Formula: ${cleanAlt}]*` : '*[Formula]*';
    })
    // Replace raw standalone data:image/... base64 URLs
    .replace(/data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]{20,}/gi, '[Embedded Formula]');
}

export const MathContent: React.FC<MathContentProps> = ({
  content,
  citations = [],
  className = '',
}) => {
  const renderedElements = useMemo(() => {
    const sanitized = sanitizeContent(content);
    const paragraphs = sanitized.split(/\n\s*\n/);

    return paragraphs.map((paragraph, pIdx) => {
      const lines = paragraph.split('\n');

      return (
        <div key={`p-${pIdx}`} className={pIdx > 0 ? 'mt-3' : ''}>
          {lines.map((line, lineIdx) => {
            const trimmed = line.trim();

            // 1. Check for standalone block math: $$ math $$ or \[ math \]
            const blockMathMatch = trimmed.match(/^(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])$/);
            if (blockMathMatch) {
              const mathCode = blockMathMatch[2];
              const html = renderKatex(mathCode, true);
              return (
                <div
                  key={`line-${lineIdx}-blockmath`}
                  className="my-3 overflow-x-auto py-2 px-3 bg-slate-50/80 rounded-lg border border-slate-100 flex justify-center text-slate-900"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }

            // 2. Check for LaTeX environments: \begin{pmatrix} ... \end{pmatrix}, \begin{matrix}, \begin{align}
            if (trimmed.startsWith('\\begin{') && trimmed.endsWith('}')) {
              const html = renderKatex(trimmed, true);
              return (
                <div
                  key={`line-${lineIdx}-envmath`}
                  className="my-3 overflow-x-auto py-2 px-3 bg-slate-50/80 rounded-lg border border-slate-100 flex justify-center text-slate-900"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }

            // 3. Parse inline formatting: math ($...$ or \(...\)), citation chips ([1]), relation chips ([🔗 ...]), bold, code, and text
            const nodes = parseInlineMathAndCitations(line, citations, pIdx, lineIdx);

            // Handle list bullets
            const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
            const isNumbered = /^\d+\.\s/.test(trimmed);

            return (
              <p
                key={`line-${lineIdx}`}
                className={`leading-relaxed ${
                  isBullet || isNumbered ? 'pl-4 relative' : ''
                } ${lineIdx > 0 ? 'mt-1.5' : ''}`}
              >
                {nodes}
              </p>
            );
          })}
        </div>
      );
    });
  }, [content, citations]);

  return <div className={`math-content text-slate-800 text-sm ${className}`}>{renderedElements}</div>;
};

/**
 * Tokenizes and parses a single line into Math, Citations, Relation Chips, Code, and Text
 */
function parseInlineMathAndCitations(
  line: string,
  citations: Citation[],
  pIdx: number,
  lineIdx: number
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  // Regex tokens:
  // 1. Block math inside line: \$\$([\s\S]+?)\$\$
  // 2. Inline math: \$([^\$]+?)\$ or \\\(([\s\S]+?\\\)
  // 3. Direct LaTeX commands like \vec{v}, \nabla, \alpha
  // 4. Matrix environments
  // 5. Graph relation chips: \[🔗([^\]]+)\]
  // 6. Citation tags: \[(\d+)\]
  // 7. Inline code: `([^`]+)`
  // 8. Bold: \*\*([^\*]+)\*\*
  const tokenRegex =
    /(\$\$[\s\S]+?\$\$|\$[^\$]+?\$|\\\([\s\S]+?\\\)|\b\\(?:vec|mathbf|hat)\{[A-Za-z0-9_]+\}|\b\\(?:nabla|partial|times|cdot|pm|mp|approx|leq|geq|neq|infty|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|Delta|Sigma|Omega)\b|\\begin\{(?:pmatrix|bmatrix|matrix|vmatrix)\}[\s\S]+?\\end\{(?:pmatrix|bmatrix|matrix|vmatrix)\}|\[🔗\s*[^\]]+\]|\[(\d+)\]|`([^`]+)`|\*\*([^\*]+)\*\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];

    // Push preceding plain text
    if (matchStart > lastIndex) {
      nodes.push(line.slice(lastIndex, matchStart));
    }

    if (matchText.startsWith('$$') && matchText.endsWith('$$')) {
      // Block math
      const math = matchText.slice(2, -2);
      const html = renderKatex(math, true);
      nodes.push(
        <span
          key={`m-block-${pIdx}-${lineIdx}-${matchStart}`}
          className="inline-block my-1 px-1 overflow-x-auto align-middle"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (matchText.startsWith('$') && matchText.endsWith('$') && matchText.length > 2) {
      // Inline math: $...$
      const math = matchText.slice(1, -1);
      const html = renderKatex(math, false);
      nodes.push(
        <span
          key={`m-inline-${pIdx}-${lineIdx}-${matchStart}`}
          className="inline-math mx-0.5 align-baseline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (matchText.startsWith('\\(') && matchText.endsWith('\\)')) {
      // Inline math: \(...\)
      const math = matchText.slice(2, -2);
      const html = renderKatex(math, false);
      nodes.push(
        <span
          key={`m-inline-paren-${pIdx}-${lineIdx}-${matchStart}`}
          className="inline-math mx-0.5 align-baseline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (matchText.startsWith('\\begin{')) {
      // Matrix or environment
      const html = renderKatex(matchText, false);
      nodes.push(
        <span
          key={`m-env-${pIdx}-${lineIdx}-${matchStart}`}
          className="inline-block mx-1 align-middle"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (matchText.startsWith('\\')) {
      // Direct LaTeX command like \vec{v} or \nabla
      const html = renderKatex(matchText, false);
      nodes.push(
        <span
          key={`m-cmd-${pIdx}-${lineIdx}-${matchStart}`}
          className="inline-math mx-0.5 align-baseline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (matchText.startsWith('[🔗') && matchText.endsWith(']')) {
      // Graph relation chip: [🔗 Source -> RELATION -> Target]
      const rawRel = matchText.slice(1, -1);
      nodes.push(
        <RelationChip
          key={`rel-${pIdx}-${lineIdx}-${matchStart}`}
          raw={rawRel}
          inline={true}
        />
      );
    } else if (matchText.startsWith('[') && matchText.endsWith(']') && /^\d+$/.test(matchText.slice(1, -1))) {
      // Citation chip: [N]
      const citationIndex = parseInt(matchText.slice(1, -1), 10);
      const citation = citations.find((c) => c.index === citationIndex);

      if (citation) {
        nodes.push(
          <CitationChip
            key={`cite-${pIdx}-${lineIdx}-${citationIndex}-${matchStart}`}
            citation={citation}
            inline={true}
          />
        );
      } else {
        nodes.push(matchText);
      }
    } else if (matchText.startsWith('`') && matchText.endsWith('`')) {
      // Inline code
      const code = matchText.slice(1, -1);
      nodes.push(
        <code
          key={`code-${pIdx}-${lineIdx}-${matchStart}`}
          className="px-1.5 py-0.5 bg-slate-100 text-indigo-700 font-mono text-xs rounded border border-slate-200"
        >
          {code}
        </code>
      );
    } else if (matchText.startsWith('**') && matchText.endsWith('**')) {
      // Bold
      const bold = matchText.slice(2, -2);
      nodes.push(<strong key={`bold-${pIdx}-${lineIdx}-${matchStart}`}>{bold}</strong>);
    } else {
      nodes.push(matchText);
    }

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [' '];
}
