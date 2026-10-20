import { useEffect, useState, useCallback } from 'react';
import { getDocuments, deleteDocument, reindexDocument, getFileUrl } from '../api/client';
import { useAppStore } from '../store/appStore';

export function useDocuments() {
  const documents = useAppStore((state) => state.documents);
  const setDocuments = useAppStore((state) => state.setDocuments);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const updateDocumentStatus = useAppStore((state) => state.updateDocumentStatus);
  const addToast = useAppStore((state) => state.addToast);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const docs = await getDocuments();
      setDocuments(docs);
    } catch (err: any) {
      console.error('Failed to load documents:', err);
      setError(err.message || 'Failed to fetch documents');
      addToast({
        type: 'error',
        title: 'Document Sync Failed',
        message: err.message || 'Could not load your documents from the server.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [setDocuments, addToast]);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const handleDelete = useCallback(
    async (docId: string, filename: string) => {
      try {
        await deleteDocument(docId);
        removeDocument(docId);
        addToast({
          type: 'success',
          title: 'Document Deleted',
          message: `"${filename}" has been deleted.`,
        });
      } catch (err: any) {
        console.error('Delete failed:', err);
        addToast({
          type: 'error',
          title: 'Delete Failed',
          message: err.message || 'Could not delete the document.',
        });
      }
    },
    [removeDocument, addToast]
  );

  const handleReindex = useCallback(
    async (docId: string, filename: string) => {
      try {
        updateDocumentStatus(docId, { stage: 'saving', progress: 5, error: undefined });
        await reindexDocument(docId);
        addToast({
          type: 'info',
          title: 'Re-indexing Started',
          message: `Re-indexing "${filename}"...`,
        });
      } catch (err: any) {
        console.error('Re-index failed:', err);
        updateDocumentStatus(docId, { stage: 'error', error: err.message });
        addToast({
          type: 'error',
          title: 'Re-index Failed',
          message: err.message || 'Could not re-index the document.',
        });
      }
    },
    [updateDocumentStatus, addToast]
  );

  const handleDownload = useCallback((docId: string) => {
    const url = getFileUrl(docId);
    window.open(url, '_blank');
  }, []);

  return {
    documents,
    isLoading,
    error,
    refreshDocuments,
    handleDelete,
    handleReindex,
    handleDownload,
  };
}
