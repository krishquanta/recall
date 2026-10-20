import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Download, RefreshCw, Trash2, AlertCircle } from 'lucide-react';

interface DocumentContextMenuProps {
  docId: string;
  filename: string;
  onDelete: (docId: string, filename: string) => void;
  onReindex: (docId: string, filename: string) => void;
  onDownload: (docId: string) => void;
}

export const DocumentContextMenu: React.FC<DocumentContextMenuProps> = ({
  docId,
  filename,
  onDelete,
  onReindex,
  onDownload,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(true);
    setIsOpen(false);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(false);
    onDelete(docId, filename);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirmDelete(false);
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
        aria-label="Document options"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-36 rounded-lg bg-white shadow-xl border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onDownload(docId);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Download
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onReindex(docId, filename);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            Re-index
          </button>

          <div className="border-t border-slate-100 my-1" />

          <button
            onClick={handleDeleteClick}
            className="w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            Delete
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDelete && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in"
          onClick={handleCancelDelete}
        >
          <div
            className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-2 bg-rose-50 rounded-full">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">Delete Document</h3>
            </div>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-slate-800">"{filename}"</span>?
              This will remove the file and purge it from both vector and keyword search indices.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
