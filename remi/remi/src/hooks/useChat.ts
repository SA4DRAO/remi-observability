import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { ChatMessage, AgentResponse } from "../types";
import type { RootState } from "../store";
import { addMessage, clearChat as clearChatAction, setSelectedPageId } from "../store/chatSlice";
import { AgentResponseSchema } from "../types/schemas";
import { parseWithSchema } from "../utils/validation";

interface UseChatReturn {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  selectedPageId: string;
  setSelectedPageId: (pageId: string) => void;
  sendMessage: (input: string) => Promise<void>;
  clearChat: () => void;
}

/**
 * useChat Hook
 * Manages chat state and message handling
 * Handles agent communication with proper error handling
 */
export const useChat = (initialPageId: string = "default"): UseChatReturn => {
  const dispatch = useDispatch();
  const selectedPageId = useSelector((s: RootState) => s.chat.selectedPageId) || initialPageId;
  const messages = useSelector((s: RootState) => s.chat.messagesByPage[selectedPageId] || []);

  const setSelectedPageIdState = useCallback((pid: string) => {
    dispatch(setSelectedPageId(pid));
  }, [dispatch]);

  /**
   * Add a message to the chat
   */
  const pushMessage = useCallback(
    (
      role: ChatMessage["role"],
      content: string,
      response?: AgentResponse
    ): void => {
      const message: ChatMessage = {
        id: Date.now(),
        role,
        content,
        pageId: response?.pageId,
        currentUrl: response?.currentUrl,
        timestamp: new Date(),
      };
      const pid = response?.pageId || selectedPageId || initialPageId;
      dispatch(addMessage({ pageId: pid, message }));
    },
    [dispatch, selectedPageId, initialPageId]
  );

  /**
   * Send a message to the agent
   */
  const mutation = useMutation<AgentResponse, Error, { message: string; pageId: string }>(
    {
      mutationFn: async ({ message, pageId }) => {
        const raw = await apiClient.post<unknown>("/agent", { message, pageId });
        const parsed = parseWithSchema(AgentResponseSchema, raw, "POST /agent");
        return parsed as AgentResponse;
      },
      onSuccess: (response) => {
        if (response.success) {
          pushMessage("agent", response.reply, response);
          logger.info("Message sent successfully", {
            pageId: response.pageId,
            actionCount: response.actionCount,
          });
        } else {
          const errorMsg = response.error || "Agent failed to process request";
          pushMessage("agent", `Error: ${errorMsg}`);
          logger.error("Agent returned error", { error: response.error });
        }
      },
      onError: (err) => {
        const errorMsg = err?.message || "Unknown error occurred";
        pushMessage("agent", `Error: ${errorMsg}`);
        logger.error("Failed to send message", err);
      },
    }
  );

  const sendMessage = useCallback(async (userInput: string): Promise<void> => {
    const trimmed = userInput.trim();
    if (!trimmed || mutation.isPending) return;
    // add user message locally via Redux
    pushMessage("user", trimmed, { success: true, reply: "", actionsLog: [], sessionId: "", pageId: selectedPageId, actionCount: 0, currentUrl: "" });
    await mutation.mutateAsync({ message: trimmed, pageId: selectedPageId });
  }, [selectedPageId, mutation, pushMessage]);

  /**
   * Clear all messages
   */
  const clearChat = useCallback((): void => {
    dispatch(clearChatAction(selectedPageId));
  }, [dispatch, selectedPageId]);

  // Memoize return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      messages,
      loading: mutation.isPending,
      error: mutation.error ? (mutation.error.message ?? "Error") : null,
      selectedPageId,
      setSelectedPageId: setSelectedPageIdState,
      sendMessage,
      clearChat,
    }),
    [messages, mutation.isPending, mutation.error, selectedPageId, sendMessage, clearChat, setSelectedPageIdState]
  );
};
