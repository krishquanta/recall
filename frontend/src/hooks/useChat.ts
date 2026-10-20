import { useCallback } from 'react';
import { askQuestion } from '../api/client';
import { useAppStore } from '../store/appStore';
import { Message } from '../types';

export function useChat() {
  const messages = useAppStore((state) => state.messages);
  const activeDocIds = useAppStore((state) => state.activeDocIds);
  const isThinking = useAppStore((state) => state.isThinking);
  const addMessage = useAppStore((state) => state.addMessage);
  const setIsThinking = useAppStore((state) => state.setIsThinking);
  const addToast = useAppStore((state) => state.addToast);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;

      const userMessageId = `user-${Date.now()}`;
      const userMessage: Message = {
        id: userMessageId,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      addMessage(userMessage);
      setIsThinking(true);

      try {
        const response = await askQuestion(trimmed, activeDocIds);

        const assistantMessageId = `assistant-${Date.now()}`;
        const assistantMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: response.answer,
          citations: response.citations || [],
          createdAt: new Date().toISOString(),
        };

        addMessage(assistantMessage);
      } catch (err: any) {
        console.error('Chat error:', err);
        const errorMessageId = `assistant-error-${Date.now()}`;
        addMessage({
          id: errorMessageId,
          role: 'assistant',
          content: `⚠️ Sorry, I encountered an error answering your question: ${err.message || 'Unknown error'}. Please try again.`,
          createdAt: new Date().toISOString(),
        });
        addToast({
          type: 'error',
          title: 'Query Failed',
          message: err.message || 'Unable to retrieve answer.',
        });
      } finally {
        setIsThinking(false);
      }
    },
    [activeDocIds, isThinking, addMessage, setIsThinking, addToast]
  );

  return {
    messages,
    isThinking,
    sendMessage,
  };
}
