import { useState, useCallback } from 'react';
import { uploadDocument, subscribeStatusSSE } from '../api/client';
import { useAppStore } from '../store/appStore';
import { useGraphStore } from '../store/graphStore';
import { Document, ProcessingStatus } from '../types';

const ACCEPTED_EXTENSIONS = [
  // Documents & Word Processing
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
  '.pdf',
  // Presentations
  '.pptx',
  '.ppt',
  '.odp',
  // Spreadsheets & Tabular
  '.xlsx',
  '.xls',
  '.csv',
  '.tsv',
  '.ods',
  // Text, Markdown, Web & Data
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.html',
  '.htm',
  '.json',
  '.jsonl',
  '.xml',
  // Images & Handwriting OCR
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
];

export function useUpload() {
  const addDocument = useAppStore((state) => state.addDocument);
  const updateDocumentStatus = useAppStore((state) => state.updateDocumentStatus);
  const setIsUploading = useAppStore((state) => state.setIsUploading);
  const addToast = useAppStore((state) => state.addToast);

  const [isDragOver, setIsDragOver] = useState(false);

  const handleUploadFile = useCallback(
    async (file: File) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        addToast({
          type: 'warning',
          title: 'Unsupported File Format',
          message: `Supported formats: Word (DOCX/DOC), PowerPoint (PPTX/PPT), PDF, Excel/CSV, OpenDocument, RTF, Markdown, HTML, JSON, and Images.`,
        });
        return;
      }

      setIsUploading(true);

      // Optimistic temporary ID while upload initiates
      const tempId = `temp-${Date.now()}-${file.name}`;
      const isImg = file.type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.heic'].includes(ext);

      const optimisticDoc: Document = {
        docId: tempId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        isOCR: isImg,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        status: {
          stage: 'saving',
          progress: 10,
        },
      };

      addDocument(optimisticDoc);

      try {
        const uploadRes = await uploadDocument(file);
        const realDocId = uploadRes.docId;

        // Replace optimistic doc with real doc ID
        useAppStore.setState((state) => ({
          documents: state.documents.map((d) =>
            d.docId === tempId ? { ...d, docId: realDocId, status: uploadRes.status } : d
          ),
        }));

        // Subscribe to SSE for progress
        const unsubscribe = subscribeStatusSSE(
          realDocId,
          (status: ProcessingStatus) => {
            updateDocumentStatus(realDocId, status);

            if (status.stage === 'done') {
              setIsUploading(false);
              addToast({
                type: 'success',
                title: 'Processing Complete',
                message: `"${file.name}" is indexed and ready to query.`,
              });
              // Auto-refresh graph & review queue
              useGraphStore.getState().fetchGraphData();
              useGraphStore.getState().fetchReviewQueue();
              unsubscribe();
            } else if (status.stage === 'error') {
              setIsUploading(false);
              addToast({
                type: 'error',
                title: 'Processing Failed',
                message: status.error || `Error processing "${file.name}".`,
              });
              unsubscribe();
            }
          },
          (err) => {
            console.error('SSE error for doc:', realDocId, err);
            setIsUploading(false);
            updateDocumentStatus(realDocId, {
              stage: 'error',
              error: 'Connection lost during processing',
            });
            unsubscribe();
          }
        );
      } catch (err: any) {
        console.error('Upload error:', err);
        setIsUploading(false);
        updateDocumentStatus(tempId, {
          stage: 'error',
          error: err.message || 'Upload failed',
        });
        addToast({
          type: 'error',
          title: 'Upload Failed',
          message: err.message || `Failed to upload "${file.name}".`,
        });
      }
    },
    [addDocument, updateDocumentStatus, setIsUploading, addToast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach((file) => {
          handleUploadFile(file);
        });
      }
    },
    [handleUploadFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  return {
    isDragOver,
    handleUploadFile,
    handleDrop,
    handleDragOver,
    handleDragLeave,
  };
}
