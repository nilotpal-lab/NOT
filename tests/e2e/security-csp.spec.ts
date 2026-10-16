import { test, expect } from "@playwright/test";

test.describe("Phase 4 E2E: Security Headers & CSP Delivery", () => {
  test("delivers strict CSP and security headers on page load", async ({ page }) => {
    const cspViolations: string[] = [];

    // Listen for CSP violation events
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("Content Security Policy")) {
        cspViolations.push(msg.text());
      }
    });

    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    const headers = response!.headers();

    // 1. Verify Content-Security-Policy
    const csp = headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");

    // 2. Verify Security Headers
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");

    // 3. Verify zero CSP violation console errors
    expect(cspViolations.length).toBe(0);
  });
});
