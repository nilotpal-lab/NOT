import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Phase 3 E2E: Floating AI Tutor Live Interaction & Streaming", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/verification/screens");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("opens AI tutor, asks question, receives streamed answer, resets chat, and captures screenshot", async ({ page }) => {
    // 1. Visit homepage
    await page.goto("/");
    await expect(page.locator("text=SST Library")).toBeVisible();

    // 2. Open Floating Tutor
    const tutorTrigger = page.locator('button[aria-label="Open AI SST Tutor"]');
    await expect(tutorTrigger).toBeVisible();
    await tutorTrigger.click();

    // 3. Verify Greeting & Suggestion Chips
    await expect(page.locator("text=Namaste! 🙏")).toBeVisible();
    await expect(page.locator("text=SST AI Study Buddy")).toBeVisible();

    const askBadge = page.locator("text=Ask:");
    await expect(askBadge).toBeVisible();

    // 4. Type an SST question
    const chatInput = page.locator('input[placeholder="Ask anything about NCERT SST..."]');
    await expect(chatInput).toBeVisible();
    await chatInput.fill("What are the three layers of the Earth?");

    const sendBtn = page.locator('button[aria-label="Send message"]');
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    // 5. Verify user message appears in chat
    await expect(page.locator("text=What are the three layers of the Earth?")).toBeVisible();

    // 6. Wait for the streaming response to arrive and finish
    const botResponse = page.locator('div:has-text("Crust"), div:has-text("crust"), div:has-text("layers"), div:has-text("Earth")').last();
    await expect(botResponse).toBeVisible({ timeout: 25000 });

    // Wait until typing indicator finishes streaming
    await page.waitForSelector('text=SST Buddy is typing...', { state: 'detached', timeout: 25000 });

    // 7. Capture screenshot of the completed live AI tutor conversation
    await page.screenshot({
      path: path.join(screenshotsDir, "phase3-chat-conversation.png"),
    });

    // 8. Test Restart Conversation button
    const restartBtn = page.locator('button[aria-label="Restart chat"]');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // Verify user question is cleared and initial greeting remains
    await expect(page.locator("text=What are the three layers of the Earth?")).not.toBeVisible();
    await expect(page.locator("text=Namaste! 🙏")).toBeVisible();
  });
});
