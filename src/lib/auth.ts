import crypto from "crypto";

// Re-export all JWT and Origin utilities for 100% backward compatibility
export * from "./auth-jwt";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

/**
 * Hashes a plain-text password using Node.js crypto.scrypt and a random 16-byte hex salt.
 * Output format: `${salt}:${derivedKeyHex}`
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verifies a plain-text password against a stored scrypt hash using timingSafeEqual
 * to prevent timing side-channel attacks.
 */
export async function verifyPassword(plainText: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !plainText) {
    return false;
  }

  const parts = storedHash.split(":");
  if (parts.length !== 2) {
    return false;
  }

  const [salt, keyHex] = parts;
  if (!salt || !keyHex) {
    return false;
  }

  return new Promise((resolve) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return resolve(false);

      try {
        const keyBuffer = Buffer.from(keyHex, "hex");
        if (keyBuffer.length !== derivedKey.length) {
          return resolve(false);
        }
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

// ============================================================================
// In-Memory IP Rate Limiter
// Window: 15 minutes, Max allowed failures: 5, Blocks on 6th attempt (HTTP 429)
// ============================================================================

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms)
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

export interface RateLimitStatus {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}

// Stores array of failed attempt epoch timestamps (ms) keyed by client IP
const failedAttemptsMap = new Map<string, number[]>();

/**
 * Checks whether the specified IP is permitted to attempt login.
 * Prunes expired timestamps within the sliding 15-minute window.
 */
export function checkRateLimit(ip: string): RateLimitStatus {
  const now = Date.now();
  const timestamps = failedAttemptsMap.get(ip) || [];

  // Filter timestamps within the sliding window
  const activeTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (activeTimestamps.length === 0) {
    failedAttemptsMap.delete(ip);
  } else {
    failedAttemptsMap.set(ip, activeTimestamps);
  }

  if (activeTimestamps.length >= MAX_FAILED_LOGIN_ATTEMPTS) {
    const oldest = activeTimestamps[0];
    const retryAfterMs = oldest + RATE_LIMIT_WINDOW_MS - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_FAILED_LOGIN_ATTEMPTS - activeTimestamps.length,
  };
}

/**
 * Records a failed login attempt for the specified IP address.
 */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const timestamps = failedAttemptsMap.get(ip) || [];
  const activeTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  activeTimestamps.push(now);
  failedAttemptsMap.set(ip, activeTimestamps);

  // Opportunistic leak prevention: if map exceeds 500 entries, sweep expired keys
  if (failedAttemptsMap.size > 500) {
    for (const [key, list] of failedAttemptsMap.entries()) {
      const valid = list.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (valid.length === 0) {
        failedAttemptsMap.delete(key);
      } else {
        failedAttemptsMap.set(key, valid);
      }
    }
  }
}

/**
 * Resets the failed attempts counter for the specified IP address upon successful login.
 */
export function resetRateLimit(ip: string): void {
  failedAttemptsMap.delete(ip);
}

/**
 * Testing helper: clears all in-memory rate limit records.
 */
export function _clearAllRateLimits(): void {
  failedAttemptsMap.clear();
}

/**
 * Alias for testing helper.
 */
export function _clearRateLimitStore(): void {
  failedAttemptsMap.clear();
}
