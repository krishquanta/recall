import { useEffect, useRef } from 'react';
import { subscribeStatusSSE } from '../api/client';
import { ProcessingStatus } from '../types';

interface UseSSEOptions {
  docId: string | null;
  onUpdate: (status: ProcessingStatus) => void;
  onError?: (err: Event) => void;
  enabled?: boolean;
}

export function useSSE({ docId, onUpdate, onError, enabled = true }: UseSSEOptions) {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!docId || !enabled) return;

    const cleanup = subscribeStatusSSE(
      docId,
      (status) => {
        onUpdate(status);
      },
      (err) => {
        if (onError) onError(err);
      }
    );

    unsubscribeRef.current = cleanup;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [docId, enabled, onUpdate, onError]);
}
