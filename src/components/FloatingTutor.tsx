"use client";

import React, { useState, useRef, useEffect } from "react";
import { MessageSquare, X, Send, Sparkles, BookOpen, RotateCcw } from "lucide-react";
import { SUGGESTED_QUESTIONS } from "@/lib/tutor-prompt";

interface FloatingTutorProps {
  currentClass?: number | string;
  currentSubject?: string;
  currentChapter?: string;
}

export function FloatingTutor({
  currentClass,
  currentSubject,
  currentChapter,
}: FloatingTutorProps) {
  const [viewState, setViewState] = useState<"welcome" | "launcher" | "chat">("welcome");
  const [messages, setMessages] = useState<Array<{ sender: "bot" | "user"; text: string }>>([
    {
      sender: "bot",
      text: "Namaste! 🙏 I am your SST Study Buddy. Ask me any question about your chapters, concepts, or exam summaries in English, Hindi, or Hinglish!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (viewState === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, viewState]);

  // Suggested questions based on active subject or general
  const suggestions =
    currentSubject && SUGGESTED_QUESTIONS[currentSubject]
      ? SUGGESTED_QUESTIONS[currentSubject]
      : SUGGESTED_QUESTIONS["all"];

  async function sendMessage(textToSend: string) {
    if (!textToSend.trim() || loading) return;

    const userText = textToSend.trim();
    setInput("");

    const updatedHistory = [
      ...messages,
      { sender: "user" as const, text: userText },
    ];
    setMessages(updatedHistory);
    setLoading(true);

    // Placeholder bot message that will receive streaming tokens
    const botMsgIndex = updatedHistory.length;
    setMessages((prev) => [...prev, { sender: "bot", text: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedHistory.map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
          context: {
            class: currentClass,
            subject: currentSubject,
            chapterTitle: currentChapter,
          },
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        setMessages((prev) => {
          const next = [...prev];
          next[botMsgIndex] = {
            sender: "bot",
            text:
              errJson.error ||
              "Namaste! 🙏 The study buddy service is currently resting or busy. Please try asking again in a moment.",
          };
          return next;
        });
        setLoading(false);
        return;
      }

      if (!response.body) {
        throw new Error("No response body received from server");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const dataPayload = trimmed.replace(/^data:\s*/, "");
          if (dataPayload === "[DONE]") break;

          try {
            const parsed = JSON.parse(dataPayload);
            if (parsed.content) {
              accumulatedText += parsed.content;
              setMessages((prev) => {
                const next = [...prev];
                next[botMsgIndex] = {
                  sender: "bot",
                  text: accumulatedText,
                };
                return next;
              });
            } else if (parsed.error) {
              accumulatedText = parsed.error;
              setMessages((prev) => {
                const next = [...prev];
                next[botMsgIndex] = {
                  sender: "bot",
                  text: accumulatedText,
                };
                return next;
              });
            }
          } catch {
            // Ignore malformed SSE chunk
          }
        }
      }

      // If nothing was streamed
      if (!accumulatedText) {
        setMessages((prev) => {
          const next = [...prev];
          next[botMsgIndex] = {
            sender: "bot",
            text: "Namaste! 🙏 I understood your question, but could not retrieve the explanation right now. Please try asking again!",
          };
          return next;
        });
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[botMsgIndex] = {
          sender: "bot",
          text: "Connection was interrupted. Please check your internet or try asking again.",
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleResetChat() {
    setMessages([
      {
        sender: "bot",
        text: "Namaste! 🙏 I am your SST Study Buddy. Ask me any question about your chapters, concepts, or exam summaries in English, Hindi, or Hinglish!",
      },
    ]);
  }

  return (
    <>
      {/* ── 1. Expanded Welcome Card ────────────────────────────────────────── */}
      {viewState === "welcome" && (
        <aside
          aria-label="Ask SST Buddy Welcome Card"
          className="fixed z-40 w-[calc(100vw-32px)] sm:w-[380px] md:w-[410px] min-h-[224px] bg-gradient-to-br from-white via-white to-[#f2f3ff] border border-[#d9defe] rounded-[26px] shadow-[0_20px_60px_rgba(79,70,229,0.16)] flex items-center gap-2 sm:gap-3 p-4 pr-5 pl-0 animate-in fade-in slide-in-from-bottom-3 duration-200"
          style={{
            position: "fixed",
            right: "24px",
            bottom: "22px",
            left: "auto",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setViewState("launcher")}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#eef2f8] hover:bg-[#dee6f2] text-[#64748b] hover:text-[#1f2937] flex items-center justify-center transition-colors cursor-pointer z-10"
            aria-label="Dismiss SST Buddy"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Left: Mascot image with transparent background */}
          <div className="w-[130px] sm:w-[150px] shrink-0 self-end -ml-1 -mb-4 pointer-events-none select-none">
            <img
              src="/assets/sst-buddy-mascot.png"
              alt="SST Buddy student mascot"
              className="w-full max-h-[225px] object-contain object-bottom drop-shadow-sm"
            />
          </div>

          {/* Right: Content & CTA */}
          <div className="flex-1 min-w-0 py-1.5">
            <div className="flex items-center gap-1.5 text-xs text-[#059669] font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#10b981] inline-block animate-pulse" />
              Online
            </div>
            <h2 className="text-[20px] sm:text-[21px] font-bold text-[#1f2937] leading-tight my-1.5">
              Ask SST Buddy
            </h2>
            <p className="text-[13px] text-[#64748b] leading-snug mb-3.5">
              Get help with chapters, notes, and study questions.
            </p>
            <button
              onClick={() => setViewState("chat")}
              className="w-full h-11 rounded-full bg-gradient-to-r from-[#6b66ff] to-[#4f46e5] text-white text-xs sm:text-sm font-bold shadow-md hover:shadow-lg hover:scale-[1.02] transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <MessageSquare className="w-4 h-4" />
              Start Chat
              <span className="text-base leading-none ml-0.5">›</span>
            </button>
          </div>
        </aside>
      )}

      {/* ── 2. Closed Launcher Capsule ───────────────────────────────────────── */}
      {viewState === "launcher" && (
        <button
          onClick={() => setViewState("welcome")}
          aria-label="Open SST Buddy"
          className="fixed z-40 h-[72px] sm:h-[76px] w-[265px] sm:w-[280px] rounded-full bg-gradient-to-r from-[#635bff] to-[#4f46e5] text-white shadow-[0_12px_32px_rgba(99,91,255,0.35)] hover:shadow-[0_16px_40px_rgba(99,91,255,0.45)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-3 px-3.5 cursor-pointer border border-white/20 animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{
            position: "fixed",
            right: "24px",
            bottom: "22px",
            left: "auto",
          }}
        >
          <div className="w-[50px] h-[50px] rounded-full bg-white/20 ring-2 ring-white/70 overflow-hidden shrink-0 flex items-center justify-center shadow-xs">
            <img
              src="/assets/sst-buddy-mascot.png"
              alt="SST Buddy"
              className="w-full h-full object-cover object-top"
            />
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-bold leading-tight flex items-center gap-1.5 text-white">
              Ask SST Buddy
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-2xs" />
            </div>
            <div className="text-[11px] text-white/85 font-medium mt-0.5">
              Study help, anytime
            </div>
          </div>
        </button>
      )}

      {/* ── 3. Active Chat Drawer ───────────────────────────────────────────── */}
      {viewState === "chat" && (
        <div
          className="fixed z-50 w-[calc(100vw-32px)] sm:w-[410px] h-[570px] max-h-[85vh] rounded-[26px] border border-[var(--border)] bg-[var(--card)] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-250"
          style={{
            position: "fixed",
            right: "24px",
            bottom: "20px",
            left: "auto",
          }}
        >
          {/* Header Bar */}
          <div className="px-5 py-3.5 bg-gradient-to-r from-[#635bff] to-[#4f46e5] text-white flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-white/20 ring-1 ring-white/60 shrink-0 flex items-center justify-center shadow-xs">
                <img
                  src="/assets/sst-buddy-mascot.png"
                  alt="SST Study Buddy"
                  className="w-full h-full object-cover object-top"
                />
              </div>
              <div>
                <h4 className="text-sm font-bold tracking-tight">SST AI Study Buddy</h4>
                <p className="text-[10px] text-white/80">Classes 6–10 (English, Hindi, Hinglish)</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                aria-label="Restart conversation"
                className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Restart conversation"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewState("launcher")}
                aria-label="Close Assistant"
                className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Suggestions Chips */}
          <div className="px-3 py-2 bg-[var(--muted)]/50 border-b border-[var(--border)] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <span className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[var(--primary)]" /> Ask:
            </span>
            {suggestions.slice(0, 3).map((q, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--card)] hover:bg-[var(--primary)] hover:text-white border border-[var(--border)] text-[var(--foreground)] transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Messages Feed */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[var(--background)]/60 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-2 items-start ${m.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.sender === "bot" && (
                  <div className="w-7 h-7 rounded-full overflow-hidden bg-[#eef0ff] border border-[#dee6f2] shrink-0 mt-0.5 shadow-2xs flex items-center justify-center">
                    <img
                      src="/assets/sst-buddy-mascot.png"
                      alt="SST Buddy"
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                )}
                <div
                  className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl whitespace-pre-wrap leading-relaxed ${
                    m.sender === "user"
                      ? "bg-[var(--primary)] text-white rounded-br-xs shadow-xs"
                      : "bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] shadow-xs rounded-bl-xs"
                  }`}
                >
                  {m.text || (
                    <span className="italic text-[var(--muted-foreground)]">
                      Thinking...
                    </span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 items-center justify-start">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-[#eef0ff] border border-[#dee6f2] shrink-0 shadow-2xs flex items-center justify-center">
                  <img
                    src="/assets/sst-buddy-mascot.png"
                    alt="SST Buddy"
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <div className="px-3.5 py-2 rounded-2xl bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] text-xs flex items-center gap-1.5 shadow-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-[11px] ml-1 font-medium">SST Buddy is typing...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 border-t border-[var(--border)] bg-[var(--card)] flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about SST..."
              className="flex-1 px-3.5 py-2 rounded-full border border-[var(--border)] bg-[var(--background)] text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-hidden focus:ring-2 focus:ring-[var(--primary)]"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white flex items-center justify-center shrink-0 disabled:opacity-50 transition-all cursor-pointer shadow-xs active:scale-95"
              aria-label="Send message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
