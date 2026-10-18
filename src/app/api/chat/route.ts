import { NextRequest, NextResponse } from "next/server";
import { getGroqClient } from "@/lib/groq";
import { buildSystemPrompt, TutorContext } from "@/lib/tutor-prompt";
import { getChaptersWithFiles } from "@/lib/catalog";
import { logger } from "@/lib/logger";

// In-memory sliding window rate limiter: IP -> Array of timestamps (epoch ms)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;     // 20 questions / min / IP
const ipRequestHistory = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const history = ipRequestHistory.get(ip) || [];
  // Prune entries older than the window
  const activeEntries = history.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (activeEntries.length >= MAX_REQUESTS_PER_WINDOW) {
    ipRequestHistory.set(ip, activeEntries);
    return false; // Rate limit exceeded
  }

  activeEntries.push(now);
  ipRequestHistory.set(ip, activeEntries);
  return true;
}

// Reset rate limits for test purposes
export function _resetRateLimits(): void {
  ipRequestHistory.clear();
}

// In-memory short-lived cache for website catalog summary in system prompt
let cachedCatalogSummary: { text: string; expiresAt: number } | null = null;

export function _resetCatalogCache(): void {
  cachedCatalogSummary = null;
}

async function fetchWebsiteCatalogSummary(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedCatalogSummary && now < cachedCatalogSummary.expiresAt) {
    return cachedCatalogSummary.text;
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return undefined;
    }

    const chapters = await getChaptersWithFiles({ isPublished: true, hideEmptyChapters: true });
    if (!chapters || chapters.length === 0) {
      return undefined;
    }

    const lines: string[] = [];
    for (const chap of chapters) {
      lines.push(
        `• Class ${chap.class} ${chap.subject} - Chapter ${chap.chapter_no}: "${chap.title}"`
      );
      for (const f of chap.files || []) {
        const typeLabel =
          f.kind === "textbook"
            ? "NCERT Textbook"
            : `Teacher Notes${f.teacher_name ? ` by ${f.teacher_name}` : ""}`;
        lines.push(
          `  - ${typeLabel} ("${f.file_name}"):\n    Preview / Read Online: /api/files/${f.id}/stream\n    Direct Download: /api/files/${f.id}/download`
        );
      }
    }

    const summary = lines.join("\n");
    cachedCatalogSummary = {
      text: summary,
      expiresAt: now + 60 * 1000, // cache for 60 seconds
    };
    return summary;
  } catch (err) {
    logger.warn({ err }, "Could not load catalog inventory for chat prompt");
    return undefined;
  }
}

interface ChatRequestBody {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  context?: TutorContext;
}

export async function POST(req: NextRequest) {
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  // 1. Rate Limit Enforcement
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      {
        error:
          "You are asking questions quite fast! Please wait a moment before asking another question to ensure fair access for everyone.",
      },
      { status: 429 }
    );
  }

  // 2. Parse & Validate Payload
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const { messages, context } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "Field 'messages' must be a non-empty array" },
      { status: 400 }
    );
  }

  // Sanitize and limit conversation context (keep up to last 10 turns, max 2000 chars per message)
  const sanitizedMessages = messages.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: (m.content || "").slice(0, 2000).trim(),
  }));

  const catalogSummary = await fetchWebsiteCatalogSummary();
  const systemMessage = {
    role: "system" as const,
    content: buildSystemPrompt(context, catalogSummary),
  };

  const fullMessages = [systemMessage, ...sanitizedMessages];

  // 3. Model Configuration (Primary with Fallback)
  const primaryModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  const fallbackModel = process.env.GROQ_FALLBACK_MODEL || "qwen/qwen3.8-27b";

  let groqClient;
  try {
    groqClient = getGroqClient();
  } catch (err) {
    logger.error({ err }, "GROQ_API_KEY missing or failed to initialize client");
    return NextResponse.json(
      { error: "AI Tutor is temporarily unavailable (API configuration missing)." },
      { status: 503 }
    );
  }

  // 4. Create Stream with Fallback Handling
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let activeModel = primaryModel;
      let streamResponse;

      try {
        // Attempt Primary Model
        streamResponse = await groqClient.chat.completions.create({
          model: primaryModel,
          messages: fullMessages as any,
          stream: true,
          temperature: 0.6,
          max_tokens: 2048,
        });
      } catch (primaryErr) {
        logger.warn(
          { primaryErr, primaryModel, fallbackModel },
          "Primary Groq model failed or was rate-limited; attempting fallback model"
        );
        try {
          activeModel = fallbackModel;
          streamResponse = await groqClient.chat.completions.create({
            model: fallbackModel,
            messages: fullMessages as any,
            stream: true,
            temperature: 0.6,
            max_tokens: 2048,
          });
        } catch (fallbackErr) {
          logger.error({ fallbackErr }, "Both primary and fallback Groq models failed");
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: "The AI study service is experiencing high demand. Please try asking again in a few moments.",
              })}\n\n`
            )
          );
          controller.close();
          return;
        }
      }

      // Stream Tokens via SSE
      try {
        for await (const chunk of streamResponse) {
          const delta = chunk.choices[0]?.delta?.content || "";
          if (delta) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (streamIterErr) {
        logger.error({ streamIterErr, activeModel }, "Error during token streaming iteration");
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: "Connection was interrupted while generating the response. Please try again.",
            })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
