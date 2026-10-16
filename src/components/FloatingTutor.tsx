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
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ sender: "bot" | "user"; text: string }>>([
    {
      sender: "bot",
      text: "Namaste! 🙏 I am your SST Study Buddy. Ask me any question about your NCERT chapters, concepts, or exam summaries in English, Hindi, or Hinglish!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

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
        text: "Namaste! 🙏 I am your SST Study Buddy. Ask me any question about your NCERT chapters, concepts, or exam summaries in English, Hindi, or Hinglish!",
      },
    ]);
  }

  return (
    <>
      {/* Floating Action Button with Indian Traditional Kurta & Nehru Jacket Avatar */}
      <div className="fixed bottom-5 right-5 z-40">
        {!isOpen && (
          <button
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-3 p-2 pr-4 rounded-full bg-gradient-to-r from-[var(--primary)] to-[#4f46e5] text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer border-2 border-white/40"
            aria-label="Open AI SST Tutor"
          >
            {/* Cute Indian Traditional Male Character Avatar SVG */}
            <div className="w-12 h-12 rounded-full overflow-hidden bg-[#fef3c7] border-2 border-white shadow-xs shrink-0 flex items-center justify-center relative">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {/* Background circle warm wash */}
                <circle cx="50" cy="50" r="48" fill="#fde68a" />

                {/* Kurta Collar & Saffron/Mustard Nehru Jacket */}
                <path d="M20 95 Q50 82 80 95 L85 100 L15 100 Z" fill="#d97706" />
                <path d="M35 75 L50 88 L65 75 L75 100 L25 100 Z" fill="#b45309" />
                {/* White Kurta Neckband */}
                <path d="M42 68 L50 78 L58 68 Z" fill="#ffffff" />
                {/* Traditional Tilak / Tika */}
                <circle cx="50" cy="40" r="2.5" fill="#dc2626" />

                {/* Head & Face */}
                <circle cx="50" cy="50" r="22" fill="#fed7aa" />

                {/* Neatly combed dark hair */}
                <path
                  d="M28 46 C28 28 72 28 72 46 C72 34 62 26 50 26 C38 26 28 34 28 46 Z"
                  fill="#1f2937"
                />

                {/* Expressive big friendly eyes */}
                <circle cx="43" cy="48" r="2.5" fill="#111827" />
                <circle cx="57" cy="48" r="2.5" fill="#111827" />
                {/* Eye twinkle highlights */}
                <circle cx="44" cy="47" r="0.8" fill="#ffffff" />
                <circle cx="58" cy="47" r="0.8" fill="#ffffff" />

                {/* Eyebrows */}
                <path d="M39 43 Q43 41 47 43" stroke="#1f2937" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                <path d="M53 43 Q57 41 61 43" stroke="#1f2937" strokeWidth="1.5" strokeLinecap="round" fill="none" />

                {/* Gentle smile */}
                <path
                  d="M44 56 Q50 62 56 56"
                  stroke="#9a3412"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />

                {/* Traditional Angavastram / Saffron stole on left shoulder */}
                <path d="M28 85 Q35 72 45 80 L42 100 L22 100 Z" fill="#ea580c" />
              </svg>
            </div>

            <div className="text-left hidden sm:block">
              <div className="text-xs font-bold flex items-center gap-1 leading-none mb-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin [animation-duration:8s]" />
                Ask SST Buddy
              </div>
              <div className="text-[10px] text-white/80 font-medium leading-none">
                Groq AI • Free NCERT Help
              </div>
            </div>

            {/* Active green pulse dot */}
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full"></span>
          </button>
        )}
      </div>

      {/* Floating Chat Drawer */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[92vw] sm:w-[410px] h-[560px] max-h-[85vh] rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">
          {/* Header Bar */}
          <div className="px-5 py-3.5 bg-gradient-to-r from-[var(--primary)] to-[#4f46e5] text-white flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-[#fef3c7] border border-white/60 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <circle cx="50" cy="50" r="48" fill="#fde68a" />
                  <path d="M20 95 Q50 82 80 95 L85 100 L15 100 Z" fill="#d97706" />
                  <path d="M35 75 L50 88 L65 75 L75 100 L25 100 Z" fill="#b45309" />
                  <path d="M42 68 L50 78 L58 68 Z" fill="#ffffff" />
                  <circle cx="50" cy="40" r="2.5" fill="#dc2626" />
                  <circle cx="50" cy="50" r="22" fill="#fed7aa" />
                  <path
                    d="M28 46 C28 28 72 28 72 46 C72 34 62 26 50 26 C38 26 28 34 28 46 Z"
                    fill="#1f2937"
                  />
                  <circle cx="43" cy="48" r="2.5" fill="#111827" />
                  <circle cx="57" cy="48" r="2.5" fill="#111827" />
                  <path
                    d="M44 56 Q50 62 56 56"
                    stroke="#9a3412"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path d="M28 85 Q35 72 45 80 L42 100 L22 100 Z" fill="#ea580c" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-bold tracking-tight">SST AI Study Buddy</h4>
                <p className="text-[10px] text-white/80">NCERT Classes 6–10 (English, Hindi, Hinglish)</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                aria-label="Restart chat"
                className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Restart conversation"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close Assistant"
                className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Suggestions Chips */}
          <div className="px-3 py-2 bg-[var(--muted)]/40 border-b border-[var(--border)] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
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
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[var(--background)]/50 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl whitespace-pre-wrap leading-relaxed ${
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
              <div className="flex justify-start">
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
              placeholder="Ask anything about NCERT SST..."
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
