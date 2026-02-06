import { useRef } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface ChatInputProps {
  onSend: (message: string) => void;
  loading: boolean;
  placeholder?: string;
}

/**
 * ChatInput Component
 * Handles message input with form submission
 * Prevents empty submissions and manages focus states
 */
export const ChatInput = ({
  onSend,
  loading,
  placeholder = "Type your message...",
}: ChatInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();

    if (!inputRef.current) return;

    const message = inputRef.current.value.trim();

    // Validate input
    if (!message || loading) return;

    // Send message
    onSend(message);

    // Clear input and refocus
    inputRef.current.value = "";
    inputRef.current.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // Allow submit on Enter, but not Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    }
  };

  return (
    <form className="w-full" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          disabled={loading}
          onKeyDown={handleKeyDown}
          autoFocus
          aria-label="Message input"
        />
        <Button type="submit" disabled={loading} aria-label="Send message">
          {loading ? "Sending..." : "Send"}
        </Button>
      </div>
    </form>
  );
};
