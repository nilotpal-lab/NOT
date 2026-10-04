import Groq from "groq-sdk";
import { logger } from "./logger";

let groqInstance: Groq | null = null;

export function getGroqClient(apiKey?: string): Groq {
  const key = apiKey || process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is required to initialize Groq client");
  }
  if (!groqInstance || apiKey) {
    const client = new Groq({ apiKey: key });
    if (!apiKey) groqInstance = client;
    return client;
  }
  return groqInstance;
}

export interface GroqCheckResult {
  ok: boolean;
  modelFound: boolean;
  fallbackModelFound: boolean;
  availableModels: string[];
  error?: string;
}

export async function verifyGroqSetup(
  apiKey?: string,
  primaryModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  fallbackModel = process.env.GROQ_FALLBACK_MODEL || "llama-3.3-70b-versatile"
): Promise<GroqCheckResult> {
  try {
    const client = getGroqClient(apiKey);
    const modelList = await client.models.list();
    const modelIds = modelList.data.map((m) => m.id);

    const modelFound = modelIds.includes(primaryModel);
    const fallbackModelFound = modelIds.includes(fallbackModel);

    return {
      ok: modelFound && fallbackModelFound,
      modelFound,
      fallbackModelFound,
      availableModels: modelIds,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Groq verification failed");
    return {
      ok: false,
      modelFound: false,
      fallbackModelFound: false,
      availableModels: [],
      error: msg,
    };
  }
}
