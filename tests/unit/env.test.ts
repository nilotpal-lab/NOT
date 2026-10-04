import { describe, it, expect } from "vitest";
import { validateEnv, PART_SIZE_BYTES } from "@/lib/validate";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken } from "@/lib/auth";

describe("Environment Validation", () => {
  const validMockEnv = {
    TELEGRAM_BOT_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    TELEGRAM_CHANNEL_ID: "-1001234567890",
    SUPABASE_URL: "https://xyzcompany.supabase.co",
    SUPABASE_SERVICE_KEY: "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    GROQ_API_KEY: "gsk_test1234567890abcdef1234567890",
    GROQ_MODEL: "llama-3.1-8b-instant",
    GROQ_FALLBACK_MODEL: "llama-3.3-70b-versatile",
    ADMIN_PASSWORD_HASH: "a1b2c3d4:e5f6a7b8c9d0",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    SITE_URL: "http://localhost:3000",
    MAX_FILE_MB: "100",
  };

  it("passes when all required variables are present and valid", () => {
    const result = validateEnv(validMockEnv);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.MAX_FILE_MB).toBe(100);
  });

  it("fails with a clear list of missing variable names when empty", () => {
    const result = validateEnv({});
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errorMessage).toContain("TELEGRAM_BOT_TOKEN");
    expect(result.errorMessage).toContain("SUPABASE_URL");
    expect(result.errorMessage).toContain("GROQ_API_KEY");
  });

  it("NEVER leaks secret values in error messages", () => {
    const secretValue = "MY_SUPER_SECRET_VALUE_DO_NOT_LEAK";
    const invalidEnv = {
      ...validMockEnv,
      SUPABASE_URL: secretValue, // invalid URL, should error
    };

    const result = validateEnv(invalidEnv);
    expect(result.success).toBe(false);
    expect(result.errorMessage).not.toContain(secretValue);
    for (const err of result.errors || []) {
      expect(err).not.toContain(secretValue);
    }
  });

  it("enforces MAX_FILE_MB upper bound of 200", () => {
    const invalidEnv = {
      ...validMockEnv,
      MAX_FILE_MB: "250",
    };
    const result = validateEnv(invalidEnv);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("MAX_FILE_MB");
  });

  it("verifies PART_SIZE_BYTES is exactly 19 MiB", () => {
    expect(PART_SIZE_BYTES).toBe(19 * 1024 * 1024);
    expect(PART_SIZE_BYTES).toBe(19922944);
    // Must be strictly below Telegram's 20 MB (20,971,520 bytes) download limit
    expect(PART_SIZE_BYTES).toBeLessThan(20 * 1024 * 1024);
  });
});

describe("Authentication & Crypto Utilities", () => {
  it("hashes password and verifies correctly", async () => {
    const password = "TeacherPassword2026!";
    const hash = await hashPassword(password);

    expect(hash).toContain(":");
    const isCorrect = await verifyPassword(password, hash);
    expect(isCorrect).toBe(true);

    const isWrong = await verifyPassword("WrongPassword", hash);
    expect(isWrong).toBe(false);
  });

  it("signs and verifies admin JWT tokens", async () => {
    const secret = "test-session-secret-at-least-32-chars-long";
    const token = await createAdminToken(secret);

    expect(typeof token).toBe("string");
    const isValid = await verifyAdminToken(token, secret);
    expect(isValid).toBe(true);

    const isInvalidSecret = await verifyAdminToken(token, "wrong-secret-long-enough-32-chars-ok");
    expect(isInvalidSecret).toBe(false);

    const isTampered = await verifyAdminToken(token + "tampered", secret);
    expect(isTampered).toBe(false);
  });
});
