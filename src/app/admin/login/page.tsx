"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("from") || "/admin";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const waitTime = data.retryAfter || 900;
          setError(
            `Too many failed attempts. Temporary lockout active. Please wait ${waitTime} seconds before trying again.`
          );
          setRemainingAttempts(0);
        } else {
          setError(data.error || "Authentication failed. Please check your credentials.");
          if (typeof data.remainingAttempts === "number") {
            setRemainingAttempts(data.remainingAttempts);
          }
        }
        return;
      }

      // Successful login -> Redirect to destination
      window.location.href = fromUrl;
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-4 py-8">
      <div className="w-full max-w-md p-8 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-3">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">
            Admin Login - SST Chapter Library
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1.5">
            Enter master key to manage chapters, upload materials, and edit library records.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium">{error}</span>
            </div>
            {remainingAttempts !== null && remainingAttempts > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400 pl-6">
                {remainingAttempts} attempt{remainingAttempts === 1 ? "" : "s"} remaining before temporary lockout.
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-[var(--foreground)] mb-1"
            >
              Master Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                data-testid="admin-password-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                disabled={loading}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent text-sm transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] text-xs font-medium cursor-pointer select-none"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            data-testid="login-submit-button"
            disabled={loading || !password.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[var(--border-color)] text-center text-xs text-[var(--muted)]">
          <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
            &larr; Return to Public Library
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[calc(100vh-140px)]">
          <div className="w-full max-w-md p-8 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-md text-center">
            <p className="text-sm text-[var(--muted)]">Loading login interface...</p>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
