import "./env";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

const geminiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const openaiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const provider = (process.env.AI_PROVIDER ?? "auto").toLowerCase();

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

const resolveProvider = (override?: "auto" | "openai" | "gemini") => {
  const choice = (override ?? provider) as "auto" | "openai" | "gemini";
  if (choice === "openai") return openai ? "openai" : genAI ? "gemini" : "none";
  if (choice === "gemini") return genAI ? "gemini" : openai ? "openai" : "none";
  if (openai) return "openai";
  if (genAI) return "gemini";
  return "none";
};

export const isAIEnabled = (override?: "auto" | "openai" | "gemini") =>
  resolveProvider(override) !== "none";

const extractOutputText = (response: any) => {
  if (!response) return "";
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
};

const callOpenAI = async (prompt: string, opts: { temperature: number; maxTokens: number }) => {
  if (!openai) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const response = await openai.responses.create({
    model: openaiModel,
    input: prompt,
    temperature: opts.temperature,
    max_output_tokens: opts.maxTokens,
  });
  return extractOutputText(response);
};

const parseJson = (text: string) => {
  if (!text) throw new Error("Empty response");
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Failed to parse JSON");
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Score how well a job matches a user's resume/preferences
 */
export const scoreJobMatch = async (
  jobDescription: string,
  userSkills: string[],
  userExperience: string,
  providerOverride?: "auto" | "openai" | "gemini"
): Promise<{ score: number; reasoning: string }> => {
  const activeProvider = resolveProvider(providerOverride);
  if (activeProvider === "none") return { score: 0.5, reasoning: "AI not configured" };

  const prompt = `You are a strict AI Job Selection Engine.

Your goal is to select only high-quality remote MERN Stack Developer jobs suitable for international candidates.

TARGET STACK: React, Node.js, MongoDB, Express, modern JavaScript.

STRICT RULES:

1. Job must be fully remote.
   - If onsite or hybrid → reject (is_match=false, match_score=0).
   - If location restricted to a specific country and does not allow international candidates → reject.

2. Job title must include at least one: MERN, Full Stack Developer, React Developer, Node.js Developer.

3. Job description must include at least two of: React, Node.js, MongoDB, Express, REST API, JavaScript (ES6+).

4. Reject immediately if primarily: Java/Spring Boot, Python-only, .NET, PHP, Salesforce, Flutter, Android native, iOS native.

5. Prefer: Startups, Product companies, International hiring, Early-stage tech teams.

6. Reject senior roles requiring 6+ years experience.

If job is not fully remote → is_match MUST be false. Be strict.

JOB DESCRIPTION:
${jobDescription.slice(0, 2000)}

CANDIDATE SKILLS: ${userSkills.join(", ")}
CANDIDATE EXPERIENCE: ${userExperience.slice(0, 500)}

Return ONLY this JSON:
{
  "match_score": <number 0-100>,
  "is_match": <true/false>,
  "confidence": "low | medium | high",
  "reason": "<short explanation>"
}`;

  try {
    if (activeProvider === "openai") {
      const text = await callOpenAI(prompt, { temperature: 0.2, maxTokens: 400 });
      const json = parseJson(text) as { match_score?: number; reason?: string; is_match?: boolean; confidence?: string };
      const scoreValue = Number(json.match_score);
      const normalized = Number.isFinite(scoreValue) ? scoreValue / 100 : 0.5;
      const reasoning = `${json.reason ?? "AI scoring"} [confidence=${json.confidence ?? "unknown"}, is_match=${json.is_match ?? "?"}]`;
      return { score: normalized, reasoning };
    }

    const model = genAI!.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const json = parseJson(text) as { match_score?: number; reason?: string; is_match?: boolean; confidence?: string };
    const scoreValue = Number(json.match_score);
    const normalized = Number.isFinite(scoreValue) ? scoreValue / 100 : 0.5;
    const reasoning = `${json.reason ?? "AI scoring"} [confidence=${json.confidence ?? "unknown"}, is_match=${json.is_match ?? "?"}]`;
    return { score: normalized, reasoning };
  } catch (err) {
    console.error("AI scoring failed:", err);
    return { score: 0.5, reasoning: "AI scoring failed" };
  }
};

/**
 * Tailor a resume for a specific job
 */
export const tailorResume = async (
  resumeText: string,
  jobDescription: string,
  providerOverride?: "auto" | "openai" | "gemini"
): Promise<string> => {
  const activeProvider = resolveProvider(providerOverride);
  if (activeProvider === "none") return resumeText;

  const prompt = `You are an expert resume writer. Tailor this resume for the job below.
Keep the same structure but emphasize relevant skills and experience.
Make it ATS-friendly.

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Return ONLY the tailored resume text, no explanations.`;

  try {
    if (activeProvider === "openai") {
      return await callOpenAI(prompt, { temperature: 0.4, maxTokens: 1800 });
    }

    const model = genAI!.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("Resume tailoring failed:", err);
    return resumeText;
  }
};

/**
 * Generate a cover letter for a job
 */
export const generateCoverLetter = async (
  userName: string,
  userExperience: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
  providerOverride?: "auto" | "openai" | "gemini"
): Promise<string> => {
  const activeProvider = resolveProvider(providerOverride);
  if (activeProvider === "none") return "";

  const prompt = `Write a compelling cover letter for this job application.

APPLICANT: ${userName}
EXPERIENCE: ${userExperience}
JOB TITLE: ${jobTitle}
COMPANY: ${company}
JOB DESCRIPTION: ${jobDescription}

Write a professional, personalized cover letter (3 paragraphs).
Be specific about why they're a good fit.`;

  try {
    if (activeProvider === "openai") {
      return await callOpenAI(prompt, { temperature: 0.5, maxTokens: 900 });
    }

    const model = genAI!.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("Cover letter generation failed:", err);
    return "";
  }
};

/**
 * Answer common application questions
 */
export const answerApplicationQuestion = async (
  question: string,
  userProfile: { name: string; skills: string[]; experience: string },
  providerOverride?: "auto" | "openai" | "gemini"
): Promise<string> => {
  const activeProvider = resolveProvider(providerOverride);
  if (activeProvider === "none") return "";

  const prompt = `You are an AI Form Filling Assistant for a job application. The Easy Apply modal is open. Answer the form field question below.

CANDIDATE PROFILE:
- MERN Stack Developer
- Strong in React, Node.js, MongoDB, Express
- Experience building full-stack applications
- Familiar with REST APIs, authentication, deployment
- Open to remote international roles

STRICT RULES:
1. Return ONLY the answer text — nothing else
2. Keep answers concise (under 120 words)
3. Be professional and confident
4. Do NOT exaggerate experience
5. If asked about years of experience:
   - React: 2
   - Node.js: 2
   - MongoDB: 2
   - Express: 2
   - JavaScript: 3
   - TypeScript: 2
   - MERN Stack: 2
   - Full Stack: 2
   - If the skill is listed in the candidate's skills, answer at least "1". NEVER answer "0" for a known skill.
6. If asked about salary expectations:
   - For text fields: "40,000-60,000 USD per year"
   - For numeric-only fields: return just the number "50000"
   - For INR questions, answer "800000" (8 LPA)
7. If question is yes/no, answer clearly with "Yes" or "No"
8. If question is unrelated to MERN stack, answer honestly
9. NO markdown formatting (no **, no ##, no bullet points, no newlines)
10. NO letter/email format (no "Dear", no signatures, no cover letter)
11. For "why do you want to work here" or motivation questions: ONE concise sentence about being excited to contribute MERN skills
12. If a numeric field requires a number only, return ONLY the number — no text
13. Plain text only, single line

FORM FIELD QUESTION: ${question}

APPLICANT INFO:
Name: ${userProfile.name}
Skills: ${userProfile.skills.slice(0, 10).join(", ")}
Experience: ${userProfile.experience.slice(0, 400)}

Answer:`;

  try {
    let raw = "";
    if (activeProvider === "openai") {
      raw = await callOpenAI(prompt, { temperature: 0.3, maxTokens: 100 });
    } else {
      const model = genAI!.getGenerativeModel({ model: geminiModel });
      const result = await model.generateContent(prompt);
      raw = result.response.text();
    }
    // Strip markdown formatting, newlines, excess whitespace
    return raw
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,6}\s/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]/g, "$1")
      .replace(/\n+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  } catch (err) {
    console.error("Question answering failed:", err);
    return "";
  }
};

/**
 * Generate a short LinkedIn message to the job poster / HR after applying
 */
export const generateHRMessage = async (
  applicantName: string,
  jobTitle: string,
  company: string,
  keySkills: string[],
  providerOverride?: "auto" | "openai" | "gemini"
): Promise<string> => {
  const activeProvider = resolveProvider(providerOverride);
  if (activeProvider === "none") return "";

  const prompt = `Write a very short LinkedIn message (3-4 sentences max, under 300 characters) from a job applicant to the hiring manager / recruiter.

APPLICANT: ${applicantName}
JOB TITLE: ${jobTitle}
COMPANY: ${company}
KEY SKILLS: ${keySkills.slice(0, 5).join(", ")}

The message should:
- Say hi and mention they just applied to the ${jobTitle} role
- Briefly mention 1-2 relevant skills
- Express enthusiasm
- Be warm but professional
- NOT be generic or spammy

Return ONLY the message text, no subject line or signature.`;

  try {
    if (activeProvider === "openai") {
      return await callOpenAI(prompt, { temperature: 0.6, maxTokens: 200 });
    }

    const model = genAI!.getGenerativeModel({ model: geminiModel });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error("HR message generation failed:", err);
    return "";
  }
};
