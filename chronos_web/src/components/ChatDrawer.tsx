import { useState, useEffect, useRef } from "react";
import { X, Send, Sparkles, Loader2 } from "lucide-react";

import { streamAI, endpoints } from "@/lib/api";
import { cn } from "@/lib/cn";

interface Props {
  open: boolean;
  onClose: () => void;
  context?: { symbol?: string };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: { id: string; name: string; status: "pending" | "done" }[];
}

export function ChatDrawer({ open, onClose, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Cmd+J toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (open) onClose();
        // Parent handles opening
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const assistantMsg: Message = {
      id: `asst-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    setMessages((prev) => [...prev, assistantMsg]);

    const allMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const ctl = new AbortController();

    try {
      await streamAI(
        endpoints.aiChat(),
        {
          messages: allMessages,
          context: context ?? undefined,
        },
        {
          signal: ctl.signal,
          onEvent: (ev) => {
            if (ev.type === "text_delta") {
              const delta = (ev.data as { text?: string }).text ?? "";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + delta }
                    : m,
                ),
              );
            } else if (ev.type === "tool_use_start") {
              const data = ev.data as { id: string; name: string };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls ?? []),
                          { id: data.id, name: data.name, status: "pending" },
                        ],
                      }
                    : m,
                ),
              );
            } else if (ev.type === "tool_result") {
              const data = ev.data as { id: string };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        toolCalls: m.toolCalls?.map((tc) =>
                          tc.id === data.id ? { ...tc, status: "done" } : tc,
                        ),
                      }
                    : m,
                ),
              );
            } else if (ev.type === "error") {
              const data = ev.data as { message?: string };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: `Error: ${data.message ?? "Unknown error"}` }
                    : m,
                ),
              );
            }
          },
        },
      );
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Failed to get response: ${e}` }
            : m,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 sm:bg-transparent"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[70vh] w-full flex-col border-l border-border bg-panel shadow-2xl sm:w-[420px]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border-soft px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent-2" />
            <span className="text-sm font-medium text-text-primary">
              Chronos AI
            </span>
            {context?.symbol && (
              <span className="chip ml-2">{context.symbol}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-bg-3 hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles size={32} className="text-text-tertiary" />
              <div className="text-sm text-text-secondary">
                Ask me about stocks, financials, or market data.
              </div>
              <div className="text-xs text-text-tertiary">
                Try: "Analyze AAPL's revenue trend" or "Compare NVDA and AMD"
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-1",
                    m.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-accent text-white"
                        : "bg-bg-2 text-text-primary",
                    )}
                  >
                    {m.content || (
                      <Loader2 size={14} className="animate-spin text-text-tertiary" />
                    )}
                  </div>
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.toolCalls.map((tc) => (
                        <span
                          key={tc.id}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-2xs",
                            tc.status === "done"
                              ? "bg-up-soft text-up"
                              : "animate-pulse bg-warn/15 text-warn",
                          )}
                        >
                          {tc.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border-soft p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask about stocks, financials..."
              rows={1}
              className="max-h-32 min-h-[36px] flex-1 resize-none rounded-md border border-border-soft bg-bg-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
              disabled={loading}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
                input.trim() && !loading
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-3 text-text-tertiary",
              )}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <div className="mt-2 text-center text-2xs text-text-tertiary">
            Press <kbd className="rounded bg-bg-3 px-1">Enter</kbd> to send ·{" "}
            <kbd className="rounded bg-bg-3 px-1">⌘J</kbd> to toggle
          </div>
        </div>
      </div>
    </div>
  );
}
