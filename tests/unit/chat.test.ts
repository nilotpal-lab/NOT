import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt, SUGGESTED_QUESTIONS } from "@/lib/tutor-prompt";
import { POST, _resetRateLimits } from "@/app/api/chat/route";
import * as groqModule from "@/lib/groq";
import { NextRequest } from "next/server";

describe("Phase 3: AI Groq Tutor & NCERT Guardrails (tests/unit/chat.test.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetRateLimits();
  });

  describe("buildSystemPrompt & Guardrails", () => {
    it("builds default system prompt with NCERT persona and rules", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("SST Study Buddy");
      expect(prompt).toContain("Namaste! 🙏");
      expect(prompt).toContain("Classes 6 to 10");
      expect(prompt).toContain("NCERT CURRICULUM SCOPE");
      expect(prompt).toContain("OUT-OF-DOMAIN HANDLING");
      expect(prompt).toContain("NO HALLUCINATED URLS");
      expect(prompt).toContain("INJECTION & JAILBREAK RESISTANCE");
    });

    it("injects specific classroom and chapter context when provided", () => {
      const prompt = buildSystemPrompt({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        chapterTitle: "The Story of Village Palampur",
      });
      expect(prompt).toContain("Class 9");
      expect(prompt).toContain("Economics");
      expect(prompt).toContain('Chapter 1: "The Story of Village Palampur"');
    });

    it("provides curated suggestions for all NCERT subjects", () => {
      expect(SUGGESTED_QUESTIONS["History"].length).toBeGreaterThanOrEqual(3);
      expect(SUGGESTED_QUESTIONS["Geography"].length).toBeGreaterThanOrEqual(3);
      expect(SUGGESTED_QUESTIONS["Civics"].length).toBeGreaterThanOrEqual(3);
      expect(SUGGESTED_QUESTIONS["Economics"].length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("POST /api/chat Route Handler", () => {
    it("returns 400 for empty or invalid messages", async () => {
      const req = new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("non-empty array");
    });

    it("enforces sliding window rate limit of 20 reqs/min", async () => {
      const fakeClient = {
        chat: {
          completions: {
            create: vi.fn(async function* () {
              yield { choices: [{ delta: { content: "Namaste" } }] };
            }),
          },
        },
      };
      vi.spyOn(groqModule, "getGroqClient").mockReturnValue(fakeClient as any);

      // Fire 20 requests
      for (let i = 0; i < 20; i++) {
        const req = new NextRequest("http://localhost:3000/api/chat", {
          method: "POST",
          headers: { "x-forwarded-for": "192.168.1.100" },
          body: JSON.stringify({
            messages: [{ role: "user", content: `Question ${i}` }],
          }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
      }

      // 21st request from same IP should get 429
      const overLimitReq = new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        headers: { "x-forwarded-for": "192.168.1.100" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Too fast" }],
        }),
      });
      const overLimitRes = await POST(overLimitReq);
      expect(overLimitRes.status).toBe(429);
      const errJson = await overLimitRes.json();
      expect(errJson.error).toContain("quite fast");
    });

    it("streams tokens via SSE correctly", async () => {
      const fakeChunks = [
        { choices: [{ delta: { content: "Namaste! " } }] },
        { choices: [{ delta: { content: "Democracy is " } }] },
        { choices: [{ delta: { content: "a form of government." } }] },
      ];

      const fakeClient = {
        chat: {
          completions: {
            create: vi.fn(async function* () {
              for (const chunk of fakeChunks) {
                yield chunk;
              }
            }),
          },
        },
      };
      vi.spyOn(groqModule, "getGroqClient").mockReturnValue(fakeClient as any);

      const req = new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "What is democracy?" }],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain('data: {"content":"Namaste! "}\n\n');
      expect(text).toContain('data: {"content":"Democracy is "}\n\n');
      expect(text).toContain('data: {"content":"a form of government."}\n\n');
      expect(text).toContain("data: [DONE]\n\n");
    });

    it("falls back to secondary model if primary model fails", async () => {
      let callCount = 0;
      const fakeClient = {
        chat: {
          completions: {
            create: vi.fn(async (options: { model: string }) => {
              callCount++;
              if (callCount === 1) {
                // Primary model failure (e.g. rate limit / network error)
                throw new Error("Primary model 429 rate limit");
              }
              // Fallback model success
              return (async function* () {
                yield { choices: [{ delta: { content: "Fallback answer" } }] };
              })();
            }),
          },
        },
      };
      vi.spyOn(groqModule, "getGroqClient").mockReturnValue(fakeClient as any);

      const req = new NextRequest("http://localhost:3000/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Tell me about French Revolution" }],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('data: {"content":"Fallback answer"}\n\n');
      expect(callCount).toBe(2);
    });
  });
});
