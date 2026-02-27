import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sessionsDir = path.join(rootDir, "artifacts", "sessions");
const userId = "15f064a5-26f8-4e19-b9b6-68d977a336ef";
const userDataDir = path.join(sessionsDir, userId);

console.log("Launching Chrome...");
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  ignoreDefaultArgs: ["--enable-automation"],
  timeout: 30000,
});

context.on("close", () => console.log("Context closed!"));

console.log("Chrome launched. Opening page...");
const page = await context.newPage();

console.log("Navigating to LinkedIn job...");
try {
  await page.goto("https://www.linkedin.com/jobs/view/4369883591/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  console.log(`Page loaded! URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);
  
  // Check for Easy Apply
  await page.waitForTimeout(3000);
  const easyApply = await page.locator("button:has-text('Easy Apply')").first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Easy Apply visible: ${easyApply}`);
  
  // Take screenshot
  await page.screenshot({ path: path.join(rootDir, "artifacts/screenshots/test-job-page.png") });
  console.log("Screenshot saved to artifacts/screenshots/test-job-page.png");
  
} catch (err: any) {
  console.error("Navigation failed:", err.message);
}

// Keep browser open for 30 seconds for inspection
console.log("Keeping browser open for 30 seconds...");
await new Promise(r => setTimeout(r, 30000));

await page.close();
await context.close();
console.log("Done.");
