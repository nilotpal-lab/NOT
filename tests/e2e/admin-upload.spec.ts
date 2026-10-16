import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

function createValidFixturePdf(sizeBytes = 120 * 1024): Buffer {
  const header = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nstream\n";
  const trailer = "\nendstream\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n";
  const paddingNeeded = Math.max(0, sizeBytes - header.length - trailer.length);
  const padding = "A".repeat(paddingNeeded);
  return Buffer.from(header + padding + trailer, "utf-8");
}

test.describe("Phase 1 E2E: Admin Real Login, Multi-Part Upload, Library Verification & Cleanup", () => {
  const tempDir = path.resolve(process.cwd(), "tests/fixtures");
  const tempPdfPath = path.join(tempDir, "temp-test-upload.pdf");

  test.beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    // Write a 120 KB valid fixture PDF
    fs.writeFileSync(tempPdfPath, createValidFixturePdf(120 * 1024));
  });

  test.afterAll(() => {
    if (fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }
  });

  test("log in through real UI, upload fixture with browser slicing, verify in catalog, delete it, and screenshot", async ({ page }) => {
    // 1. Configure tiny chunk size (40 KB) in the browser context so the 120 KB PDF exercises multi-part chunking (3 parts)
    await page.addInitScript(() => {
      (window as unknown as { __TEST_CHUNK_SIZE: number }).__TEST_CHUNK_SIZE = 40 * 1024;
    });

    // 2. Open /admin/login
    await page.goto("/admin/login");
    await expect(page.locator("h1")).toContainText("Admin Login");

    // 3. Log in through real UI form
    const passwordInput = page.locator('[data-testid="admin-password-input"]');
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill("admin12345");

    const loginButton = page.locator('[data-testid="login-submit-button"]');
    await loginButton.click();

    // 4. Verify redirected to /admin dashboard
    await page.waitForURL("**/admin", { timeout: 15000 });
    await expect(page.locator("text=Admin Session Active")).toBeVisible({ timeout: 10000 });

    // 5. Open Upload Modal
    const openUploadBtn = page.locator('[data-testid="open-upload-modal-btn"], [data-testid="empty-upload-btn"]').first();
    await expect(openUploadBtn).toBeVisible();
    await openUploadBtn.click();

    // 6. Fill upload form fields
    await page.selectOption('[data-testid="upload-class-select"]', "7");
    await page.selectOption('[data-testid="upload-subject-select"]', "Geography");
    await page.fill('[data-testid="upload-chapterno-input"]', "2");
    await page.fill('[data-testid="upload-title-input"]', "Inside Our Earth");
    await page.selectOption('[data-testid="upload-kind-select"]', "ncert_pdf");

    // 7. Attach fixture PDF
    const fileInput = page.locator('[data-testid="upload-file-input"]');
    await fileInput.setInputFiles(tempPdfPath);

    // 8. Submit upload form
    const submitUploadBtn = page.locator('[data-testid="upload-submit-btn"]');
    await submitUploadBtn.click();

    // 9. Wait for upload to complete and library to refresh
    const expectedFileName = "Inside-Our-Earth_Class7_Geography_Ch02_NCERT.pdf";
    const fileCell = page.locator(`td[data-testid="file-name-cell"]:has-text("${expectedFileName}")`);
    await expect(fileCell).toBeVisible({ timeout: 30000 });

    // 10. Save verified screenshot to docs/verification/screens/
    const screenshotDir = path.resolve(process.cwd(), "docs/verification/screens");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const uploadScreenshotPath = path.join(screenshotDir, "admin-upload.png");
    await page.screenshot({ path: uploadScreenshotPath, fullPage: true });
    console.log(`[E2E] Saved screenshot to ${uploadScreenshotPath}`);

    // 11. Delete the uploaded file from the library
    const deleteBtn = page.locator('[data-testid^="delete-file-btn-"]').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 12. Confirm deletion in modal
    const confirmDeleteBtn = page.locator('[data-testid="confirm-delete-btn"]');
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    // 13. Verify file is removed from table
    await expect(fileCell).toBeHidden({ timeout: 15000 });

    // 14. Save post-delete screenshot
    const cleanScreenshotPath = path.join(screenshotDir, "admin-clean.png");
    await page.screenshot({ path: cleanScreenshotPath, fullPage: true });
    console.log(`[E2E] Saved clean library screenshot to ${cleanScreenshotPath}`);
  });
});
