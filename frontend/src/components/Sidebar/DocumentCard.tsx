import React from 'react';
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Presentation,
  CheckCircle2,
  Clock,
  AlertCircle,
  Sparkles,
  Globe,
} from 'lucide-react';
import { Document } from '../../types';
import { DocumentContextMenu } from './DocumentContextMenu';
import { useAppStore } from '../../store/appStore';
import clsx from 'clsx';

interface DocumentCardProps {
  document: Document;
  onDelete: (docId: string, filename: string) => void;
  onReindex: (docId: string, filename: string) => void;
  onDownload: (docId: string) => void;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onDelete,
  onReindex,
  onDownload,
}) => {
  const activeDocIds = useAppStore((state) => state.activeDocIds);
  const toggleDocScope = useAppStore((state) => state.toggleDocScope);
  const setPreviewChunk = useAppStore((state) => state.setPreviewChunk);

  const isSelected = activeDocIds.includes(document.docId);
  const isOCR = document.isOCR || document.status.stage === 'ocr';

  // Determine file icon based on extension and mimeType
  const ext = document.filename.split('.').pop()?.toLowerCase() || '';
  let FileIcon = FileText;
  let iconColor = 'text-indigo-600 bg-indigo-50';

  if (document.sourceType === 'web') {
    FileIcon = Globe;
    iconColor = 'text-sky-600 bg-sky-50';
  } else if (ext === 'pdf') {
    FileIcon = FileText;
    iconColor = 'text-rose-600 bg-rose-50';
  } else if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) {
    FileIcon = FileText;
    iconColor = 'text-blue-600 bg-blue-50';
  } else if (['pptx', 'ppt', 'odp'].includes(ext)) {
    FileIcon = Presentation;
    iconColor = 'text-amber-600 bg-amber-50';
  } else if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) {
    FileIcon = FileSpreadsheet;
    iconColor = 'text-emerald-600 bg-emerald-50';
  } else if (['html', 'htm', 'json', 'jsonl', 'xml'].includes(ext)) {
    FileIcon = FileCode;
    iconColor = 'text-cyan-600 bg-cyan-50';
  } else if (['md', 'markdown', 'txt', 'text'].includes(ext)) {
    FileIcon = FileCode;
    iconColor = 'text-slate-600 bg-slate-100';
  } else if (['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext)) {
    FileIcon = ImageIcon;
    iconColor = 'text-purple-600 bg-purple-50';
  }

  // Quick preview click
  const handleCardClick = () => {
    // If ready, open in preview
    if (document.status.stage === 'done') {
      setPreviewChunk({
        chunkId: `${document.docId}-root`,
        text: '',
        metadata: {
          docId: document.docId,
          filename: document.filename,
          mimeType: document.mimeType,
          chunkIndex: 0,
          isOCR: document.isOCR,
        },
      });
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleDocScope(document.docId);
  };

  const stage = document.status.stage;
  const progress = Math.min(100, Math.max(0, document.status.progress || 0));

  return (
    <div
      onClick={handleCardClick}
      className={clsx(
        'group relative p-3 rounded-xl border transition-all duration-200 cursor-pointer select-none',
        isSelected
          ? 'bg-indigo-50/70 border-indigo-300 ring-1 ring-indigo-200 shadow-xs'
          : 'bg-white hover:bg-slate-50/90 border-slate-200/90 hover:border-slate-300 shadow-xs hover:shadow-sm'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* File icon with type styling */}
          <div className={clsx('p-2 rounded-lg flex-shrink-0 transition-transform group-hover:scale-105', iconColor)}>
            <FileIcon className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <h4
              className="text-xs font-semibold text-slate-800 truncate"
              title={document.filename}
            >
              {document.filename}
            </h4>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400">
              <span>{formatFileSize(document.size)}</span>
              <span>•</span>
              <span>{formatDate(document.uploadedAt)}</span>
            </div>
          </div>
        </div>

        {/* Action Menu */}
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={handleCheckboxClick}
            title={isSelected ? 'Remove from query scope' : 'Scope queries to this document'}
            className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
          />
          <DocumentContextMenu
            docId={document.docId}
            filename={document.filename}
            onDelete={onDelete}
            onReindex={onReindex}
            onDownload={onDownload}
          />
        </div>
      </div>

      {/* Badges and Status row */}
      <div className="mt-2.5 flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Status Chip */}
          {stage === 'done' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              ready
            </span>
          )}

          {stage === 'error' && (
            <div
              className="group/tooltip relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 cursor-help"
            >
              <AlertCircle className="w-3 h-3 text-rose-600" />
              <span>error</span>
              {document.status.error && (
                <div className="absolute left-0 bottom-full mb-1 hidden group-hover/tooltip:block z-40 w-48 p-2 text-[10px] font-normal bg-slate-900 text-white rounded-md shadow-lg pointer-events-none">
                  {document.status.error}
                </div>
              )}
            </div>
          )}

          {stage !== 'done' && stage !== 'error' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
              <Clock className="w-3 h-3 animate-spin text-amber-600" />
              <span className="capitalize">{stage}</span>
              <span className="text-amber-800 font-semibold">{progress}%</span>
            </span>
          )}

          {/* OCR Badge */}
          {isOCR && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 shadow-xs"
              title="Processed with Gemini Vision OCR"
            >
              <Sparkles className="w-2.5 h-2.5 text-purple-600" />
              🖼 OCR
            </span>
          )}

          {/* Web Dossier Badge */}
          {document.sourceType === 'web' && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 shadow-xs"
              title={document.sourceUrl ? `Imported from ${document.sourceUrl}` : 'Web Research Dossier'}
            >
              <Globe className="w-2.5 h-2.5 text-sky-600" />
              Web Dossier
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar when processing */}
      {stage !== 'done' && stage !== 'error' && (
        <div className="w-full bg-slate-100 rounded-full h-1 mt-2 overflow-hidden">
          <div
            className="bg-amber-500 h-1 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};
