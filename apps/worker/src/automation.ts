import "./env";
import { chromium, BrowserContext, Page } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir, rm, appendFile } from "fs/promises";
import { prisma } from "./db";
import { publishEvent } from "./events";
import { redis } from "./redis";
import { APPLICATION_STREAM } from "./stream";
import {
  generateCoverLetter,
  answerApplicationQuestion,
  isAIEnabled,
  scoreJobMatch,
  tailorResume,
  generateHRMessage,
} from "./ai";
import { sendStatusNotification } from "./notifications";
import { runDiscoveryNow } from "./discovery";

type SearchPreference = NonNullable<
  Awaited<ReturnType<typeof prisma.searchPreference.findFirst>>
>;
type Platform = SearchPreference["userId"] extends string
  ? "LINKEDIN" | "INDEED" | "GLASSDOOR" | "REMOTIVE" | "ARBEITNOW" | "OTHER"
  : never;

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const artifactsDir = path.join(rootDir, "artifacts");
const sessionsDir = path.join(artifactsDir, "sessions");
const resumeDir = path.join(artifactsDir, "resumes");

const requestedHeadless = process.env.HEADLESS !== "false";
const canRunHeaded =
  process.platform === "darwin" ||
  process.platform === "win32" ||
  Boolean(process.env.DISPLAY);
const headless = requestedHeadless || !canRunHeaded;
const slowMo = Number(process.env.BROWSER_SLOWMO ?? 0) || 0;
const channel = process.env.BROWSER_CHANNEL || undefined;
const autoSubmit = process.env.AUTO_SUBMIT !== "false";
const manualHoldMs = Number(process.env.MANUAL_HOLD_MS ?? 10 * 60 * 1000);
const loginWaitMs = Number(process.env.LOGIN_WAIT_MS ?? 5 * 60 * 1000);
const aiScoringEnabled = process.env.AI_SCORING !== "false";
const coverLetterEnabled = process.env.COVER_LETTER_ENABLED === "true"; // Disabled by default — user removed cover letter feature
const resumeTailorEnabled = process.env.RESUME_TAILOR_ENABLED !== "false";
const resumeTailorLimit = Number(process.env.RESUME_TAILOR_LIMIT ?? 10);
const aiScoreLimit = Number(process.env.AI_SCORE_LIMIT ?? 10);
const aiAnswerEnabled = process.env.AI_ANSWER_ENABLED !== "false";
const aiAnswerLimit = Number(process.env.AI_ANSWER_LIMIT ?? 3);
const hrMessageEnabled = process.env.HR_MESSAGE_ENABLED !== "false";
const forceApply = process.env.FORCE_APPLY === "true"; // Debug: bypass MERN validation

const contexts = new Map<string, BrowserContext>();

const ensureDir = async (dir: string) => {
  await mkdir(dir, { recursive: true });
};

const logFile = path.join(artifactsDir, "apply.log");
const log = async (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  await appendFile(logFile, line).catch(() => {});
};

const getContext = async (userId: string) => {
  const existing = contexts.get(userId);
  if (existing) {
    try {
      await existing.pages();
      return existing;
    } catch {
      console.log(`[getContext] Stale context for ${userId}, relaunching...`);
      contexts.delete(userId);
      try { await existing.close(); } catch {}
    }
  }

  await ensureDir(sessionsDir);
  const userDataDir = path.join(sessionsDir, userId);
  await rm(path.join(userDataDir, "SingletonLock"), { force: true }).catch(() => {});

  console.log(`[getContext] Launching Chrome with persistent session at ${userDataDir}...`);
  if (!canRunHeaded && !requestedHeadless) {
    console.log("[getContext] HEADLESS=false requested but DISPLAY is missing; using headless mode.");
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo,
    channel,
    viewport: { width: 1400, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 30000,
  });

  context.on("close", () => {
    console.log(`[getContext] Browser context closed for ${userId}`);
    contexts.delete(userId);
  });

  contexts.set(userId, context);
  console.log(`[getContext] Chrome launched successfully (persistent session)`);
  return context;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildQuery = (pref: SearchPreference) => {
  // Use only the first role for the search — combining 30+ keywords returns 0 results
  const role = pref.roles[0]?.trim();
  if (role) return role;
  // Fallback: pick first 2 keywords
  return pref.keywords.slice(0, 2).map((t:any) => t.trim()).filter(Boolean).join(" ");
};

/** Build multiple search queries from all roles to cast a wider net */
const buildMultipleQueries = (pref: SearchPreference): string[] => {
  const queries: string[] = [];
  // Each role becomes a separate search
  for (const role of pref.roles) {
    const trimmed = role.trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  }
  // Fallback if no roles
  if (queries.length === 0) {
    const kw = pref.keywords.slice(0, 2).map((t:any) => t.trim()).filter(Boolean).join(" ");
    if (kw) queries.push(kw);
  }
  return queries;
};

const scoringTermsFromPreference = (pref: SearchPreference, limit = 10) =>
  Array.from(
    new Set(
      [...pref.roles, ...pref.keywords]
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, limit);

const scoreJob = (job: { title?: string | null; company?: string | null; location?: string | null }, pref: SearchPreference) => {
  const terms = scoringTermsFromPreference(pref);
  if (!terms.length) return 0.5;
  const haystack = `${job.title ?? ""} ${job.company ?? ""} ${job.location ?? ""}`.toLowerCase();
  const matches = terms.filter((term) => haystack.includes(term)).length;
  return matches / terms.length;
};

// ────────────────────────────────────────────────────────────────────────────
// User-Preference-Based Job Validation
// ────────────────────────────────────────────────────────────────────────────

/** Scoring output — every job gets this evaluation */
type JobScoreResult = {
  match_score: number; // 0-100
  is_match: boolean;
  reasons: string[];
  missing_skills: string[];
  confidence: "low" | "medium" | "high";
};

/** Detect if job requires 6+ years experience (reject senior roles for interns/juniors) */
const isSeniorRole = (title: string, description?: string | null): boolean => {
  const t = title.toLowerCase();
  const d = (description ?? "").toLowerCase();
  if (/\b(staff|principal|architect)\b/i.test(t)) return true;
  const yearsMatch = d.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1], 10);
    if (years >= 6) return true;
  }
  return false;
};

/** Check if a job mentions remote work */
const isRemoteJob = (title: string, location?: string | null, description?: string | null): { remote: boolean; reason: string } => {
  const text = `${title} ${location ?? ""} ${description ?? ""}`.toLowerCase();
  const remoteSignals = /\b(remote|work from home|wfh|fully remote|anywhere|worldwide|global|distributed)\b/i.test(text);
  const onsiteSignals = /\b(on[\s-]?site|in[\s-]?office|hybrid|office[\s-]?based|must be located|relocation required)\b/i.test(text);
  if (onsiteSignals && !remoteSignals) return { remote: false, reason: "Job is onsite or hybrid" };
  if (remoteSignals) return { remote: true, reason: "Fully remote" };
  // If no signal either way, allow it (don't reject just because remote isn't mentioned)
  return { remote: true, reason: "No location restriction found" };
};

/**
 * Compute a job match score (0-100) based on the USER'S actual roles and keywords.
 * Not hardcoded to any specific tech stack.
 */
const computeJobScore = (
  title: string,
  pref: { roles: string[]; keywords: string[]; remote: boolean },
  description?: string | null,
  location?: string | null
): JobScoreResult => {
  const reasons: string[] = [];
  const missing: string[] = [];
  let score = 0;

  if (!title || title.trim().length === 0) {
    return { match_score: 0, is_match: false, reasons: ["Empty title"], missing_skills: [], confidence: "high" };
  }

  const titleLower = title.toLowerCase();
  const descLower = (description ?? "").toLowerCase();
  const allText = `${titleLower} ${descLower}`;

  // ── 1. Remote check (only if user wants remote) ──
  if (pref.remote) {
    const remoteCheck = isRemoteJob(title, location, description);
    if (!remoteCheck.remote) {
      return { match_score: 0, is_match: false, reasons: [`Not remote: ${remoteCheck.reason}`], missing_skills: [], confidence: "high" };
    }
    reasons.push("Remote ✓");
  }

  // ── 2. Senior role check (reject 6+ year requirements) ──
  if (isSeniorRole(title, description)) {
    return { match_score: 0, is_match: false, reasons: ["Senior role requiring 6+ years experience"], missing_skills: [], confidence: "high" };
  }

  // ── 3. Role matching (0-50 pts) — does the title match any of the user's target roles? ──
  const roles = pref.roles.map((r) => r.toLowerCase().trim()).filter(Boolean);
  let roleMatched = false;
  let bestRoleMatch = "";
  for (const role of roles) {
    // Split role into words and check if all words appear in title
    const words = role.split(/\s+/);
    const allInTitle = words.every((w) => titleLower.includes(w));
    // Also check for partial match — any word > 3 chars matches
    const partialMatch = words.filter((w) => w.length > 3 && titleLower.includes(w)).length;
    if (allInTitle) {
      roleMatched = true;
      bestRoleMatch = role;
      score += 50;
      break;
    } else if (partialMatch >= 1) {
      // Partial role match — some points
      roleMatched = true;
      bestRoleMatch = role;
      score += 30;
      break;
    }
  }
  // Also check if generic dev/engineer role words appear
  if (!roleMatched) {
    const genericMatch = /\b(developer|engineer|intern|dev)\b/i.test(titleLower);
    if (genericMatch) {
      score += 15;
      reasons.push("Generic developer/engineer title");
    } else {
      reasons.push(`Title "${title}" doesn't match any target role`);
    }
  } else {
    reasons.push(`Title matches role: "${bestRoleMatch}"`);
  }

  // ── 4. Keyword/skill matching in description (0-35 pts) ──
  let confidence: "low" | "medium" | "high" = "low";
  const keywords = pref.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  if (keywords.length > 0 && allText.length > 50) {
    const matched = keywords.filter((kw) => allText.includes(kw));
    const missedKw = keywords.filter((kw) => !allText.includes(kw));
    // Score: percentage of keywords matched × 35
    const kwScore = Math.round((matched.length / keywords.length) * 35);
    score += kwScore;
    missing.push(...missedKw.slice(0, 5));
    if (matched.length > 0) {
      reasons.push(`Skills matched: ${matched.slice(0, 6).join(", ")} (${matched.length}/${keywords.length})`);
    }
    confidence = matched.length >= keywords.length * 0.4 ? "high"
      : matched.length >= 2 ? "medium" : "low";
  } else if (keywords.length > 0) {
    // Just check title for keywords
    const matched = keywords.filter((kw) => titleLower.includes(kw));
    if (matched.length > 0) {
      score += Math.round((matched.length / keywords.length) * 20);
      reasons.push(`Title mentions: ${matched.join(", ")}`);
    }
    confidence = "low";
  }

  // ── 5. Bonus signals (0-15 pts) ──
  const text = allText;
  if (/\b(startup|early[\s-]?stage|funded|series\s*[a-c])\b/i.test(text)) { score += 5; reasons.push("Startup"); }
  if (/\b(intern|internship|entry[\s-]?level|junior|graduate)\b/i.test(text)) { score += 5; reasons.push("Entry-level friendly"); }
  if (/\b(international|global|anywhere|worldwide|no visa)\b/i.test(text)) { score += 5; reasons.push("International"); }

  const finalScore = Math.min(Math.round(score), 100);
  // Pass threshold: 35/100 — let more jobs through to increase application rate
  const isMatch = finalScore >= 35;

  return {
    match_score: finalScore,
    is_match: isMatch,
    reasons,
    missing_skills: missing,
    confidence,
  };
};

/** Full pre-click validation using user preferences */
const validateJob = (
  title: string,
  pref: { roles: string[]; keywords: string[]; remote: boolean },
  description?: string | null,
  location?: string | null
): { pass: boolean; reason: string; score?: JobScoreResult } => {
  const result = computeJobScore(title, pref, description, location);
  if (result.is_match) {
    return { pass: true, reason: `Match (${result.match_score}%) — ${result.reasons.join("; ")}`, score: result };
  }
  const primaryReason = result.reasons[0] ?? "Does not match preferences";
  return { pass: false, reason: primaryReason, score: result };
};

/** Backward-compatible wrapper that always passes (for callsites without pref access) */
const validateMERNJob = (title: string, description?: string | null, location?: string | null): { pass: boolean; reason: string; score?: JobScoreResult } => {
  // Without preferences, use a permissive validation — just check title isn't empty
  if (!title || title.trim().length === 0) {
    return { pass: false, reason: "Empty title", score: { match_score: 0, is_match: false, reasons: ["Empty title"], missing_skills: [], confidence: "high" } };
  }
  return { pass: true, reason: "Passed (no preference filter)", score: { match_score: 50, is_match: true, reasons: ["No preference filter applied"], missing_skills: [], confidence: "low" } };
};

// ────────────────────────────────────────────────────────────────────────────

const normalizeList = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

const buildExperienceSummary = (experience: Array<any>) => {
  return experience
    .map((item) => {
      const title = item?.title ?? "";
      const company = item?.company ?? "";
      const summary = item?.summary ?? item?.details ?? "";
      return [title, company, summary].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .join("\n");
};

const fileExists = async (filePath?: string | null) => {
  if (!filePath) return false;
  try {
    const file = Bun.file(filePath);
    return await file.exists();
  } catch {
    return false;
  }
};

const fillInput = async (page: Page, selectors: string[], value?: string | null) => {
  if (!value) return;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    // Skip hidden/non-visible elements — filling them causes timeouts
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    const current = await locator.inputValue().catch(() => "");
    if (!current) {
      await locator.fill(value, { timeout: 5000 }).catch(() => {});
    }
    break;
  }
};

const fillTextareas = async (
  page: Page,
  coverLetterText: string,
  fallbackText: string
) => {
  const areas = await page.$$("textarea");
  let filledCover = false;
  let filledCount = 0;

  for (const area of areas) {
    if (filledCount >= 2) break;
    // Skip hidden textareas
    const visible = await area.isVisible().catch(() => false);
    if (!visible) continue;
    const current = (await area.inputValue().catch(() => ""))?.trim();
    if (current) continue;

    // Get the label to determine what kind of textarea this is
    const label = await area.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      let lbl = ta.getAttribute("aria-label") || ta.getAttribute("placeholder") || "";
      if (!lbl) {
        const id = ta.getAttribute("id");
        if (id) {
          const byFor = document.querySelector(`label[for='${id}']`);
          if (byFor?.textContent) lbl = byFor.textContent;
        }
      }
      if (!lbl) {
        const wrapper = ta.closest("div");
        const candidate = wrapper?.querySelector("label, span, p");
        if (candidate?.textContent) lbl = candidate.textContent;
      }
      return (lbl ?? "").trim().toLowerCase();
    }).catch(() => "");

    // Only fill with cover letter if it looks like a cover letter field, or if it's the first empty textarea
    const isCoverLetterField = label.includes("cover") || label.includes("letter") || label.includes("summary") || label.includes("about") || label.includes("why") || label.length === 0;

    if (!filledCover && coverLetterText && isCoverLetterField) {
      await area.fill(coverLetterText.slice(0, 2000), { timeout: 5000 }).catch(() => {});
      filledCover = true;
      filledCount += 1;
      continue;
    }

    if (fallbackText) {
      await area.fill(fallbackText.slice(0, 1000), { timeout: 5000 }).catch(() => {});
      filledCount += 1;
    }
  }
};

const uploadResumeIfRequested = async (
  page: Page,
  resumePath?: string | null
) => {
  if (!resumePath) return;
  if (!(await fileExists(resumePath))) return;
  const input = page.locator("input[type='file']").first();
  if ((await input.count()) === 0) return;
  await input.setInputFiles(resumePath);
};

type FillProfile = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin?: string | null;
  github?: string | null;
  website?: string | null;
  resumePath?: string | null;
};

const fillCommonFields = async (
  page: Page,
  profile: FillProfile,
  coverLetterText: string,
  fallbackText: string
) => {
  await fillInput(page, ["input[type='email']", "input[name*='email' i]"], profile.email);
  await fillInput(page, ["input[type='tel']", "input[name*='phone' i]"], profile.phone);
  await fillInput(page, ["input[name*='name' i]", "input[id*='name' i]"], profile.name);
  await fillInput(page, ["input[name*='city' i]", "input[name*='location' i]"], profile.location);
  await fillInput(page, ["input[name*='linkedin' i]", "input[id*='linkedin' i]"], profile.linkedin);
  await fillInput(page, ["input[name*='github' i]", "input[id*='github' i]"], profile.github);
  await fillInput(page, ["input[name*='portfolio' i]", "input[name*='website' i]"], profile.website);

  await uploadResumeIfRequested(page, profile.resumePath);
  await fillTextareas(page, coverLetterText, fallbackText);
};

const questionSkipKeywords = [
  "email",
  "e-mail",
  "phone",
  "mobile",
  "name",
  "first name",
  "last name",
  "address",
  "city",
  "location",
  "linkedin",
  "github",
  "portfolio",
  "website",
  "resume",
  "cv",
  "cover letter",
  "cover_letter",
  "upload",
  "attach",
  "file",
  "search",
  "skip to",
];

const isSkippableQuestion = (label: string) => {
  const normalized = label.toLowerCase();
  if (normalized.length < 4) return true;
  return questionSkipKeywords.some((keyword) => normalized.includes(keyword));
};

const extractNumericAnswer = (answer: string) => {
  const match = answer.match(/-?\d+(\.\d+)?/);
  return match ? match[0] : "";
};

type OptionChoice = { value: string; text: string };

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isBlankChoice = (value: string, text: string) => {
  const cleaned = normalizeText(text || value || "");
  return (
    cleaned.length === 0 ||
    cleaned === "select" ||
    cleaned === "select an option" ||
    cleaned === "please select" ||
    cleaned.startsWith("select") ||
    cleaned.includes("choose") ||
    cleaned === "--" ||
    cleaned === "-" ||
    value === ""
  );
};

const pickBestOption = (options: OptionChoice[], answer: string) => {
  const normalizedAnswer = normalizeText(answer);
  if (!normalizedAnswer) return null;

  const yesWords = ["yes", "true", "y"];
  const noWords = ["no", "false", "n"];
  const hasYes = yesWords.some((word) => normalizedAnswer.includes(word));
  const hasNo = noWords.some((word) => normalizedAnswer.includes(word));

  let best: OptionChoice | null = null;
  let bestScore = 0;

  for (const option of options) {
    const optionText = normalizeText(option.text || option.value);
    if (!optionText) continue;
    let score = 0;

    if (hasYes && (optionText.includes("yes") || optionText.includes("true"))) {
      score = 3;
    } else if (hasNo && (optionText.includes("no") || optionText.includes("false"))) {
      score = 3;
    } else if (normalizedAnswer === optionText) {
      score = 4;
    } else if (
      normalizedAnswer.includes(optionText) ||
      optionText.includes(normalizedAnswer)
    ) {
      score = 2;
    } else {
      const tokens = normalizedAnswer.split(" ").filter(Boolean);
      const hits = tokens.filter((token) => optionText.includes(token)).length;
      score = hits / Math.max(tokens.length, 1);
    }

    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }

  return best?.value ?? best?.text ?? null;
};

const fillAIQuestions = async (
  page: Page,
  userProfile: { name: string; skills: string[]; experience: string; linkedin?: string | null; github?: string | null; website?: string | null },
  limit: number,
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  if (!isAIEnabled(providerOverride) || !aiAnswerEnabled || limit <= 0) return;

  const cache = new Map<string, string>();
  const getAnswer = async (label: string) => {
    const key = label.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const answer = await answerApplicationQuestion(
      label,
      {
        name: userProfile.name,
        skills: userProfile.skills,
        experience: userProfile.experience,
      },
      providerOverride
    );
    cache.set(key, answer);
    return answer;
  };

  // Only target input fields, NOT textareas (textareas are handled by fillTextareas/fillCommonFields with the cover letter)
  // Scope to form/modal context to avoid filling LinkedIn's global search bar
  const formContext = page.locator("form, [class*='jobs-easy-apply'], [class*='artdeco-modal'], [role='dialog']").first();
  const hasFormContext = await formContext.count() > 0;
  const root = hasFormContext ? formContext : page;
  const fields = root.locator(
    "input[type='text'], input[type='number'], input[type='url']"
  );
  const count = await fields.count();
  const otherCount = await page
    .locator("select, input[type='radio'], input[type='checkbox']")
    .count();
  if (count === 0 && otherCount === 0) return;

  let filled = 0;

  for (let i = 0; i < count && filled < limit; i += 1) {
    const field = fields.nth(i);
    const current = await field.inputValue().catch(() => "");
    if (current?.trim()) continue;

    const meta = await field.evaluate((el) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const inputType =
        input.tagName.toLowerCase() === "textarea"
          ? "textarea"
          : (input as HTMLInputElement).type || "text";
      let label =
        input.getAttribute("aria-label") ||
        input.getAttribute("placeholder") ||
        "";
      const id = input.getAttribute("id");
      if (!label && id) {
        const byFor = document.querySelector(`label[for='${id}']`);
        if (byFor?.textContent) label = byFor.textContent;
      }
      if (!label) {
        const parentLabel = input.closest("label");
        if (parentLabel?.textContent) label = parentLabel.textContent;
      }
      if (!label) {
        const legend = input.closest("fieldset")?.querySelector("legend");
        if (legend?.textContent) label = legend.textContent;
      }
      if (!label) {
        const wrapper = input.closest("div");
        const candidate = wrapper?.querySelector("label, span, p");
        if (candidate?.textContent) label = candidate.textContent;
      }
      return { label: (label ?? "").trim(), inputType };
    });

    const label = meta.label?.trim();
    if (!label || isSkippableQuestion(label)) continue;

    const lowered = label.toLowerCase();
    if (lowered.includes("linkedin") && userProfile.linkedin) {
      await field.fill(userProfile.linkedin).catch(() => {});
      filled += 1;
      continue;
    }
    if (lowered.includes("github") && userProfile.github) {
      await field.fill(userProfile.github).catch(() => {});
      filled += 1;
      continue;
    }
    if (
      (lowered.includes("portfolio") || lowered.includes("website")) &&
      userProfile.website
    ) {
      await field.fill(userProfile.website).catch(() => {});
      filled += 1;
      continue;
    }

    const rawAnswer = await getAnswer(label);
    if (!rawAnswer) continue;

    // Sanitize: strip markdown, newlines, excess whitespace
    const answer = rawAnswer
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,6}\s/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]/g, "$1")
      .replace(/\n+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!answer) continue;

    try {
      if (meta.inputType === "number" || lowered.includes("years") || lowered.includes("salary") || lowered.includes("experience")) {
        const numeric = extractNumericAnswer(answer);
        // Default to "1" for experience questions if AI returned 0, "0" for salary/CTC
        const isSalary = lowered.includes("salary") || lowered.includes("ctc") || lowered.includes("compensation") || lowered.includes("pay") || lowered.includes("expected");
        const isExperience = lowered.includes("years") || lowered.includes("experience") || lowered.includes("how long") || lowered.includes("how many");
        let finalNum: string;
        if (isSalary) {
          // For salary number fields: use AI-extracted number, default "0" (negotiable)
          finalNum = numeric || "0";
        } else if (isExperience) {
          // Never say "0" experience for a known skill
          finalNum = (numeric === "0" || !numeric) ? "1" : numeric;
        } else {
          // Generic number field
          finalNum = numeric || "1";
        }
        await log(`[fillAIQuestions] Field "${label.slice(0, 60)}" → numeric: "${finalNum}"`);
        await field.fill(finalNum, { timeout: 5000 });
      } else {
        // For text inputs, limit to 200 chars (they're not textareas)
        const truncated = answer.slice(0, 200);
        await log(`[fillAIQuestions] Field "${label.slice(0, 60)}" → "${truncated.slice(0, 80)}..."`);
        await field.fill(truncated, { timeout: 5000 });
      }
      filled += 1;
    } catch (fillErr: any) {
      await log(`[fillAIQuestions] ⚠️ Fill failed for "${label.slice(0, 40)}": ${fillErr?.message?.slice(0, 80)}`);
    }
  }

  const selects = page.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount && filled < limit; i += 1) {
    const select = selects.nth(i);
    const meta = await select.evaluate((el) => {
      const input = el as HTMLSelectElement;
      let label =
        input.getAttribute("aria-label") ||
        input.getAttribute("placeholder") ||
        "";
      const id = input.getAttribute("id");
      if (!label && id) {
        const byFor = document.querySelector(`label[for='${id}']`);
        if (byFor?.textContent) label = byFor.textContent;
      }
      if (!label) {
        const parentLabel = input.closest("label");
        if (parentLabel?.textContent) label = parentLabel.textContent;
      }
      if (!label) {
        const legend = input.closest("fieldset")?.querySelector("legend");
        if (legend?.textContent) label = legend.textContent;
      }
      if (!label) {
        const wrapper = input.closest("div");
        const candidate = wrapper?.querySelector("label, span, p");
        if (candidate?.textContent) label = candidate.textContent;
      }

      const options = Array.from(input.options).map((option) => ({
        value: option.value ?? "",
        text: option.textContent?.trim() ?? "",
      }));

      const selected = input.value ?? "";
      const selectedText = input.selectedOptions?.[0]?.textContent?.trim() ?? "";

      return { label: (label ?? "").trim(), options, selected, selectedText };
    });

    const label = meta.label?.trim();
    if (!label || isSkippableQuestion(label)) continue;

    const currentValue = meta.selected ?? "";
    const currentText = meta.selectedText ?? "";
    if (currentValue && !isBlankChoice(currentValue, currentText)) continue;

    const answer = await getAnswer(label);
    if (!answer) continue;

    const choice = pickBestOption(meta.options, answer);
    if (!choice) continue;

    await log(`[fillAIQuestions] Select "${label.slice(0, 40)}" → "${choice}"`);
    await select.selectOption(choice);
    filled += 1;
  }

  const radioGroups = await page.$$eval("input[type='radio']", (nodes) => {
    const groups = new Map<
      string,
      { label: string; options: Array<{ index: number; label: string; id: string }>; checked: boolean }
    >();
    nodes.forEach((node, index) => {
      const input = node as HTMLInputElement;
      const name = input.getAttribute("name") || "";
      if (!name) return;
      const group = groups.get(name) ?? { label: "", options: [], checked: false };
      if (input.checked) group.checked = true;

      let optionLabel = "";
      const id = input.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for='${id}']`);
        if (byFor?.textContent) optionLabel = byFor.textContent;
      }
      if (!optionLabel) {
        const parentLabel = input.closest("label");
        if (parentLabel?.textContent) optionLabel = parentLabel.textContent;
      }
      if (!optionLabel) {
        const aria = input.getAttribute("aria-label");
        if (aria) optionLabel = aria;
      }

      if (!group.label) {
        const legend = input.closest("fieldset")?.querySelector("legend");
        if (legend?.textContent) group.label = legend.textContent;
      }
      if (!group.label) {
        group.label = optionLabel;
      }

      const groupIndex = group.options.length;
      group.options.push({
        index: groupIndex,
        label: (optionLabel ?? "").trim(),
        id: input.getAttribute("id") ?? "",
      });
      groups.set(name, group);
    });

    return Array.from(groups.entries()).map(([name, group]) => ({
      name,
      label: group.label.trim(),
      options: group.options,
      checked: group.checked,
    }));
  });

  for (const group of radioGroups) {
    if (filled >= limit) break;
    if (group.checked) continue;
    if (!group.label || isSkippableQuestion(group.label)) continue;

    const answer = await getAnswer(group.label);
    if (!answer) continue;

    const options = group.options.map((option) => ({
      value: option.label,
      text: option.label,
    }));
    const choice = pickBestOption(options, answer);
    if (!choice) continue;

    const index = group.options.findIndex(
      (option) => option.label.trim().toLowerCase() === choice.trim().toLowerCase()
    );
    const fallbackIndex = group.options.findIndex((option) =>
      option.label.toLowerCase().includes(choice.toLowerCase())
    );
    const targetIndex = index >= 0 ? index : fallbackIndex;
    if (targetIndex === -1) continue;

    const target = group.options[targetIndex];
    try {
      await log(`[fillAIQuestions] Radio "${group.label.slice(0, 40)}" → "${choice}"`);
      if (target?.id) {
        await page.locator(`[id="${target.id}"]`).first().click({ force: true, timeout: 5000 });
      } else {
        const locator = page
          .locator(`input[type='radio'][name='${group.name}']`)
          .nth(targetIndex);
        await locator.click({ force: true, timeout: 5000 });
      }
      // Verify the radio was actually selected, click the label if not
      await page.waitForTimeout(300);
      const wasChecked = target?.id
        ? await page.locator(`[id="${target.id}"]`).first().isChecked().catch(() => false)
        : await page.locator(`input[type='radio'][name='${group.name}']`).nth(targetIndex).isChecked().catch(() => false);
      if (!wasChecked) {
        // Try clicking the label instead
        if (target?.id) {
          await page.locator(`label[for="${target.id}"]`).first().click({ force: true, timeout: 3000 }).catch(() => {});
        }
        await log(`[fillAIQuestions] ⚠️ Radio not checked after click, tried label fallback`);
      }
      filled += 1;
    } catch (radioErr: any) {
      await log(`[fillAIQuestions] ⚠️ Radio click failed: ${radioErr?.message?.slice(0, 60)}`);
    }
  }

  const checkboxGroups = await page.$$eval("input[type='checkbox']", (nodes) => {
    const groups = new Map<
      string,
      { label: string; options: Array<{ index: number; label: string; id: string }>; checked: boolean }
    >();
    nodes.forEach((node, index) => {
      const input = node as HTMLInputElement;
      const name = input.getAttribute("name") || input.getAttribute("id") || "";
      if (!name) return;
      const group = groups.get(name) ?? { label: "", options: [], checked: false };
      if (input.checked) group.checked = true;

      let optionLabel = "";
      const id = input.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for='${id}']`);
        if (byFor?.textContent) optionLabel = byFor.textContent;
      }
      if (!optionLabel) {
        const parentLabel = input.closest("label");
        if (parentLabel?.textContent) optionLabel = parentLabel.textContent;
      }
      if (!optionLabel) {
        const aria = input.getAttribute("aria-label");
        if (aria) optionLabel = aria;
      }

      if (!group.label) {
        const legend = input.closest("fieldset")?.querySelector("legend");
        if (legend?.textContent) group.label = legend.textContent;
      }
      if (!group.label) {
        group.label = optionLabel;
      }

      const groupIndex = group.options.length;
      group.options.push({
        index: groupIndex,
        label: (optionLabel ?? "").trim(),
        id: input.getAttribute("id") ?? "",
      });
      groups.set(name, group);
    });

    return Array.from(groups.entries()).map(([name, group]) => ({
      name,
      label: group.label.trim(),
      options: group.options,
      checked: group.checked,
    }));
  });

  for (const group of checkboxGroups) {
    if (filled >= limit) break;
    if (group.checked) continue;

    // Auto-check consent/agreement/terms checkboxes without AI
    const lbl = (group.label ?? "").toLowerCase();
    const isConsent = lbl.includes("consent") || lbl.includes("agree") || lbl.includes("terms") || lbl.includes("privacy") || lbl.includes("acknowledge") || lbl.includes("i certify") || lbl.includes("data processing") || lbl.includes("authorization");
    if (isConsent) {
      try {
        const target2 = group.options[0];
        if (target2?.id) {
          await page.locator(`[id="${target2.id}"]`).first().click({ force: true, timeout: 5000 });
        } else {
          await page.locator(`input[type='checkbox'][name='${group.name}']`).first().click({ force: true, timeout: 5000 });
        }
        await log(`[fillAIQuestions] ✅ Auto-checked consent: "${group.label.slice(0, 60)}"`);
        filled += 1;
      } catch {}
      continue;
    }

    if (!group.label || isSkippableQuestion(group.label)) continue;

    const answer = await getAnswer(group.label);
    if (!answer) continue;

    const options = group.options.map((option) => ({
      value: option.label,
      text: option.label,
    }));
    const choice = pickBestOption(options, answer);
    if (!choice) continue;

    const index = group.options.findIndex(
      (option) => option.label.trim().toLowerCase() === choice.trim().toLowerCase()
    );
    const fallbackIndex = group.options.findIndex((option) =>
      option.label.toLowerCase().includes(choice.toLowerCase())
    );
    const targetIndex = index >= 0 ? index : fallbackIndex;
    if (targetIndex === -1) continue;

    const target2 = group.options[targetIndex];
    try {
      if (target2?.id) {
        await page.locator(`[id="${target2.id}"]`).first().click({ force: true, timeout: 5000 });
      } else {
        const locator = page
          .locator(`input[type='checkbox'][name='${group.name}']`)
          .nth(targetIndex);
        await locator.click({ force: true, timeout: 5000 });
      }
      filled += 1;
    } catch {
      // Skip if click fails (toggle switch, hidden element, etc.)
    }
  }

  // Last resort: check ALL unchecked visible required checkboxes
  // These are checkboxes the above logic missed (e.g. no name attribute, aria-required)
  try {
    const unchecked = page.locator("input[type='checkbox'][required]:not(:checked), input[type='checkbox'][aria-required='true']:not(:checked)");
    const uncheckedCount = await unchecked.count();
    for (let i = 0; i < uncheckedCount; i++) {
      const cb = unchecked.nth(i);
      const visible = await cb.isVisible().catch(() => false);
      if (visible) {
        await cb.click({ force: true, timeout: 3000 }).catch(() => {});
        await log(`[fillAIQuestions] ✅ Force-checked required checkbox ${i}`);
      }
    }
  } catch {}
};

const ensurePreferencesFromResume = async (userId: string) => {
  const pref = await prisma.searchPreference.findFirst({ where: { userId } });
  const hasPrefs = pref && (pref.roles.length > 0 || pref.keywords.length > 0);

  // Always ensure scoreThreshold is reasonable (legacy records may have 0.65)
  if (hasPrefs) {
    if (pref!.scoreThreshold > 0.30) {
      return prisma.searchPreference.update({
        where: { id: pref!.id },
        data: { scoreThreshold: 0.20 },
      });
    }
    return pref!;
  }

  const resume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const parsed = (resume?.parsedData as any) ?? {};
  const roles = normalizeList(parsed.experience?.map((item: any) => item?.title));
  const keywords = normalizeList(parsed.skills);
  const locations = parsed.location ? [String(parsed.location)] : [];

  if (!roles.length && !keywords.length) {
    return pref;
  }

  if (pref) {
    return prisma.searchPreference.update({
      where: { id: pref.id },
      data: {
        roles: roles.slice(0, 6),
        keywords: keywords.slice(0, 12),
        locations: locations.slice(0, 2),
        remote: pref.remote || locations.length === 0,
      },
    });
  }

  return prisma.searchPreference.create({
    data: {
      userId,
      roles: roles.slice(0, 6),
      keywords: keywords.slice(0, 12),
      locations: locations.slice(0, 2),
      remote: locations.length === 0,
      autoApply: true,
      scoreThreshold: 0.20,
    },
  });
};

const getResumeContext = async (userId: string) => {
  const resume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const parsed = (resume?.parsedData as any) ?? {};
  const skills = normalizeList(parsed.skills);
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  const experienceSummary =
    buildExperienceSummary(experience) ||
    resume?.textContent?.slice(0, 2000) ||
    "";

  return {
    resume,
    skills,
    experienceSummary,
    fullName: parsed.fullName ?? parsed.name ?? null,
  };
};

const extractJobDescription = async (page: Page, platform: Platform) => {
  const selectors =
    platform === "LINKEDIN"
      ? [
          ".jobs-description__content",
          ".show-more-less-html__markup",
          ".description__text",
        ]
      : [
          "#jobDescriptionText",
          ".jobsearch-JobComponent-description",
          ".jobsearch-jobDescriptionText",
        ];

  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (handle) {
      const text = (await handle.innerText()).trim();
      if (text.length > 0) return text;
    }
  }

  const fallback = (await page.innerText("body")).trim();
  return fallback.slice(0, 6000);
};

const fetchJobDescription = async (
  context: BrowserContext,
  jobUrl: string,
  platform: Platform
) => {
  const detailPage = await context.newPage();
  try {
    await detailPage.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await detailPage.waitForTimeout(1500);
    return await extractJobDescription(detailPage, platform);
  } catch {
    return "";
  } finally {
    await detailPage.close().catch(() => undefined);
  }
};

const waitForLogin = async (
  page: Page,
  name: string,
  loginUrl: string,
  isLoggedIn: () => Promise<boolean>
) => {
  if (headless) {
    const headlessMessage = canRunHeaded
      ? `${name} login is required, but the worker is running headless. Set HEADLESS=false and restart the worker to sign in.`
      : `${name} login is required, but this worker has no display (headless environment). Run the worker locally with a visible browser to sign in.`;
    await publishEvent({
      jobId: name,
      type: "ERROR_OCCURRED",
      message: headlessMessage,
    });
    throw new Error(`LOGIN_UNAVAILABLE:${name}`);
  }

  console.log(`[waitForLogin] Navigating to ${loginUrl}...`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await publishEvent({
    jobId: name,
    type: "STEP_COMPLETED",
    message: `Login required for ${name}. Please sign in in the opened browser.`,
  });
  console.log(`[waitForLogin] Waiting up to ${loginWaitMs / 1000}s for ${name} login...`);

  const start = Date.now();
  while (Date.now() - start < loginWaitMs) {
    try {
      if (await isLoggedIn()) {
        console.log(`[waitForLogin] ${name} login detected!`);
        return true;
      }
    } catch (err: any) {
      console.error(`[waitForLogin] Error checking login state:`, err?.message);
      throw err;
    }
    await page.waitForTimeout(3000);
  }

  throw new Error(`LOGIN_TIMEOUT:${name}`);
};

const ensureLinkedInLogin = async (page: Page) => {
  console.log(`[ensureLinkedInLogin] Checking LinkedIn login state...`);
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const currentUrl = page.url();
  console.log(`[ensureLinkedInLogin] Current URL after navigation: ${currentUrl}`);
  // If we ended up on the feed, we're logged in
  const onFeed = currentUrl.includes("/feed") || currentUrl.includes("/mynetwork") || currentUrl.includes("/in/");
  const loginInputs = await page.locator("input[name='session_key']").count();
  const loggedIn = onFeed && loginInputs === 0;
  console.log(`[ensureLinkedInLogin] Already logged in: ${loggedIn} (onFeed=${onFeed}, loginInputs=${loginInputs})`);
  if (loggedIn) return;

  // If using real Chrome with copied cookies, give extra time for redirect
  console.log(`[ensureLinkedInLogin] Not logged in yet, waiting 5s for redirect...`);
  await page.waitForTimeout(5000);
  const afterUrl = page.url();
  const afterLoggedIn = (afterUrl.includes("/feed") || afterUrl.includes("/mynetwork")) && (await page.locator("input[name='session_key']").count()) === 0;
  console.log(`[ensureLinkedInLogin] After wait: url=${afterUrl}, loggedIn=${afterLoggedIn}`);
  if (afterLoggedIn) return;

  // Try auto-login with credentials from environment
  const linkedInEmail = process.env.LINKEDIN_EMAIL;
  const linkedInPassword = process.env.LINKEDIN_PASSWORD;
  if (linkedInEmail && linkedInPassword) {
    console.log(`[ensureLinkedInLogin] Attempting auto-login with credentials...`);
    try {
      await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
      const emailInput = page.locator("input[name='session_key']");
      const passInput = page.locator("input[name='session_password']");
      if (await emailInput.count() > 0) {
        await emailInput.fill(linkedInEmail);
        await passInput.fill(linkedInPassword);
        await page.locator("button[type='submit'], button:has-text('Sign in')").first().click();
        await page.waitForTimeout(6000);
        const postUrl = page.url();
        if (postUrl.includes("/feed") || postUrl.includes("/mynetwork") || postUrl.includes("/in/")) {
          console.log(`[ensureLinkedInLogin] ✅ Auto-login successful!`);
          return;
        }
        if (postUrl.includes("/checkpoint") || postUrl.includes("/challenge")) {
          console.log(`[ensureLinkedInLogin] ⚠️ Verification/CAPTCHA required after auto-login`);
          await publishEvent({
            jobId: "LinkedIn",
            type: "ERROR_OCCURRED",
            message: "LinkedIn requires verification. Run worker with HEADLESS=false once to complete sign-in.",
          });
        }
      }
    } catch (autoErr: any) {
      console.log(`[ensureLinkedInLogin] Auto-login failed: ${autoErr?.message?.slice(0, 100)}`);
    }
  }

  await waitForLogin(page, "LinkedIn", "https://www.linkedin.com/login", async () => {
    return (await page.locator("input[name='session_key']").count()) === 0;
  });
};

const ensureIndeedLogin = async (page: Page) => {
  await page.goto("https://www.indeed.com/", { waitUntil: "domcontentloaded" });
  const loginInputs = await page.locator("input[name='__email'], input[name='email']").count();
  if (loginInputs === 0) return;
  await waitForLogin(page, "Indeed", "https://secure.indeed.com/account/login", async () => {
    const count = await page.locator("input[name='__email'], input[name='email']").count();
    return count === 0;
  });
};

const searchLinkedIn = async (
  page: Page,
  pref: SearchPreference,
  limit: number,
  overrides?: { query?: string; location?: string; remote?: boolean; easyApplyOnly?: boolean }
) => {
  const query = overrides?.query ?? buildQuery(pref);
  const location = overrides?.location ?? pref.locations[0] ?? (pref.remote ? "Remote" : "");
  const useRemote = overrides?.remote ?? pref.remote;
  const easyApplyOnly = overrides?.easyApplyOnly ?? true;
  const params = new URLSearchParams();
  if (query) params.set("keywords", query);
  if (location) params.set("location", location);
  if (useRemote) params.set("f_WT", "2");
  if (easyApplyOnly) params.set("f_AL", "true");
  params.set("f_TPR", "r604800"); // Past 7 days — wider net for more results
  params.set("sortBy", "DD");
  const url = `https://www.linkedin.com/jobs/search/?${params.toString()}`;

  console.log(`[searchLinkedIn] Query: "${query}", Location: "${location}"`);
  console.log(`[searchLinkedIn] URL: ${url}`);

  await publishEvent({
    jobId: "LinkedIn",
    type: "STEP_COMPLETED",
    message: `Searching LinkedIn: ${query || "all"}`,
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Save debug screenshot
  const screenshotDir = `${process.cwd()}/artifacts/screenshots`;
  await Bun.write(`${screenshotDir}/.keep`, "");
  await page.screenshot({ path: `${screenshotDir}/linkedin-search.png`, fullPage: false });
  console.log(`[searchLinkedIn] Screenshot saved to artifacts/screenshots/linkedin-search.png`);

  // Scroll to load more results
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1200);
  }

  // Logged-in LinkedIn uses different selectors than public view
  // Try multiple strategies to find job cards
  const selectorStrategies = [
    // Logged-in LinkedIn (current 2024-2026 DOM)
    ".jobs-search-results-list li.ember-view",
    ".scaffold-layout__list-container li",
    "li.jobs-search-results__list-item",
    // Older logged-in selectors
    ".job-card-container",
    // Public LinkedIn (unauthenticated)
    "ul.jobs-search__results-list li",
  ];

  let bestSelector = "";
  let cardCount = 0;
  for (const sel of selectorStrategies) {
    const count = await page.locator(sel).count();
    console.log(`[searchLinkedIn] Selector "${sel}" matched ${count} elements`);
    if (count > cardCount) {
      cardCount = count;
      bestSelector = sel;
    }
  }

  if (cardCount === 0) {
    console.log(`[searchLinkedIn] No job cards found with any selector. Page title: ${await page.title()}`);
    console.log(`[searchLinkedIn] Current URL: ${page.url()}`);
    // Save full page HTML snippet for debugging
    const bodyText = await page.innerText("body").catch(() => "");
    console.log(`[searchLinkedIn] Page body preview (500 chars): ${bodyText.slice(0, 500)}`);
    return [];
  }

  console.log(`[searchLinkedIn] Using selector "${bestSelector}" with ${cardCount} cards`);

  const jobs = await page.$$eval(bestSelector, (cards, take) => {
    const results: Array<{
      title: string | null;
      company: string | null;
      location: string | null;
      url: string | null;
      easyApply: boolean;
    }> = [];

    for (const card of cards.slice(0, Number(take))) {
      // Try multiple selector patterns for each field
      const link = (
        card.querySelector("a.job-card-container__link") ??
        card.querySelector("a.job-card-list__title") ??
        card.querySelector("a[href*='/jobs/view/']") ??
        card.querySelector("a.base-card__full-link")
      ) as HTMLAnchorElement | null;

      const title =
        link?.querySelector("span")?.textContent?.trim() ??
        link?.textContent?.trim() ??
        card.querySelector("h3")?.textContent?.trim() ??
        card.querySelector("[class*='job-title']")?.textContent?.trim() ??
        null;

      const company =
        card.querySelector(".artdeco-entity-lockup__subtitle span")?.textContent?.trim() ??
        card.querySelector(".job-card-container__primary-description")?.textContent?.trim() ??
        card.querySelector("h4")?.textContent?.trim() ??
        card.querySelector("[class*='company']")?.textContent?.trim() ??
        null;

      const location =
        card.querySelector(".artdeco-entity-lockup__caption span")?.textContent?.trim() ??
        card.querySelector(".job-card-container__metadata-wrapper li")?.textContent?.trim() ??
        card.querySelector(".job-search-card__location")?.textContent?.trim() ??
        card.querySelector("[class*='location']")?.textContent?.trim() ??
        null;

      const url = link?.href ?? null;
      const text = card.textContent ?? "";
      const easyApply = text.toLowerCase().includes("easy apply");
      results.push({ title, company, location, url, easyApply });
    }

    return results;
  }, limit);

  console.log(`[searchLinkedIn] Extracted ${jobs.length} raw jobs, ${jobs.filter(j => j.url).length} with URLs`);
  if (jobs.length > 0) {
    console.log(`[searchLinkedIn] Sample: ${JSON.stringify(jobs[0])}`);
  }

  const withUrls = jobs.filter((job) => job.url);
  console.log(`[searchLinkedIn] ${withUrls.length} jobs with URLs, now validating MERN match...`);

  const filtered: Array<{
    externalId: string;
    jobUrl: string;
    title: string | null;
    company: string | null;
    location: string | null;
    easyApply: boolean;
    platform: Platform;
  }> = [];

  for (const job of withUrls) {
    const title = job.title ?? "";
    // Pre-click validation: validate title + location BEFORE navigating
    if (forceApply) {
      await log(`[searchLinkedIn] 🔧 FORCE_APPLY: bypassing validation for "${title}" @ ${job.company ?? "?"}`);
    } else {
      const validation = validateJob(title, pref, null, job.location);
      if (!validation.pass) {
        await log(`[searchLinkedIn] ❌ SKIP "${title}" @ ${job.company ?? "?"} loc="${job.location ?? "?"}" — ${validation.reason} (score=${validation.score?.match_score ?? "?"})`);
        continue;
      }
      await log(`[searchLinkedIn] ✅ MATCH "${title}" @ ${job.company ?? "?"} — score=${validation.score?.match_score ?? "?"}/100`);
    }
    filtered.push({
      externalId: `linkedin_${job.url?.split("/jobs/view/")[1]?.split("/")[0] ?? job.url}`,
      jobUrl: job.url as string,
      title: job.title,
      company: job.company,
      location: job.location,
      easyApply: job.easyApply,
      platform: "LINKEDIN" as Platform,
    });
  }

  console.log(`[searchLinkedIn] Returning ${filtered.length} matched jobs (filtered from ${withUrls.length})`);
  return filtered;
};

const searchIndeed = async (page: Page, pref: SearchPreference, limit: number) => {
  const query = buildQuery(pref);
  const location = pref.remote ? "Remote" : (pref.locations[0] ?? "");
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("l", location);
  params.set("remotejob", "032b3046-06a3-4876-8dfd-474eb5e7ed11"); // Indeed remote filter
  params.set("fromage", "7"); // Past 7 days
  const url = `https://www.indeed.com/jobs?${params.toString()}`;

  console.log(`[searchIndeed] Query: "${query}", Location: "${location}"`);
  console.log(`[searchIndeed] URL: ${url}`);

  await publishEvent({
    jobId: "Indeed",
    type: "STEP_COMPLETED",
    message: `Searching Indeed: ${query || "all"}`,
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Save debug screenshot
  const screenshotDir = `${process.cwd()}/artifacts/screenshots`;
  await page.screenshot({ path: `${screenshotDir}/indeed-search.png`, fullPage: false });
  console.log(`[searchIndeed] Screenshot saved to artifacts/screenshots/indeed-search.png`);

  const title = await page.title().catch(() => "");
  const bodyText = ((await page.textContent("body").catch(() => "")) ?? "").toLowerCase();
  if (
    title.toLowerCase().includes("blocked") ||
    bodyText.includes("access denied") ||
    bodyText.includes("unusual traffic")
  ) {
    await publishEvent({
      jobId: "Indeed",
      type: "ERROR_OCCURRED",
      message:
        "Indeed blocked automated browsing in this environment, so no Indeed jobs were collected in this run.",
    });
    console.log(`[searchIndeed] Block detected. title="${title}"`);
    return [];
  }

  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(1000);
  }

  const cardCount = await page.locator("[data-jk]").count();
  console.log(`[searchIndeed] Found ${cardCount} job cards with [data-jk]`);

  if (cardCount === 0) {
    console.log(`[searchIndeed] No job cards found. Page title: ${await page.title()}`);
    console.log(`[searchIndeed] Current URL: ${page.url()}`);
    await publishEvent({
      jobId: "Indeed",
      type: "STEP_COMPLETED",
      message: "Indeed returned no job cards for this query.",
    });
    return [];
  }

  const jobs = await page.$$eval("[data-jk]", (cards, take) => {
    const results: Array<{
      title: string | null;
      company: string | null;
      location: string | null;
      jk: string | null;
    }> = [];

    for (const card of Array.from(cards).slice(0, Number(take))) {
      const jk = card.getAttribute("data-jk");
      const title =
        card.querySelector("h2 a span")?.textContent?.trim() ??
        card.querySelector("h2 span")?.textContent?.trim() ??
        null;
      const company =
        card.querySelector("[data-testid='company-name']")?.textContent?.trim() ??
        card.querySelector(".companyName")?.textContent?.trim() ??
        null;
      const location =
        card.querySelector("[data-testid='text-location']")?.textContent?.trim() ??
        card.querySelector(".companyLocation")?.textContent?.trim() ??
        null;

      results.push({ title, company, location, jk });
    }

    return results;
  }, limit);

  console.log(`[searchIndeed] Extracted ${jobs.length} jobs, ${jobs.filter(j => j.jk).length} with JK`);
  if (jobs.length > 0) {
    console.log(`[searchIndeed] Sample: ${JSON.stringify(jobs[0])}`);
  }

  const withJk = jobs.filter((job) => job.jk);
  console.log(`[searchIndeed] ${withJk.length} jobs with JK, now validating match...`);

  const validatedResults: Array<{
    externalId: string;
    jobUrl: string;
    title: string | null;
    company: string | null;
    location: string | null;
    platform: Platform;
  }> = [];

  for (const job of withJk) {
    const title = job.title ?? "";
    if (forceApply) {
      await log(`[searchIndeed] 🔧 FORCE_APPLY: bypassing validation for "${title}" @ ${job.company ?? "?"}`);
    } else {
      const validation = validateJob(title, pref, null, job.location);
      if (!validation.pass) {
        await log(`[searchIndeed] ❌ SKIP "${title}" @ ${job.company ?? "?"} loc="${job.location ?? "?"}" — ${validation.reason} (score=${validation.score?.match_score ?? "?"})`);
        continue;
      }
      await log(`[searchIndeed] ✅ MATCH "${title}" @ ${job.company ?? "?"} — score=${validation.score?.match_score ?? "?"}/100`);
    }
    validatedResults.push({
      externalId: `indeed_${job.jk}`,
      jobUrl: `https://www.indeed.com/viewjob?jk=${job.jk}`,
      title: job.title,
      company: job.company,
      location: job.location,
      platform: "INDEED" as Platform,
    });
  }

  console.log(`[searchIndeed] Returning ${validatedResults.length} matched jobs (filtered from ${withJk.length})`);
  return validatedResults;
};

const queueJob = async (
  pref: SearchPreference,
  job: {
  externalId: string;
  jobUrl: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  platform: Platform;
  easyApply?: boolean;
  description?: string | null;
  },
  batchId: string,
  resumeContext: {
    skills: string[];
    experienceSummary: string;
  },
  providerOverride?: "auto" | "openai" | "gemini",
  skipStream = false
) => {
  try {
    console.log(`[queueJob] Saving: ${job.title ?? "untitled"} @ ${job.company ?? "unknown"} (${job.platform})`);
    const createdJob = await prisma.job.create({
      data: {
        userId: pref.userId,
        externalId: job.externalId,
        platform: job.platform,
        jobUrl: job.jobUrl,
        title: job.title ?? null,
        company: job.company ?? null,
        location: job.location ?? null,
        rawDescription: job.description ?? null,
      },
    });

    let score = scoreJob(job, pref);
    let reasoning: string | undefined;
    if (
      isAIEnabled(providerOverride) &&
      aiScoringEnabled &&
      job.description &&
      resumeContext.skills.length
    ) {
      const aiResult = await scoreJobMatch(
        job.description,
        resumeContext.skills,
        resumeContext.experienceSummary,
        providerOverride
      );
      score = aiResult.score;
      reasoning = aiResult.reasoning;
    }
    await prisma.jobMatch.create({
      data: {
        userId: pref.userId,
        jobId: createdJob.id,
        score,
        rationale: { easyApply: job.easyApply ?? false, reasoning },
      },
    });

    await prisma.jobImportItem.create({
      data: {
        batchId,
        jobUrl: job.jobUrl,
        platform: job.platform,
        status: "CREATED",
        jobId: createdJob.id,
      },
    });

    if (pref.autoApply && (forceApply || score >= pref.scoreThreshold)) {
      const application = await prisma.application.create({
        data: {
          userId: pref.userId,
          jobId: createdJob.id,
          status: "QUEUED",
        },
      });

      if (!skipStream) {
        await redis.xadd(
          APPLICATION_STREAM,
          "*",
          "payload",
          JSON.stringify({
            applicationId: application.id,
            jobId: createdJob.id,
            userId: pref.userId,
            jobUrl: createdJob.jobUrl,
            platform: createdJob.platform,
            attempts: 0,
          })
        );
      }

      await publishEvent({
        jobId: application.id,
        type: "JOB_STARTED",
        message: `Queued ${job.title ?? job.jobUrl} (${Math.round(score * 100)}%)`,
      });

      return { application, createdJob };
    }
  } catch (err: any) {
    if (err?.code === "P2002") {
      await prisma.jobImportItem.create({
        data: {
          batchId,
          jobUrl: job.jobUrl,
          platform: job.platform,
          status: "DUPLICATE",
        },
      });
    } else {
      await publishEvent({
        jobId: pref.userId,
        type: "ERROR_OCCURRED",
        message: err?.message ?? "Failed to queue job",
      });
      await prisma.jobImportItem.create({
        data: {
          batchId,
          jobUrl: job.jobUrl,
          platform: job.platform,
          status: "FAILED",
          error: err?.message ?? "Failed to queue job",
        },
      });
    }
  }

  return null;
};

export const runFullAutomation = async (userId: string) => {
  console.log(`[runFullAutomation] Starting for user: ${userId}`);
  const pref = await ensurePreferencesFromResume(userId);
  if (!pref) {
    console.log(`[runFullAutomation] No preferences found, aborting`);
    await publishEvent({
      jobId: userId,
      type: "ERROR_OCCURRED",
      message: "No preferences set. Upload a resume first.",
    });
    return;
  }
  console.log(`[runFullAutomation] Preferences loaded - roles: ${pref.roles.join(", ")}, keywords: ${pref.keywords.slice(0, 5).join(", ")}`);

  await publishEvent({
    jobId: userId,
    type: "STEP_COMPLETED",
    message: `Preferences loaded: ${pref.roles.slice(0, 3).join(", ")} · ${pref.keywords.slice(0, 5).join(", ")}`,
  });

  const [resumeContext, user] = await Promise.all([
    getResumeContext(userId),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  const providerOverride =
    user?.aiProvider === "OPENAI"
      ? "openai"
      : user?.aiProvider === "GEMINI"
      ? "gemini"
      : undefined;
  resumeTailorCount = 0;

  await publishEvent({
    jobId: userId,
    type: "STEP_COMPLETED",
    message: "Launching browser...",
  });

  console.log(`[runFullAutomation] Launching Chrome (headless=${headless})...`);
  const context = await getContext(userId);
  console.log(`[runFullAutomation] Chrome launched, opening page...`);

  await publishEvent({
    jobId: userId,
    type: "STEP_COMPLETED",
    message: "Browser launched. Signing into LinkedIn...",
  });

  const page = await context.newPage();

  try {
    const batch = await prisma.jobImportBatch.create({
      data: {
        userId,
        source: "DISCOVERY",
        status: "PROCESSING",
      },
    });

    try {
      let browserDiscoveredCount = 0;
      let queuedApplicationCount = 0;
      let fallbackTriggered = false;

      let linkedInJobs: Awaited<ReturnType<typeof searchLinkedIn>> = [];
      try {
        await ensureLinkedInLogin(page);
        // Build search combinations: queries x remote locations only (Rule 1: fully remote)
        const queries = buildMultipleQueries(pref);
        const searchCombos: Array<{ query: string; location: string; remote: boolean; easyApplyOnly: boolean }> = [];
        // Round 1: Each query with "Remote" (strict remote filter), Easy Apply only
        for (const q of queries) {
          searchCombos.push({ query: q, location: "Remote", remote: true, easyApplyOnly: true });
        }
        // Round 2: Each query with "Worldwide", Easy Apply only
        for (const q of queries) {
          searchCombos.push({ query: q, location: "Worldwide", remote: true, easyApplyOnly: true });
        }
        // Round 3: First query with "Remote", no Easy Apply filter (find all apply types)
        searchCombos.push({ query: queries[0] ?? "Full Stack Developer", location: "Remote", remote: true, easyApplyOnly: false });
        // Round 4: Search for full-time roles explicitly
        for (const q of queries.slice(0, 2)) {
          searchCombos.push({ query: `${q} full time`, location: "Remote", remote: true, easyApplyOnly: false });
        }

        const seenUrls = new Set<string>();
        const normalizeJobUrl = (url: string) => {
          // Extract the LinkedIn job ID to deduplicate by job, not tracking params
          const match = url.match(/\/jobs\/view\/(\d+)/);
          return match ? match[1] : url;
        };
        for (const combo of searchCombos) {
          await log(`[runFullAutomation] LinkedIn search: q="${combo.query}" loc="${combo.location}" remote=${combo.remote} easyApply=${combo.easyApplyOnly}`);
          const results = await searchLinkedIn(page, pref, 25, {
            query: combo.query,
            location: combo.location,
            remote: combo.remote,
            easyApplyOnly: combo.easyApplyOnly,
          });
          for (const job of results) {
            const jobKey = normalizeJobUrl(job.jobUrl);
            if (!seenUrls.has(jobKey)) {
              seenUrls.add(jobKey);
              linkedInJobs.push(job);
            }
          }
          await log(`[runFullAutomation] Total unique LinkedIn jobs so far: ${linkedInJobs.length}`);
          if (linkedInJobs.length >= 10) break; // enough jobs
          await sleep(2000);
        }
      } catch (err: any) {
        const msg = err?.message ?? "";
        if (msg.includes("LOGIN_TIMEOUT") || msg.includes("LOGIN_UNAVAILABLE")) {
          const loginMessage = msg.includes("LOGIN_UNAVAILABLE")
            ? "LinkedIn skipped: set LINKEDIN_EMAIL & LINKEDIN_PASSWORD env vars, or run once with HEADLESS=false to sign in. Trying other sources..."
            : "LinkedIn login timed out – skipping. Trying other sources...";
          console.log(`[runFullAutomation] ${loginMessage}`);
          await publishEvent({
            jobId: userId,
            type: "STEP_COMPLETED",
            message: loginMessage,
          });
        } else {
          console.error(`[runFullAutomation] LinkedIn error:`, msg);
        }
      }
      browserDiscoveredCount += linkedInJobs.length;

      // Build profile for direct application
      const resume = resumeContext.resume;
      const parsed = (resume?.parsedData as any) ?? {};
      let resolvedResumePath = resume?.storageUrl ?? null;
      if (resolvedResumePath?.startsWith("/app/")) {
        resolvedResumePath = path.join(rootDir, resolvedResumePath.replace(/^\/app\//, ""));
      }
      const profile: FillProfile = {
        name: parsed.fullName ?? user?.fullName ?? "Applicant",
        email: parsed.email ?? user?.email ?? null,
        phone: parsed.phone ?? null,
        location: parsed.location ?? null,
        linkedin: parsed.linkedin ?? null,
        github: parsed.github ?? null,
        website: parsed.website ?? null,
        resumePath: resolvedResumePath,
      };
      const experienceSummary = resumeContext.experienceSummary;

      let aiCount = 0;
      for (const job of linkedInJobs) {
        const description =
          isAIEnabled(providerOverride) && aiScoringEnabled && aiCount < aiScoreLimit
            ? await fetchJobDescription(context, job.jobUrl, job.platform)
            : null;
        if (description) aiCount += 1;

        // Deep validation with description + location + scoring
        if (forceApply) {
          await log(`[runFullAutomation] 🔧 FORCE_APPLY: bypassing deep validation for "${job.title}"`);
        } else if (description && description.length > 50) {
          const descValidation = validateJob(job.title ?? "", pref, description, job.location ?? null);
          const s = descValidation.score;
          if (!descValidation.pass) {
            await log(`[runFullAutomation] ❌ DEEP SKIP "${job.title}" — ${descValidation.reason} | score=${s?.match_score ?? "?"}/100 confidence=${s?.confidence ?? "?"} missing=[${s?.missing_skills?.join(", ") ?? ""}]`);
            await sleep(400);
            continue;
          }
          await log(`[runFullAutomation] ✅ DEEP MATCH "${job.title}" — score=${s?.match_score ?? "?"}/100 confidence=${s?.confidence ?? "?"} reasons=[${s?.reasons?.join("; ") ?? ""}]`);
        }

        const queued = await queueJob(
          pref,
          { ...job, description },
          batch.id,
          resumeContext,
          providerOverride,
          true // skipStream — we apply directly below
        );
        if (queued?.application) {
          queuedApplicationCount += 1;
        }

        // Apply directly using the same browser session
        if (queued?.application && job.platform === "LINKEDIN") {
          const { application, createdJob } = queued;
          try {
            await log(`[runFullAutomation] 🚀 Applying directly: "${job.title}" @ ${job.company}`);
            await publishEvent({
              jobId: application.id,
              type: "STEP_COMPLETED",
              message: `Applying to "${job.title}" @ ${job.company}...`,
            });
            await prisma.application.update({
              where: { id: application.id },
              data: { status: "PROCESSING" },
            });

            // Navigate to the job page
            const cleanUrl = job.jobUrl.split("?")[0];
            await log(`[runFullAutomation] Navigating to: ${cleanUrl}`);
            await ensureLinkedInLogin(page);
            try {
              await page.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            } catch (navErr: any) {
              await log(`[runFullAutomation] First goto failed, retrying...`);
              await page.waitForTimeout(2000);
              await page.goto(cleanUrl, { waitUntil: "commit", timeout: 30000 });
            }
            await log(`[runFullAutomation] Page loaded: ${page.url()}`);

            // URL validation
            const curUrl = page.url();
            if (!curUrl.includes("/jobs/") && !curUrl.includes("/view/")) {
              await log(`[runFullAutomation] ❌ URL validation failed: ${curUrl}`);
              await prisma.application.update({ where: { id: application.id }, data: { status: "FAILED", error: "Invalid URL" } });
              continue;
            }

            await page.waitForTimeout(2000);

            // Generate cover letter if enabled
            let coverLetterText = "";
            if (coverLetterEnabled && isAIEnabled(providerOverride) && (description || createdJob.rawDescription)) {
              const desc = description || createdJob.rawDescription || "";
              const content = await generateCoverLetter(
                profile.name ?? "Applicant",
                experienceSummary,
                job.title ?? "Role",
                job.company ?? "Company",
                desc,
                providerOverride
              );
              if (content) {
                await prisma.coverLetter.upsert({
                  where: { applicationId: application.id },
                  update: { content },
                  create: { userId, applicationId: application.id, content },
                });
                coverLetterText = content;
              }
            }

            // Apply!
            const result = await applyLinkedIn(
              page,
              application.id,
              profile,
              coverLetterText,
              experienceSummary,
              resumeContext,
              providerOverride
            );

            await prisma.application.update({
              where: { id: application.id },
              data: {
                status: result === "APPLIED" ? "APPLIED"
                  : result === "FAILED" ? "FAILED"
                  : "MANUAL_INTERVENTION",
                ...(result === "FAILED" ? { error: "Job expired or already applied" } : {}),
              },
            });

            await sendStatusNotification({
              userId,
              applicationId: application.id,
              status: result === "APPLIED" ? "APPLIED"
                : result === "FAILED" ? "FAILED"
                : "MANUAL_INTERVENTION",
              title: job.title ?? null,
              company: job.company ?? null,
              jobUrl: job.jobUrl,
            });

            await log(`[runFullAutomation] ✅ Result for "${job.title}": ${result}`);
            const resultEmoji = result === "APPLIED" ? "✅" : result === "FAILED" ? "❌" : "⚠️";
            await publishEvent({
              jobId: application.id,
              type: result === "APPLIED" ? "STEP_COMPLETED" : "ERROR_OCCURRED",
              message: `${resultEmoji} ${result}: "${job.title}" @ ${job.company}`,
            });

            // Message the job poster after successful application
            if (result === "APPLIED") {
              await page.goto(job.jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
              await page.waitForTimeout(1500);
              await messageJobPoster(
                page,
                application.id,
                profile.name ?? "Applicant",
                job.title ?? "the role",
                job.company ?? "your company",
                resumeContext.skills,
                providerOverride
              );
            }
          } catch (appErr: any) {
            await log(`[runFullAutomation] ❌ Apply error for "${job.title}": ${appErr?.message?.slice(0, 200)}`);
            await prisma.application.update({
              where: { id: application.id },
              data: { status: "FAILED", error: appErr?.message ?? "Application failed" },
            });
          }
          await sleep(2000);
        } else {
          await sleep(800);
        }
      }

      let indeedJobs: Awaited<ReturnType<typeof searchIndeed>> = [];
      try {
        await ensureIndeedLogin(page);
        indeedJobs = await searchIndeed(page, pref, 25);
      } catch (err: any) {
        const msg = err?.message ?? "";
        if (msg.includes("LOGIN_TIMEOUT") || msg.includes("LOGIN_UNAVAILABLE")) {
          const loginMessage = msg.includes("LOGIN_UNAVAILABLE")
            ? "Indeed browser skipped (headless). Indeed RSS + 7 other API sources are still active."
            : "Indeed login timed out. Indeed RSS + 7 other API sources are still active.";
          console.log(`[runFullAutomation] ${loginMessage}`);
          await publishEvent({
            jobId: userId,
            type: "STEP_COMPLETED",
            message: loginMessage,
          });
        } else {
          console.error(`[runFullAutomation] Indeed error:`, msg);
        }
      }
      browserDiscoveredCount += indeedJobs.length;

      for (const job of indeedJobs) {
        const description =
          isAIEnabled(providerOverride) && aiScoringEnabled && aiCount < aiScoreLimit
            ? await fetchJobDescription(context, job.jobUrl, job.platform)
            : null;
        if (description) aiCount += 1;

        // Deep validation with description
        if (description && description.length > 50) {
          const descValidation = validateJob(job.title ?? "", pref, description);
          if (!descValidation.pass) {
            await log(`[runFullAutomation] ❌ DEEP SKIP Indeed "${job.title}" — ${descValidation.reason}`);
            await sleep(400);
            continue;
          }
          await log(`[runFullAutomation] ✅ DEEP MATCH Indeed "${job.title}" — description validated`);
        }

        const queued = await queueJob(
          pref,
          { ...job, description },
          batch.id,
          resumeContext,
          providerOverride,
          false // Indeed jobs go through stream — they need a separate browser flow
        );
        if (queued?.application) {
          queuedApplicationCount += 1;
        }
        await sleep(800);
      }

      if (browserDiscoveredCount === 0) {
        await publishEvent({
          jobId: userId,
          type: "STEP_COMPLETED",
          message:
            "No jobs from LinkedIn/Indeed browser search. Running discovery from 12 public APIs (Remotive, Arbeitnow, RemoteOK, Himalayas, Jobicy, Indeed RSS, The Muse, Wellfound, Naukri, YC Startups, Adzuna, Glassdoor).",
        });
        try {
          await runDiscoveryNow(userId);
          fallbackTriggered = true;
          await publishEvent({
            jobId: userId,
            type: "STEP_COMPLETED",
            message: "Discovery finished across 12 job APIs (Remotive, Arbeitnow, RemoteOK, Himalayas, Jobicy, Indeed RSS, The Muse, Wellfound, Naukri, YC Startups, Adzuna, Glassdoor).",
          });
        } catch (fallbackErr: any) {
          await publishEvent({
            jobId: userId,
            type: "ERROR_OCCURRED",
            message: `Fallback discovery failed: ${fallbackErr?.message ?? "unknown error"}`,
          });
        }
      }

      await prisma.jobImportBatch.update({
        where: { id: batch.id },
        data: { status: "COMPLETED" },
      });

      await publishEvent({
        jobId: userId,
        type: "STEP_COMPLETED",
        message: `Discovery complete. Browser jobs: ${browserDiscoveredCount}. Applications queued: ${queuedApplicationCount}.${fallbackTriggered ? " Public fallback discovery was also triggered." : ""}`,
      });
    } catch (err: any) {
      await prisma.jobImportBatch.update({
        where: { id: batch.id },
        data: { status: "FAILED" },
      });
      throw err;
    }
  } finally {
    await page.close().catch(() => undefined);
  }
};

const applyLinkedIn = async (
  page: Page,
  applicationId: string,
  profile: FillProfile,
  coverLetterText: string,
  fallbackText: string,
  resumeContext: { skills: string[]; experienceSummary: string },
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  await log(`[applyLinkedIn] Starting for ${applicationId}`);
  await log(`[applyLinkedIn] Current URL: ${page.url()}`);

  // Wait for the job detail page to fully load
  await page.waitForTimeout(4000);

  // Take a screenshot of the job page for debugging
  await page.screenshot({ path: `${process.cwd()}/artifacts/screenshots/linkedin-job-${applicationId.slice(0, 8)}.png` }).catch(() => {});

  // Check ONLY for definitively closed jobs first
  const pageText = await page.textContent("body").catch(() => "") ?? "";
  if (pageText.includes("No longer accepting applications")) {
    await log(`[applyLinkedIn] Job is CLOSED — "No longer accepting applications"`);
    await publishEvent({
      jobId: applicationId,
      type: "ERROR_OCCURRED",
      message: "Job is no longer accepting applications (expired).",
    });
    return "FAILED" as const;
  }

  // NOTE: Do NOT check for "Application submitted" or "Application status" here.
  // LinkedIn shows "Application status" on many pages even when you haven't applied.
  // Instead, we try to find and click the Easy Apply button. If no button exists AND
  // "Application submitted" is present, only then we mark as already applied.

  // Try to find Easy Apply button/link with proper waiting
  // LinkedIn 2025+ uses <a> tags for Easy Apply instead of <button>
  const easyApplySelectors = [
    "a[aria-label='Easy Apply to this job']",
    "a[href*='openSDUIApplyFlow']",
    "a[aria-label*='Easy Apply']",
    "a:has-text('Easy Apply')",
    "button[aria-label*='Easy Apply']",
    "button.jobs-apply-button",
    ".jobs-apply-button",
    "button:has-text('Easy Apply')",
    "button:has-text('Apply now')",
    "button:has-text('Apply')",
  ];
  let easyApply: any = null;
  for (const sel of easyApplySelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Double-check: if it's an <a>, verify it's not a job card link
        const tagName = await loc.evaluate((el: HTMLElement) => el.tagName).catch(() => "");
        const href = await loc.getAttribute("href").catch(() => "") ?? "";
        const text = await loc.textContent().catch(() => "") ?? "";
        await log(`[applyLinkedIn] Candidate: tag=${tagName} text="${text.trim().slice(0, 50)}" href=${href.slice(0, 80)} sel=${sel}`);
        if (tagName === "A" && (href.includes("similar-jobs") || href.includes("collections"))) {
          await log(`[applyLinkedIn] Skipping job card link for selector: ${sel}`);
          continue;
        }
        easyApply = loc;
        await log(`[applyLinkedIn] ✅ Found Easy Apply element with selector: ${sel}`);
        break;
      }
    } catch (e: any) {
      await log(`[applyLinkedIn] Selector ${sel} error: ${e?.message?.slice(0, 60)}`);
    }
  }

  if (!easyApply) {
    // No Easy Apply button found — now check if we already applied
    if (pageText.includes("Application submitted") || pageText.includes("Applied ")) {
      await log(`[applyLinkedIn] No Easy Apply button AND "Application submitted" found — already applied`);
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: "Already applied to this job.",
      });
      return "APPLIED" as const;
    }

    // Dump all buttons and links for debugging
    const allElements = await page.$$eval("button, a", (els) =>
      els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => ({
        tag: e.tagName,
        text: (e.textContent ?? "").trim().slice(0, 50),
        aria: e.getAttribute("aria-label")?.slice(0, 50) ?? "",
        href: (e as HTMLAnchorElement).href?.slice(0, 80) ?? "",
      })).filter(e => e.text.toLowerCase().includes("apply") || e.aria.toLowerCase().includes("apply"))
    ).catch(() => []);
    await log(`[applyLinkedIn] Apply-related elements on page: ${JSON.stringify(allElements)}`);

    // Save screenshot for debugging
    await page.screenshot({ path: `${process.cwd()}/artifacts/screenshots/linkedin-no-easyapply-${applicationId.slice(0, 8)}.png` }).catch(() => {});
    await log(`[applyLinkedIn] Easy Apply button NOT found. URL: ${page.url()}`);
    await publishEvent({
      jobId: applicationId,
      type: "ERROR_OCCURRED",
      message: "Easy Apply not found. Manual intervention required.",
    });
    return "MANUAL" as const;
  }

  await log(`[applyLinkedIn] 🎯 About to CLICK Easy Apply button...`);

  // For <a> Easy Apply links, get the href and navigate directly to avoid clicking wrong element
  const easyApplyTag = await easyApply.evaluate((el: HTMLElement) => el.tagName).catch(() => "");
  const easyApplyHref = await easyApply.getAttribute("href").catch(() => "") ?? "";
  await log(`[applyLinkedIn] Easy Apply element: tag=${easyApplyTag} href=${easyApplyHref.slice(0, 100)}`);

  if (easyApplyTag === "A" && easyApplyHref && easyApplyHref.includes("openSDUIApplyFlow")) {
    // Navigate directly to the apply flow URL
    const applyUrl = easyApplyHref.startsWith("http") ? easyApplyHref : `https://www.linkedin.com${easyApplyHref}`;
    await log(`[applyLinkedIn] Navigating to Easy Apply SDUI flow: ${applyUrl.slice(0, 120)}`);
    await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } else {
    await easyApply.click();
  }
  await log(`[applyLinkedIn] Easy Apply activated, waiting for form...`);
  await page.waitForTimeout(3000);

  // LinkedIn may navigate to a new apply page or open a modal
  const currentUrl = page.url();
  await log(`[applyLinkedIn] Post-apply URL: ${currentUrl}`);

  // Wait for either a modal or the SDUI apply form to appear
  try {
    await page.waitForSelector(
      "[class*='jobs-easy-apply'], [class*='artdeco-modal'], form, [data-test-modal], [role='dialog']",
      { timeout: 5000 }
    ).catch(() => {});
  } catch {}
  await page.waitForTimeout(1000);

  // Upload resume if there's a file input in the modal
  if (profile.resumePath) {
    const fileInput = page.locator("input[type='file']").first();
    if (await fileInput.count() > 0) {
      try {
        await fileInput.setInputFiles(profile.resumePath);
        await log(`[applyLinkedIn] Uploaded resume: ${profile.resumePath}`);
        await page.waitForTimeout(1000);
      } catch (e: any) {
        await log(`[applyLinkedIn] Resume upload failed: ${e?.message}`);
      }
    }
  }

  const MAX_STEPS = 7;
  const STEP_TIMEOUT_MS = 15000; // 15 seconds max per page
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const stepStart = Date.now();
    await log(`[applyLinkedIn] Step ${step + 1}/${MAX_STEPS}: filling fields...`);

    // Check if the modal/page is still alive
    try {
      await page.evaluate(() => document.readyState);
    } catch {
      await log(`[applyLinkedIn] ❌ Page context dead at step ${step + 1}`);
      return "MANUAL" as const;
    }

    await fillCommonFields(page, profile, coverLetterText, fallbackText);
    await fillAIQuestions(
      page,
      {
        name: profile.name ?? "Applicant",
        skills: resumeContext.skills,
        experience: resumeContext.experienceSummary,
        linkedin: profile.linkedin,
        github: profile.github,
        website: profile.website,
      },
      aiAnswerLimit,
      providerOverride
    );

    // ── FALLBACK: Force-fill any blank required select with first non-blank option ──
    try {
      const blankSelects = await page.$$eval("select[required], select[aria-required='true']", (selects) => {
        return selects
          .filter(sel => {
            const s = sel as HTMLSelectElement;
            const val = s.value ?? "";
            const text = s.selectedOptions?.[0]?.textContent?.trim()?.toLowerCase() ?? "";
            return (!val || val === "" || text === "select" || text.startsWith("select") || text === "--" || text === "") && (sel as HTMLElement).offsetParent !== null;
          })
          .map(sel => {
            const s = sel as HTMLSelectElement;
            const options = Array.from(s.options)
              .map(o => ({ value: o.value, text: (o.textContent ?? "").trim() }))
              .filter(o => o.value && o.text && !o.text.toLowerCase().startsWith("select") && o.text !== "--" && o.text !== "-");
            return {
              id: s.getAttribute("id") ?? "",
              name: s.getAttribute("name") ?? "",
              label: s.getAttribute("aria-label") ?? "",
              firstOption: options[0]?.value ?? null,
              firstText: options[0]?.text ?? null,
            };
          })
          .filter(s => s.firstOption !== null);
      });

      for (const sel of blankSelects) {
        const locator = sel.id
          ? page.locator(`select[id="${sel.id}"]`).first()
          : sel.name
          ? page.locator(`select[name="${sel.name}"]`).first()
          : null;
        if (locator && sel.firstOption) {
          await locator.selectOption(sel.firstOption).catch(() => {});
          await log(`[applyLinkedIn] 🔧 Force-filled blank select "${sel.label || sel.name}" → "${sel.firstText}"`);
        }
      }
    } catch {}

    // ── FALLBACK: Check unchecked required radios — if a group has no selection, pick first ──
    try {
      const uncheckedRadioGroups = await page.$$eval("input[type='radio'][required]:not(:checked), input[type='radio'][aria-required='true']:not(:checked)", (nodes) => {
        const groupNames = new Set<string>();
        const result: Array<{ name: string; id: string }> = [];
        for (const node of nodes) {
          const input = node as HTMLInputElement;
          const name = input.getAttribute("name") ?? "";
          if (!name || groupNames.has(name)) continue;
          // Check if ANY radio in this group is checked
          const anyChecked = document.querySelector(`input[type='radio'][name='${name}']:checked`);
          if (anyChecked) { groupNames.add(name); continue; }
          groupNames.add(name);
          result.push({ name, id: input.getAttribute("id") ?? "" });
        }
        return result;
      });

      for (const group of uncheckedRadioGroups) {
        // Click the first option in the group
        const firstRadio = page.locator(`input[type='radio'][name='${group.name}']`).first();
        await firstRadio.click({ force: true, timeout: 3000 }).catch(() => {});
        await log(`[applyLinkedIn] 🔧 Force-selected first radio in group "${group.name}"`);
      }
    } catch {}

    // Log what's visible for debugging
    const visibleBtns = await page.$$eval("button, a[role='button']", (els) =>
      els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => ({
        tag: e.tagName, text: (e.textContent ?? "").trim().slice(0, 40),
        aria: e.getAttribute("aria-label")?.slice(0, 40) ?? "",
      }))
    ).catch(() => []);
    await log(`[applyLinkedIn] Step ${step + 1}: visible buttons: ${JSON.stringify(visibleBtns.filter(b => b.text || b.aria).slice(0, 10))}`);

    // ── 1. FILL: Check for empty required fields ──
    const emptyRequiredFields = await page.$$eval(
      "input[required], select[required], textarea[required], [aria-required='true']",
      (els) => els.filter(e => {
        const el = e as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const val = el.value ?? "";
        return !val.trim() && (e as HTMLElement).offsetParent !== null; // only visible ones
      }).map(e => {
        const el = e as HTMLInputElement;
        return {
          tag: e.tagName,
          type: el.type || "",
          label: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "",
          id: el.getAttribute("id") || "",
        };
      })
    ).catch(() => []);

    // Check for validation errors
    const validationErrors = await page.$$eval(
      "[data-test-form-element-error], .artdeco-inline-feedback--error, .fb-form-element__error-text, [class*='error'], [role='alert']",
      (els) => els.filter(e => (e as HTMLElement).offsetParent !== null && (e.textContent ?? "").trim().length > 0)
        .map(e => (e.textContent ?? "").trim().slice(0, 80))
    ).catch(() => []);

    const allRequiredFilled = emptyRequiredFields.length === 0 && validationErrors.length === 0;

    if (emptyRequiredFields.length > 0) {
      await log(`[applyLinkedIn] ⚠️ FILL: Empty required fields: ${JSON.stringify(emptyRequiredFields.slice(0, 5))}`);
    }
    if (validationErrors.length > 0) {
      await log(`[applyLinkedIn] ⚠️ FILL: Validation errors on step ${step + 1}: ${JSON.stringify(validationErrors.slice(0, 5))}`);
    }

    // If required fields are NOT filled, give a brief pause (the fallbacks above already ran)
    if (!allRequiredFilled && step < MAX_STEPS - 1) {
      await page.waitForTimeout(500);
    }

    // ── Determine navigation action: SUBMIT > REVIEW > NEXT > STOP ──

    // ── 2. SUBMIT: Check for Submit button (highest priority) ──
    const submitSelectors = [
      "button[aria-label*='Submit application']",
      "button:has-text('Submit application')",
      "button:has-text('Submit')",
      "a[aria-label*='Submit application']",
      "footer button:has-text('Submit')",
    ];
    let submitFound = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await log(`[applyLinkedIn] → SUBMIT found`);
        submitFound = true;
        if (!autoSubmit) {
          await log(`[applyLinkedIn] AUTO_SUBMIT is off — stopping at review`);
          await publishEvent({
            jobId: applicationId,
            type: "STEP_COMPLETED",
            message: "Reached final review. Please submit manually.",
          });
          return "MANUAL" as const;
        }
        await btn.click();
        await log(`[applyLinkedIn] Clicked Submit!`);
        await page.waitForTimeout(3000);
        // Check for success confirmation
        const success = await page.locator("h2:has-text('Application sent'), .artdeco-inline-feedback--success").isVisible({ timeout: 3000 }).catch(() => false);
        await log(`[applyLinkedIn] Application success confirmation: ${success}`);
        return "APPLIED" as const;
      }
    }

    // ── 3. REVIEW: Check for Review button ──
    const reviewBtn = page.locator("button[aria-label*='Review your application'], button[aria-label*='Review'], button:has-text('Review your application')").first();
    if (await reviewBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await log(`[applyLinkedIn] → REVIEW: Clicking Review...`);
      await reviewBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // After clicking Review, check if validation blocked it
      const postReviewErrors = await page.$$eval(
        "[data-test-form-element-error], .artdeco-inline-feedback--error, .fb-form-element__error-text, [class*='error'], [role='alert']",
        (els) => els.filter(e => (e as HTMLElement).offsetParent !== null && (e.textContent ?? "").trim().length > 0)
          .map(e => (e.textContent ?? "").trim().slice(0, 80))
      ).catch(() => []);
      if (postReviewErrors.length > 0) {
        await log(`[applyLinkedIn] ⚠️ Review blocked by errors: ${JSON.stringify(postReviewErrors.slice(0, 3))}`);
        // Errors mean required fields are still blank — the main loop fallbacks will handle them on next iteration
      }
      continue;
    }

    // ── 4. NEXT: Check for Next / Continue button ──
    const nextBtn = page.locator("button[aria-label*='Continue to next'], button[aria-label*='Continue'], button:has-text('Next'), button:has-text('Continue')").first();
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await log(`[applyLinkedIn] → NEXT: Clicking Next...`);
      await nextBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // After clicking Next, check if page actually advanced
      const postClickErrors = await page.$$eval(
        "[data-test-form-element-error], .artdeco-inline-feedback--error, .fb-form-element__error-text, [class*='error'], [role='alert']",
        (els) => els.filter(e => (e as HTMLElement).offsetParent !== null && (e.textContent ?? "").trim().length > 0)
          .map(e => (e.textContent ?? "").trim().slice(0, 80))
      ).catch(() => []);
      if (postClickErrors.length > 0) {
        await log(`[applyLinkedIn] ⚠️ Post-Next errors (page didn't advance): ${JSON.stringify(postClickErrors.slice(0, 3))}`);
      }
      continue;
    }

    // ── 5. STOP: No navigation buttons found ──

    // Check for dismiss/close dialog (error state)
    const dismissBtn = page.locator("button[aria-label='Dismiss'], button:has-text('Dismiss')").first();
    if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await log(`[applyLinkedIn] → STOP: Modal dismissed — application might need external redirect`);
      break;
    }

    // 15-second page timeout check
    if (Date.now() - stepStart > STEP_TIMEOUT_MS) {
      await log(`[applyLinkedIn] → STOP: Step ${step + 1} exceeded 15s page timeout — moving on`);
      continue;
    }

    // Nothing found — wait a bit and retry (page might be loading)
    await log(`[applyLinkedIn] → STOP: Step ${step + 1} — no buttons found, waiting 2s...`);
    await page.waitForTimeout(2000);

    // Check timeout again after wait
    if (Date.now() - stepStart > STEP_TIMEOUT_MS) {
      await log(`[applyLinkedIn] → STOP: Step ${step + 1} exceeded 15s after wait — moving on`);
      continue;
    }

    // If we've waited 2+ steps with no buttons, give up
    if (step >= 2) {
      const anyButton = await page.$("button[aria-label*='application'], button:has-text('Submit'), button:has-text('Next'), button:has-text('Review'), a:has-text('Submit'), a:has-text('Next')");
      if (!anyButton) {
        await log(`[applyLinkedIn] → STOP: No application buttons found after ${step + 1} steps — giving up`);
        break;
      }
    }
  }

  await log(`[applyLinkedIn] Ended without submitting after ${MAX_STEPS} max steps — MANUAL`);
  // Take a screenshot for debugging
  await page.screenshot({ path: `artifacts/screenshots/manual-${applicationId.slice(0, 8)}.png` }).catch(() => {});
  return "MANUAL" as const;
};

const applyIndeed = async (
  page: Page,
  applicationId: string,
  profile: FillProfile,
  coverLetterText: string,
  fallbackText: string,
  resumeContext: { skills: string[]; experienceSummary: string },
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  await log(`[applyIndeed] Starting for ${applicationId}`);
  await log(`[applyIndeed] Current URL: ${page.url()}`);

  await page.waitForTimeout(2000);

  // Find Apply button with waiting
  const applySelectors = [
    "button:has-text('Apply now')",
    "a:has-text('Apply now')",
    "button:has-text('Apply on company site')",
    "a:has-text('Apply on company site')",
    "button:has-text('Apply')",
    "a[href*='apply']",
  ];
  let applyButton: any = null;
  for (const sel of applySelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
        applyButton = await loc.elementHandle();
        await log(`[applyIndeed] Found Apply button: ${sel}`);
        break;
      }
    } catch {}
  }

  if (!applyButton) {
    await page.screenshot({ path: `${process.cwd()}/artifacts/screenshots/indeed-no-apply-${applicationId.slice(0, 8)}.png` }).catch(() => {});
    await log(`[applyIndeed] Apply button NOT found. URL: ${page.url()}`);
    await publishEvent({
      jobId: applicationId,
      type: "ERROR_OCCURRED",
      message: "Apply button not found. Manual intervention required.",
    });
    return "MANUAL" as const;
  }

  // Click apply — may open a popup or redirect
  const popupPromise = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
  await applyButton.click();
  await log(`[applyIndeed] Clicked Apply button`);
  const popup = await popupPromise;
  const target = popup ?? page;
  if (popup) {
    await log(`[applyIndeed] Popup opened: ${popup.url()}`);
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
  }
  await target.waitForTimeout(2000);

  // Upload resume if there's a file input
  if (profile.resumePath) {
    const fileInput = target.locator("input[type='file']").first();
    if (await fileInput.count() > 0) {
      try {
        await fileInput.setInputFiles(profile.resumePath);
        await log(`[applyIndeed] Uploaded resume`);
        await target.waitForTimeout(1000);
      } catch (e: any) {
        await log(`[applyIndeed] Resume upload failed: ${e?.message}`);
      }
    }
  }

  // Multi-step loop — Indeed applications have multiple pages
  const MAX_INDEED_STEPS = 5;
  const INDEED_STEP_TIMEOUT_MS = 15000;
  for (let step = 0; step < MAX_INDEED_STEPS; step += 1) {
    const stepStart = Date.now();
    await log(`[applyIndeed] Step ${step + 1}/${MAX_INDEED_STEPS}: filling fields...`);

    await fillCommonFields(target, profile, coverLetterText, fallbackText);
    await fillAIQuestions(
      target,
      {
        name: profile.name ?? "Applicant",
        skills: resumeContext.skills,
        experience: resumeContext.experienceSummary,
        linkedin: profile.linkedin,
        github: profile.github,
        website: profile.website,
      },
      aiAnswerLimit,
      providerOverride
    );

    // Check for Submit / Finish button (final step)
    const submitSelectors = [
      "button:has-text('Submit your application')",
      "button:has-text('Submit')",
      "button:has-text('Finish')",
      "button:has-text('Apply')",
    ];
    for (const sel of submitSelectors) {
      const btn = target.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        // Make sure this isn't a "Continue" or "Next" button
        const text = await btn.textContent().catch(() => "") ?? "";
        if (text.toLowerCase().includes("continue") || text.toLowerCase().includes("next")) continue;
        await log(`[applyIndeed] Found Submit button: "${text.trim()}"`);
        if (!autoSubmit) {
          await log(`[applyIndeed] AUTO_SUBMIT is off — stopping at review`);
          return "MANUAL" as const;
        }
        await btn.click();
        await log(`[applyIndeed] Clicked Submit!`);
        await target.waitForTimeout(3000);
        return "APPLIED" as const;
      }
    }

    // Check for Continue / Next button
    const continueSelectors = [
      "button:has-text('Continue')",
      "button:has-text('Next')",
      "a:has-text('Continue')",
    ];
    let foundContinue = false;
    for (const sel of continueSelectors) {
      const btn = target.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await log(`[applyIndeed] Clicking Continue/Next...`);
        await btn.click();
        await target.waitForTimeout(2000);
        foundContinue = true;
        break;
      }
    }
    if (foundContinue) continue;

    // 15-second page timeout check
    if (Date.now() - stepStart > INDEED_STEP_TIMEOUT_MS) {
      await log(`[applyIndeed] Step ${step + 1}: exceeded 15s page timeout — moving on`);
      continue;
    }

    // Nothing found — wait and retry
    await log(`[applyIndeed] Step ${step + 1}: no buttons found, waiting 2s...`);
    await target.waitForTimeout(2000);

    if (step >= 2) {
      await log(`[applyIndeed] No application buttons after ${step + 1} steps — giving up`);
      break;
    }
  }

  await log(`[applyIndeed] Ended without submitting after ${MAX_INDEED_STEPS} max steps — MANUAL`);
  await publishEvent({
    jobId: applicationId,
    type: "STEP_COMPLETED",
    message: "Reached application but could not auto-submit. Please review manually.",
  });
  return "MANUAL" as const;
};

let resumeTailorCount = 0;

/**
 * Find the job poster on LinkedIn and send them a short message.
 * Works on the job detail page — looks for the poster card, opens messaging, types & sends.
 */
const messageJobPoster = async (
  page: Page,
  applicationId: string,
  applicantName: string,
  jobTitle: string,
  company: string,
  skills: string[],
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  if (!hrMessageEnabled || !isAIEnabled(providerOverride)) return;

  try {
    // Look for the hiring team / poster card on the job page
    const posterCard = await page.$(
      [
        ".jobs-poster__name a",
        ".hiring-team-card a",
        "a[data-tracking-control-name*='hiring']",
        ".jobs-details-top-card__hiring-team a",
        ".artdeco-entity-lockup__title a",
      ].join(", ")
    );

    if (!posterCard) {
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: "No poster profile link found — skipping message.",
      });
      return;
    }

    const posterUrl = await posterCard.getAttribute("href");
    if (!posterUrl) return;

    const fullUrl = posterUrl.startsWith("http")
      ? posterUrl
      : `https://www.linkedin.com${posterUrl}`;

    // Navigate to poster's profile
    const profilePage = await page.context().newPage();
    await profilePage.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await profilePage.waitForTimeout(2000);

    // Click the "Message" button on their profile
    const messageBtn = await profilePage.$(
      [
        "button:has-text('Message')",
        "a:has-text('Message')",
        "button[aria-label*='Message']",
      ].join(", ")
    );

    if (!messageBtn) {
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: "No message button on poster profile — they may require a connection first.",
      });
      await profilePage.close().catch(() => undefined);
      return;
    }

    await messageBtn.click();
    await profilePage.waitForTimeout(2000);

    // Generate a personalized message with AI
    const messageText = await generateHRMessage(
      applicantName,
      jobTitle,
      company,
      skills,
      providerOverride
    );

    if (!messageText) {
      await profilePage.close().catch(() => undefined);
      return;
    }

    // Type the message into the LinkedIn messaging compose box
    const composeBox = await profilePage.$(
      [
        "div.msg-form__contenteditable[contenteditable='true']",
        "div[role='textbox'][contenteditable='true']",
        ".msg-form__msg-content-container div[contenteditable]",
      ].join(", ")
    );

    if (!composeBox) {
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: "Could not find message compose box.",
      });
      await profilePage.close().catch(() => undefined);
      return;
    }

    await composeBox.click();
    await composeBox.fill(messageText);
    await profilePage.waitForTimeout(500);

    // Click send
    const sendBtn = await profilePage.$(
      "button.msg-form__send-button, button[type='submit']:has-text('Send')"
    );
    if (sendBtn) {
      await sendBtn.click();
      await profilePage.waitForTimeout(1000);
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: `Messaged HR/poster at ${company}: "${messageText.slice(0, 80)}..."`,
      });
    }

    await profilePage.close().catch(() => undefined);
  } catch (err: any) {
    await publishEvent({
      jobId: applicationId,
      type: "STEP_COMPLETED",
      message: `HR messaging skipped: ${err?.message ?? "unknown error"}`,
    });
  }
};

export const applyWithBrowser = async (payload: {
  applicationId: string;
  jobId: string;
  userId: string;
  jobUrl: string;
  platform: Platform;
}) => {
  const { applicationId, userId, jobId, jobUrl, platform } = payload;
  resumeTailorCount = 0; // Reset per-job to avoid stale count across stream-based applications
  await log(`[applyWithBrowser] Starting: ${applicationId} (${platform})`);

  let context: BrowserContext;
  let page: Page;
  try {
    context = await getContext(userId);
    page = await context.newPage();
  } catch (err: any) {
    // Context may be stale — force re-create
    await log(`[applyWithBrowser] Context error, retrying: ${err?.message}`);
    contexts.delete(userId);
    context = await getContext(userId);
    page = await context.newPage();
  }

  let result: "APPLIED" | "MANUAL" | "FAILED" = "MANUAL";
  let job: Awaited<ReturnType<typeof prisma.job.findUnique>> | null = null;

  try {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "PROCESSING" },
    });

    const [user, resume, jobRecord, existingCover, pref] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.resume.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
      prisma.job.findUnique({ where: { id: jobId } }),
      prisma.coverLetter.findFirst({
        where: { applicationId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.searchPreference.findFirst({ where: { userId } }),
    ]);
    job = jobRecord;
    const providerOverride =
      user?.aiProvider === "OPENAI"
        ? "openai"
        : user?.aiProvider === "GEMINI"
        ? "gemini"
        : undefined;

    const parsed = (resume?.parsedData as any) ?? {};
    const name = parsed.fullName ?? user?.fullName ?? "Applicant";
    const email = parsed.email ?? user?.email ?? null;
    const phone = parsed.phone ?? null;
    const skills = normalizeList(parsed.skills);
    const experienceSummary =
      buildExperienceSummary(Array.isArray(parsed.experience) ? parsed.experience : []) ||
      resume?.textContent?.slice(0, 2000) ||
      "";
    const resumeContext = { skills, experienceSummary };
    // Map Docker path (/app/...) to local path since worker runs locally
    let resolvedResumePath = resume?.storageUrl ?? null;
    if (resolvedResumePath?.startsWith("/app/")) {
      resolvedResumePath = path.join(rootDir, resolvedResumePath.replace(/^\/app\//, ""));
    }
    await log(`[applyWithBrowser] Resume path: ${resolvedResumePath}`);

    const profile: FillProfile = {
      name,
      email,
      phone,
      location: parsed.location ?? null,
      linkedin: parsed.linkedin ?? null,
      github: parsed.github ?? null,
      website: parsed.website ?? null,
      resumePath: resolvedResumePath,
    };
    let coverLetterText = existingCover?.content ?? "";

    if (platform === "LINKEDIN") {
      await log(`[applyWithBrowser] LinkedIn: navigating to ${jobUrl}`);
      await ensureLinkedInLogin(page);
      // Clean the URL to just the job view path
      const cleanUrl = jobUrl.split("?")[0];
      await log(`[applyWithBrowser] LinkedIn: clean URL: ${cleanUrl}`);
      try {
        await page.goto(cleanUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch (navErr: any) {
        await log(`[applyWithBrowser] LinkedIn: first goto failed (${navErr?.message?.slice(0, 80)}), retrying...`);
        await page.waitForTimeout(2000);
        await page.goto(cleanUrl, { waitUntil: "commit", timeout: 30000 });
      }
      await log(`[applyWithBrowser] LinkedIn: page loaded, URL: ${page.url()}`);
      // URL validation: must contain /jobs/ or /view/
      const currentLinkedInUrl = page.url();
      if (!currentLinkedInUrl.includes("/jobs/") && !currentLinkedInUrl.includes("/view/")) {
        await log(`[applyWithBrowser] ❌ URL validation failed — URL doesn't contain /jobs/ or /view/: ${currentLinkedInUrl}`);
        await page.close().catch(() => undefined);
        await prisma.application.update({ where: { id: applicationId }, data: { status: "FAILED", error: "Invalid job URL — navigated away from job page" } });
        return;
      }
      // Validate job page title against user preferences
      const pageJobTitle = await page.locator("h1, .jobs-unified-top-card__job-title, .top-card-layout__title").first().textContent().catch(() => "") ?? "";
      if (pageJobTitle.trim() && pref) {
        const pageValidation = validateJob(pageJobTitle.trim(), pref);
        if (!pageValidation.pass) {
          await log(`[applyWithBrowser] ❌ Page title check failed: "${pageJobTitle.trim()}" — ${pageValidation.reason}`);
          await page.close().catch(() => undefined);
          await prisma.application.update({ where: { id: applicationId }, data: { status: "FAILED", error: `Not a match: ${pageValidation.reason}` } });
          return;
        }
        await log(`[applyWithBrowser] ✅ Page title check passed: "${pageJobTitle.trim()}"`);
      }
      await page.waitForTimeout(2000);
      const description = job?.rawDescription ?? (await extractJobDescription(page, platform));
      if (description && jobRecord?.id) {
        await prisma.job.update({
          where: { id: jobRecord.id },
          data: { rawDescription: description },
        });
      }

      // Description validation before spending effort on apply
      if (description && description.length > 50 && pref) {
        const descCheck = validateJob(jobRecord?.title ?? pageJobTitle ?? "", pref, description);
        if (!descCheck.pass) {
          await log(`[applyWithBrowser] ❌ Description validation failed: ${descCheck.reason}`);
          await page.close().catch(() => undefined);
          await prisma.application.update({ where: { id: applicationId }, data: { status: "FAILED", error: `Not a match: ${descCheck.reason}` } });
          return;
        }
        await log(`[applyWithBrowser] ✅ Description validation passed`);
      }

      if (
        resumeTailorEnabled &&
        isAIEnabled(providerOverride) &&
        resume?.textContent &&
        description &&
        resumeTailorCount < resumeTailorLimit
      ) {
        await ensureDir(resumeDir);
        const tailored = await tailorResume(resume.textContent, description, providerOverride);
        const filePath = path.join(resumeDir, `${applicationId}.txt`);
        await Bun.write(filePath, tailored);
        resumeTailorCount += 1;
        await prisma.application.update({
          where: { id: applicationId },
          data: { resumeSnapshotUrl: filePath },
        });
      }
      if (coverLetterEnabled && isAIEnabled(providerOverride) && description) {
        const content = await generateCoverLetter(
          name,
          experienceSummary,
          jobRecord?.title ?? "Role",
          jobRecord?.company ?? "Company",
          description,
          providerOverride
        );
        if (content) {
          await prisma.coverLetter.upsert({
            where: { applicationId },
            update: { content },
            create: { userId, applicationId, content },
          });
          coverLetterText = content;
        }
      }
      result = await applyLinkedIn(
        page,
        applicationId,
        profile,
        coverLetterText,
        experienceSummary,
        resumeContext,
        providerOverride
      );

      // After applying, message the job poster on LinkedIn
      if (result === "APPLIED") {
        await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        await messageJobPoster(
          page,
          applicationId,
          name,
          jobRecord?.title ?? "the role",
          jobRecord?.company ?? "your company",
          skills,
          providerOverride
        );
      }
    } else if (platform === "INDEED") {
      await log(`[applyWithBrowser] Indeed: navigating to ${jobUrl}`);
      await ensureIndeedLogin(page);
      try {
        await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      } catch (navErr: any) {
        await log(`[applyWithBrowser] Indeed: first goto failed (${navErr?.message?.slice(0, 80)}), retrying...`);
        await page.waitForTimeout(2000);
        await page.goto(jobUrl, { waitUntil: "commit", timeout: 30000 });
      }
      await log(`[applyWithBrowser] Indeed: page loaded, URL: ${page.url()}`);
      // URL validation for Indeed
      const currentIndeedUrl = page.url();
      if (!currentIndeedUrl.includes("viewjob") && !currentIndeedUrl.includes("/jobs/") && !currentIndeedUrl.includes("indeed.com")) {
        await log(`[applyWithBrowser] ❌ URL validation failed — navigated away: ${currentIndeedUrl}`);
        await page.close().catch(() => undefined);
        await prisma.application.update({ where: { id: applicationId }, data: { status: "FAILED", error: "Invalid Indeed URL — navigated away" } });
        return;
      }
      await page.waitForTimeout(2000);
      const description = job?.rawDescription ?? (await extractJobDescription(page, platform));
      if (description && jobRecord?.id) {
        await prisma.job.update({
          where: { id: jobRecord.id },
          data: { rawDescription: description },
        });
      }
      if (
        resumeTailorEnabled &&
        isAIEnabled(providerOverride) &&
        resume?.textContent &&
        description &&
        resumeTailorCount < resumeTailorLimit
      ) {
        await ensureDir(resumeDir);
        const tailored = await tailorResume(resume.textContent, description, providerOverride);
        const filePath = path.join(resumeDir, `${applicationId}.txt`);
        await Bun.write(filePath, tailored);
        resumeTailorCount += 1;
        await prisma.application.update({
          where: { id: applicationId },
          data: { resumeSnapshotUrl: filePath },
        });
      }
      if (coverLetterEnabled && isAIEnabled(providerOverride) && description) {
        const content = await generateCoverLetter(
          name,
          experienceSummary,
          jobRecord?.title ?? "Role",
          jobRecord?.company ?? "Company",
          description,
          providerOverride
        );
        if (content) {
          await prisma.coverLetter.upsert({
            where: { applicationId },
            update: { content },
            create: { userId, applicationId, content },
          });
          coverLetterText = content;
        }
      }
      result = await applyIndeed(
        page,
        applicationId,
        profile,
        coverLetterText,
        experienceSummary,
        resumeContext,
        providerOverride
      );
    } else {
      // Generic apply: navigate to the job/apply URL and try to fill forms
      await log(`[applyWithBrowser] Generic platform (${platform}): navigating to ${jobUrl}`);
      try {
        const targetUrl = job?.applyUrl ?? jobUrl;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        await log(`[applyWithBrowser] Generic: page loaded, URL: ${page.url()}`);

        // Try to find and click an Apply button on the page
        const applySelectors = [
          "a[href*='apply']",
          "button:has-text('Apply')",
          "a:has-text('Apply Now')",
          "a:has-text('Apply')",
          "button:has-text('Submit Application')",
          "a[class*='apply']",
          "button[class*='apply']",
        ];

        for (const sel of applySelectors) {
          try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
              const href = await loc.getAttribute("href").catch(() => "") ?? "";
              await log(`[applyWithBrowser] Generic: found apply element: ${sel} href=${href.slice(0, 80)}`);
              // If it's a link to an external application page, navigate there
              if (href && (href.startsWith("http") || href.startsWith("/"))) {
                const applyPageUrl = href.startsWith("http") ? href : new URL(href, page.url()).toString();
                await page.goto(applyPageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
                await page.waitForTimeout(2000);
              } else {
                await loc.click();
                await page.waitForTimeout(2000);
              }
              break;
            }
          } catch {}
        }

        // Try filling common form fields
        await fillCommonFields(page, profile, coverLetterText, experienceSummary);

        // Upload resume if file input available
        if (profile.resumePath) {
          const fileInput = page.locator("input[type='file']").first();
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(profile.resumePath).catch((e: any) => {
              log(`[applyWithBrowser] Generic: resume upload failed: ${e?.message}`);
            });
            await page.waitForTimeout(1500);
          }
        }

        // Try to submit the form
        const submitSelectors = [
          "button[type='submit']",
          "button:has-text('Submit')",
          "button:has-text('Apply')",
          "input[type='submit']",
        ];

        let submitted = false;
        if (autoSubmit) {
          for (const sel of submitSelectors) {
            try {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await btn.click();
                await page.waitForTimeout(3000);
                submitted = true;
                await log(`[applyWithBrowser] Generic: clicked submit button: ${sel}`);
                break;
              }
            } catch {}
          }
        }

        // Check for success indicators
        const bodyText = await page.textContent("body").catch(() => "") ?? "";
        const successIndicators = /thank you|application.*received|successfully.*submitted|applied|confirmation/i;
        if (submitted && successIndicators.test(bodyText)) {
          result = "APPLIED";
          await log(`[applyWithBrowser] Generic: Application appears successful!`);
        } else {
          result = "MANUAL";
          await log(`[applyWithBrowser] Generic: Could not confirm submission. Manual review needed.`);
        }

        await page.screenshot({ path: `${process.cwd()}/artifacts/screenshots/generic-${applicationId.slice(0, 8)}.png` }).catch(() => {});
      } catch (err: any) {
        await log(`[applyWithBrowser] Generic apply error: ${err?.message?.slice(0, 200)}`);
        result = "MANUAL";
      }
    }

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: result === "APPLIED" ? "APPLIED"
          : result === "FAILED" ? "FAILED"
          : "MANUAL_INTERVENTION",
        ...(result === "FAILED" ? { error: "Job expired or already applied" } : {}),
      },
    });

    await sendStatusNotification({
      userId,
      applicationId,
      status: result === "APPLIED" ? "APPLIED"
        : result === "FAILED" ? "FAILED"
        : "MANUAL_INTERVENTION",
      title: job?.title ?? null,
      company: job?.company ?? null,
      jobUrl,
    });

    if (result === "MANUAL") {
      await publishEvent({
        jobId: applicationId,
        type: "STEP_COMPLETED",
        message: `Manual review required. Window will close in ${Math.round(
          manualHoldMs / 60000
        )} minutes.`,
      });
      setTimeout(() => {
        page.close().catch(() => undefined);
      }, manualHoldMs);
    } else {
      await page.close().catch(() => undefined);
    }
  } catch (err: any) {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "FAILED", error: err?.message ?? "Automation failed" },
    });
    await sendStatusNotification({
      userId,
      applicationId,
      status: "FAILED",
      title: job?.title ?? null,
      company: job?.company ?? null,
      jobUrl,
    });
    await publishEvent({
      jobId: applicationId,
      type: "ERROR_OCCURRED",
      message: err?.message ?? "Automation failed",
    });
    await page.close().catch(() => undefined);
  }
};
