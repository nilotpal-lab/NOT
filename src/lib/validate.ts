import { z } from "zod";

export const PART_SIZE_BYTES = 19 * 1024 * 1024; // 19 MiB hard limit per Telegram chunk

export const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_CHANNEL_ID: z.string().min(1, "TELEGRAM_CHANNEL_ID is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY is required"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  GROQ_FALLBACK_MODEL: z.string().default("llama-3.3-70b-versatile"),
  ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH is required"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  SITE_URL: z.string().url("SITE_URL must be a valid URL").default("http://localhost:3000"),
  CONTACT_EMAIL: z.string().optional().or(z.literal("")),
  MAX_FILE_MB: z
    .coerce
    .number()
    .int()
    .min(1, "MAX_FILE_MB must be at least 1")
    .max(200, "MAX_FILE_MB cannot exceed 200")
    .default(100),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(input: Record<string, unknown>): {
  success: boolean;
  data?: Env;
  errors?: string[];
  errorMessage?: string;
} {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const errorMap = new Map<string, string>();
    for (const issue of result.error.issues) {
      const field = issue.path.join(".") || "UNKNOWN";
      // Never include input values in the error messages
      errorMap.set(field, `Variable '${field}': ${issue.message}`);
    }
    const errors = Array.from(errorMap.values());
    return {
      success: false,
      errors,
      errorMessage: `Environment validation failed for variables: ${Array.from(errorMap.keys()).join(", ")}`,
    };
  }
  return { success: true, data: result.data };
}

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const result = validateEnv(process.env);
  if (!result.success || !result.data) {
    throw new Error(result.errorMessage);
  }
  cachedEnv = result.data;
  return cachedEnv;
}
