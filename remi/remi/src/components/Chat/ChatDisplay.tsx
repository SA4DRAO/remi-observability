import { useRef, useEffect } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { ChatMessage } from "../../types";
import { ScrollArea } from "../ui/scroll-area";
import dayjs from "dayjs";

interface ChatDisplayProps {
  messages: ChatMessage[];
  loading: boolean;
}

/**
 * ChatDisplay Component
 * Displays chat messages with auto-scroll to latest message
 * Uses auto-animate for smooth transitions
 */
export const ChatDisplay = ({ messages, loading }: ChatDisplayProps) => {
  const [autoAnimate] = useAutoAnimate<HTMLDivElement>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <ScrollArea className="h-full w-full">
      <div
        className="flex h-full w-full flex-col gap-3 bg-muted/30 p-4"
        ref={autoAnimate}
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Start a conversation with the agent...
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.role === "user"
                  ? "ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                  : "mr-auto max-w-[80%] rounded-lg border bg-background px-3 py-2"
              }
            >
              <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="font-semibold">{msg.role}</span>
                <span>{dayjs(msg.timestamp).format("HH:mm")}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
              {msg.currentUrl && (
                <div className="mt-2 border-t pt-1 text-[10px] text-muted-foreground">
                  {msg.currentUrl}
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="mr-auto flex max-w-[200px] items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            Agent is processing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
};
