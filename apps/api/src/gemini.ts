import "./env";
import OpenAI from "openai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "auto").toLowerCase();

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const resolveProvider = (override?: "auto" | "openai" | "gemini") => {
  const choice = (override ?? AI_PROVIDER) as "auto" | "openai" | "gemini";
  if (choice === "openai") return openai ? "openai" : GEMINI_API_KEY ? "gemini" : "none";
  if (choice === "gemini") return GEMINI_API_KEY ? "gemini" : openai ? "openai" : "none";
  if (openai) return "openai";
  if (GEMINI_API_KEY) return "gemini";
  return "none";
};

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
    throw new Error("OPENAI_API_KEY is missing");
  }
  const response = await openai.responses.create({
    model: OPENAI_MODEL,
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
    throw new Error("Failed to parse response JSON");
  }
};

export type GeminiResumeProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  skills?: string[];
  experience?: Array<{ title?: string; company?: string; summary?: string }>;
  education?: Array<{ school?: string; degree?: string; details?: string }>;
};

export const extractProfileWithGemini = async (
  rawText: string,
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  const provider = resolveProvider(providerOverride);
  if (provider === "none") {
    throw new Error("No AI provider configured");
  }

  const prompt = `Extract a structured JSON resume profile from the text below.\n\n` +
    `Return only JSON with this shape:\n` +
    `{\n  "fullName": "",\n  "email": "",\n  "phone": "",\n  "location": "",\n  "skills": [],\n  "experience": [{"title":"","company":"","summary":""}],\n  "education": [{"school":"","degree":"","details":""}]\n}\n\n` +
    `Resume text:\n${rawText.slice(0, 12000)}`;

  if (provider === "openai") {
    const content = await callOpenAI(prompt, { temperature: 0.2, maxTokens: 1200 });
    return parseJson(content) as GeminiResumeProfile;
  }

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  return parseJson(content) as GeminiResumeProfile;
};

export const generateInterviewPrep = async (
  args: {
  jobTitle?: string | null;
  company?: string | null;
  jobDescription: string;
  resumeText: string;
  },
  providerOverride?: "auto" | "openai" | "gemini"
) => {
  const provider = resolveProvider(providerOverride);
  if (provider === "none") {
    throw new Error("No AI provider configured");
  }

  const prompt = `Create interview prep for this job. Include:\n` +
    `1) 5 likely interview questions\n` +
    `2) Bullet-point talking points tailored to the resume\n` +
    `3) 3 company-specific questions to ask\n\n` +
    `JOB TITLE: ${args.jobTitle ?? ""}\n` +
    `COMPANY: ${args.company ?? ""}\n` +
    `JOB DESCRIPTION:\n${args.jobDescription}\n\n` +
    `RESUME:\n${args.resumeText.slice(0, 6000)}\n\n` +
    `Return plain text with headings.`;

  if (provider === "openai") {
    return await callOpenAI(prompt, { temperature: 0.4, maxTokens: 1200 });
  }

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
};
