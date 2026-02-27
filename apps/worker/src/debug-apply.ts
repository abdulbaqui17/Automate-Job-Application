import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sessionsDir = path.join(rootDir, "artifacts", "sessions");
const userId = "15f064a5-26f8-4e19-b9b6-68d977a336ef";
const userDataDir = path.join(sessionsDir, userId);

// Pick a job URL that the worker said had no Easy Apply
const jobUrl = "https://www.linkedin.com/jobs/view/4369878590/";

console.log("Launching Chrome...");
// Delete stale lock files
const { rm } = await import("fs/promises");
await rm(path.join(userDataDir, "SingletonLock"), { force: true }).catch(() => {});

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1400, height: 900 },
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-sandbox",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
  timeout: 60000,
});

const page = await context.newPage();

// First check login
await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
console.log(`Login check URL: ${page.url()}`);
const onFeed = page.url().includes("/feed");
console.log(`Logged in: ${onFeed}`);

// Navigate to job
console.log(`\nNavigating to ${jobUrl}...`);
await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
console.log(`Job page URL: ${page.url()}`);
console.log(`Title: ${await page.title()}`);

// Check ALL buttons on the page
const buttons = await page.$$eval("button", (btns) => {
  return btns.map((btn) => {
    const b = btn as HTMLElement;
    return {
      text: b.textContent?.trim().slice(0, 80),
      ariaLabel: b.getAttribute("aria-label"),
      classes: b.className?.slice(0, 100),
      visible: b.offsetHeight > 0 && b.offsetWidth > 0,
    };
  });
});

console.log(`\n=== ALL BUTTONS ON PAGE (${buttons.length}) ===`);
for (const btn of buttons) {
  if (btn.visible) {
    console.log(`  [VISIBLE] text="${btn.text}" aria="${btn.ariaLabel}" class="${btn.classes}"`);
  }
}

// Specifically look for apply-related buttons/elements
console.log("\n=== APPLY-RELATED ELEMENTS ===");
const applyElements = await page.$$eval("button, a", (els) => {
  return els
    .filter((el) => {
      const text = (el.textContent ?? "").toLowerCase();
      const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
      const cls = (el.className ?? "").toLowerCase();
      return text.includes("apply") || aria.includes("apply") || cls.includes("apply");
    })
    .map((entry) => {
      const el = entry as HTMLElement;
      const href = el.tagName === "A" ? (el as HTMLAnchorElement).href : null;
      return {
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 100),
        ariaLabel: el.getAttribute("aria-label"),
        classes: el.className?.slice(0, 120),
        href,
        visible: el.offsetHeight > 0 && el.offsetWidth > 0,
      };
    });
});

for (const el of applyElements) {
  console.log(`  ${el.visible ? "[VISIBLE]" : "[HIDDEN]"} <${el.tag}> text="${el.text}" aria="${el.ariaLabel}" class="${el.classes}" href="${el.href}"`);
}

if (applyElements.length === 0) {
  console.log("  No apply-related elements found!");
  // Check if this is a different type of apply (external link)
  const links = await page.$$eval("a[href*='apply']", (els) =>
    els.map((entry) => {
      const e = entry as HTMLAnchorElement;
      return {
        text: e.textContent?.trim().slice(0, 80),
        href: e.href,
      };
    }),
  );
  console.log("\n=== EXTERNAL APPLY LINKS ===");
  for (const link of links) {
    console.log(`  "${link.text}" -> ${link.href}`);
  }
}

// Take a screenshot for reference
await page.screenshot({ path: path.join(rootDir, "artifacts/screenshots/debug-apply-btn.png"), fullPage: false });
console.log("\nScreenshot saved to artifacts/screenshots/debug-apply-btn.png");

// Keep open for inspection
console.log("\nKeeping browser open for 20s...");
await new Promise(r => setTimeout(r, 20000));
await page.close();
await context.close();
