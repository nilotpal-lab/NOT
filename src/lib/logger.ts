import pino from "pino";

const redactPaths = [
  "TELEGRAM_BOT_TOKEN",
  "SUPABASE_SERVICE_KEY",
  "GROQ_API_KEY",
  "ADMIN_PASSWORD_HASH",
  "SESSION_SECRET",
  "*.TELEGRAM_BOT_TOKEN",
  "*.SUPABASE_SERVICE_KEY",
  "*.GROQ_API_KEY",
  "*.ADMIN_PASSWORD_HASH",
  "*.SESSION_SECRET",
  "*.token",
  "*.secret",
  "*.password",
  "*.authorization",
  "*.cookie",
  "headers.cookie",
  "headers.authorization",
  "req.headers.cookie",
  "req.headers.authorization",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  base: {
    env: process.env.NODE_ENV,
  },
});
