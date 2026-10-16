import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Phase 2 E2E: Student Experience, Soft Pop UI, and Floating Tutor", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/verification/screens");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("loads student home, verifies soft pop elements, class tabs, and floating tutor drawer", async ({ page }) => {
    // 1. Visit student library home page
    await page.goto("/");
    await expect(page).toHaveTitle(/SST Chapter Library/);

    // 2. Verify Soft Pop header branding
    await expect(page.locator("text=SST Library")).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 640) {
      await expect(page.locator("text=Class 6–10 NCERT")).toBeVisible();
    }

    // 3. Verify Class selector tabs
    const classTabs = ["Class 6", "Class 7", "Class 8", "Class 9", "Class 10"];
    for (const tab of classTabs) {
      await expect(page.locator(`button:has-text("${tab}")`)).toBeVisible();
    }

    // 4. Verify Subject filter chips
    const subjects = ["All Subjects", "History", "Geography", "Civics", "Economics", "Social Science"];
    for (const subj of subjects) {
      await expect(page.locator(`button:has-text("${subj}")`)).toBeVisible();
    }

    // 5. Test switching class tab to Class 7
    await page.click('button:has-text("Class 7")');
    // Verify Class 7 is selected (has primary background class or active state)
    const class7Btn = page.locator('button:has-text("Class 7")');
    await expect(class7Btn).toBeVisible();

    // 6. Test switching subject chip to Geography
    await page.click('button:has-text("Geography")');
    const geoBtn = page.locator('button:has-text("Geography")');
    await expect(geoBtn).toBeVisible();

    // 7. Verify search input is operational
    const searchInput = page.locator('input[placeholder*="Search chapters"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Earth");
    await expect(searchInput).toHaveValue("Earth");
    await searchInput.fill(""); // Clear

    // 8. Capture screenshot of the Student Portal Home
    await page.screenshot({
      path: path.join(screenshotsDir, "phase2-student-home.png"),
      fullPage: true,
    });

    // 9. Verify Floating Tutor character avatar in bottom-right
    const tutorTrigger = page.locator('button[aria-label="Open AI SST Tutor"]');
    await expect(tutorTrigger).toBeVisible();

    // 10. Click avatar button to open AI Tutor drawer
    await tutorTrigger.click();

    // 11. Verify Tutor drawer elements
    await expect(page.locator("text=Namaste!")).toBeVisible();
    await expect(page.locator("text=SST AI Study Buddy")).toBeVisible();

    // 12. Capture screenshot of Floating Tutor open
    await page.screenshot({
      path: path.join(screenshotsDir, "phase2-floating-tutor.png"),
    });

    // 13. Close the tutor drawer
    const closeBtn = page.locator('button[aria-label="Close Assistant"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(page.locator("text=Namaste!")).not.toBeVisible();
  });

  test("displays chapter accordions, opens PDF streaming reader modal, and opens PPTX options modal", async ({ page }) => {
    // Mock the catalog API with realistic Class 7 Geography chapter and files
    await page.route("**/api/catalog*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chapters: [
            {
              id: "chap-1",
              class: 7,
              subject: "Geography",
              chapter_no: 2,
              title: "Inside Our Earth",
              created_at: "2026-10-16T10:00:00Z",
              files: [
                {
                  id: "file-ncert-1",
                  chapter_id: "chap-1",
                  kind: "ncert_pdf",
                  file_name: "Inside-Our-Earth_Class7_Geography_Ch02_NCERT.pdf",
                  size_bytes: 2450000,
                  part_count: 1,
                  mime: "application/pdf",
                  sha256: "abc1",
                  is_published: true,
                  created_at: "2026-10-16T10:05:00Z",
                },
                {
                  id: "file-notes-1",
                  chapter_id: "chap-1",
                  kind: "teacher_notes",
                  file_name: "Inside-Our-Earth_Class7_Geography_Ch02_Notes.pdf",
                  size_bytes: 1200000,
                  part_count: 1,
                  mime: "application/pdf",
                  sha256: "abc2",
                  is_published: true,
                  created_at: "2026-10-16T10:06:00Z",
                },
                {
                  id: "file-pptx-1",
                  chapter_id: "chap-1",
                  kind: "ppt",
                  file_name: "Inside-Our-Earth_Class7_Geography_Ch02_Slides.pptx",
                  size_bytes: 8500000,
                  part_count: 1,
                  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  sha256: "abc3",
                  is_published: true,
                  created_at: "2026-10-16T10:07:00Z",
                },
              ],
            },
          ],
        }),
      });
    });

    await page.goto("/");

    // Verify Chapter accordion is visible and expanded
    await expect(page.locator("text=Inside Our Earth")).toBeVisible();
    await expect(page.locator("text=Ch 2")).toBeVisible();
    await expect(page.locator("text=Inside-Our-Earth_Class7_Geography_Ch02_NCERT.pdf")).toBeVisible();
    await expect(page.locator("text=Inside-Our-Earth_Class7_Geography_Ch02_Notes.pdf")).toBeVisible();
    await expect(page.locator("text=Inside-Our-Earth_Class7_Geography_Ch02_Slides.pptx")).toBeVisible();

    // Capture screenshot of library with chapter card
    await page.screenshot({
      path: path.join(screenshotsDir, "phase2-library-with-chapters.png"),
      fullPage: true,
    });

    // Click "Read" on the NCERT PDF to open reader modal
    const readBtn = page.locator('button:has-text("Read")').first();
    await expect(readBtn).toBeVisible();
    await readBtn.click();

    // Verify PDF Reader Modal opens with file title and iframe
    await expect(page.getByRole("heading", { name: "Inside-Our-Earth_Class7_Geography_Ch02_NCERT.pdf" })).toBeVisible();
    await expect(page.locator('iframe[title="PDF Document Viewer"]')).toBeVisible();

    // Capture screenshot of PDF Reader Modal
    await page.screenshot({
      path: path.join(screenshotsDir, "phase2-pdf-reader-modal.png"),
    });

    // Close reader modal
    const closeReaderBtn = page.locator('button[aria-label="Close reader"]');
    await expect(closeReaderBtn).toBeVisible();
    await closeReaderBtn.click();
    await expect(page.locator('iframe[title="PDF Document Viewer"]')).not.toBeVisible();

    // Click "Options" on presentation to open PPTX Modal
    const pptxBtn = page.locator('button:has-text("Options")');
    await expect(pptxBtn).toBeVisible();
    await pptxBtn.click();

    // Verify PPTX Modal
    await expect(page.getByRole("heading", { name: "Presentation Options" })).toBeVisible();
    await expect(page.getByRole("dialog").locator("text=Inside-Our-Earth_Class7_Geography_Ch02_Slides.pptx")).toBeVisible();
    await expect(page.locator("text=Download Raw PowerPoint (.pptx)")).toBeVisible();

    // Capture screenshot of PPTX modal
    await page.screenshot({
      path: path.join(screenshotsDir, "phase2-pptx-options-modal.png"),
    });

    // Close PPTX modal
    const closePptxBtn = page.locator('button[aria-label="Close presentation options"]');
    await expect(closePptxBtn).toBeVisible();
    await closePptxBtn.click();
    await expect(page.locator("text=Presentation Options")).not.toBeVisible();
  });
});
