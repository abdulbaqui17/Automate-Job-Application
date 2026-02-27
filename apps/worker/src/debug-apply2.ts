import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const rootDir = path.resolve(import.meta.dir, "../../..");
const userDataDir = path.join(rootDir, "artifacts/sessions/15f064a5-26f8-4e19-b9b6-68d977a336ef");
const jobUrl = "https://www.linkedin.com/jobs/view/4369878590/";

// Remove stale lock
try { fs.unlinkSync(path.join(userDataDir, "SingletonLock")); } catch {}

(async () => {
  console.log("Launching...");
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-sandbox"],
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 30000,
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  
  try {
    console.log("Navigating to job page...");
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Page loaded:", page.url());
    
    // Immediately save HTML before anything can crash
    const html = await page.content();
    const htmlPath = path.join(rootDir, "artifacts/debug-page.html");
    fs.writeFileSync(htmlPath, html);
    console.log(`Saved page HTML to ${htmlPath} (${html.length} bytes)`);

    // Find ALL elements that might be related to "apply"
    const applyElements = await page.$$eval("*", (els) => {
      return els
        .filter(el => {
          const text = (el.textContent ?? "").toLowerCase();
          const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
          const href = (el as HTMLAnchorElement).href?.toLowerCase() ?? "";
          return (text.includes("apply") || aria.includes("apply") || href.includes("apply")) &&
            (el as HTMLElement).offsetParent !== null;
        })
        .map(el => ({
          tag: el.tagName,
          text: (el.textContent ?? "").trim().slice(0, 80),
          aria: el.getAttribute("aria-label") ?? "",
          href: (el as HTMLAnchorElement).href?.slice(0, 100) ?? "",
          class: el.className?.slice?.(0, 60) ?? "",
          id: el.id || "",
          visible: (el as HTMLElement).offsetParent !== null,
          rect: el.getBoundingClientRect(),
        }))
        .filter(e => e.rect.width > 0 && e.rect.height > 0)
        .slice(0, 30);
    });

    console.log(`\n=== APPLY-RELATED ELEMENTS (${applyElements.length}) ===`);
    for (const el of applyElements) {
      // Only show elements with short text (likely buttons, not page containers)
      if (el.text.length < 100) {
        console.log(`  <${el.tag}> text="${el.text}" aria="${el.aria}" href="${el.href}" class="${el.class}" rect=${JSON.stringify({w: Math.round(el.rect.width), h: Math.round(el.rect.height)})}`);
      }
    }

    // Also check for any "I'm interested" or "Save" buttons (might replace Easy Apply for some jobs)
    const otherActions = await page.$$eval("button, a", (els) => {
      return els
        .filter(el => {
          const text = (el.textContent ?? "").trim().toLowerCase();
          return (el as HTMLElement).offsetParent !== null &&
            (text === "save" || text === "i'm interested" || text.startsWith("apply") || text === "easy apply" || text.includes("submit"));
        })
        .map(el => ({
          tag: el.tagName,
          text: (el.textContent ?? "").trim().slice(0, 60),
          aria: el.getAttribute("aria-label") ?? "",
          href: (el as HTMLAnchorElement).href ?? "",
        }));
    });
    console.log(`\n=== ACTION BUTTONS (${otherActions.length}) ===`);
    for (const el of otherActions) {
      console.log(`  <${el.tag}> text="${el.text}" aria="${el.aria}" href="${el.href}"`);
    }

    // Try screenshot
    try {
      await page.screenshot({ path: path.join(rootDir, "artifacts/screenshots/debug-apply2.png"), fullPage: false });
      console.log("Screenshot saved");
    } catch (e: any) {
      console.log("Screenshot failed:", e.message?.slice(0, 60));
    }

  } catch (e: any) {
    console.error("Error:", e.message?.slice(0, 200));
  } finally {
    try { await ctx.close(); } catch {}
  }
})();
