import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { env } from "./config";
import { prisma } from "./db";
import { redis } from "./redis";
import type { JobEvent } from "@app/shared";
import { APPLICATION_STREAM, JOB_EVENTS_CHANNEL, AUTOMATION_CHANNEL } from "./stream";
import multer from "multer";
import pdfParse from "pdf-parse";
import path from "path";
import { fileURLToPath } from "url";
import { mkdir } from "fs/promises";
import { extractProfileWithGemini, generateInterviewPrep } from "./gemini";
import { renderTextToPDF } from "./pdf";
import { createHash } from "crypto";

const sockets = new Set<WebSocket>();

const broadcast = (event: JobEvent) => {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
};

const jobSchema = z.object({
  userId: z.string().uuid(),
  jobUrl: z.string().url(),
  platform: z.enum([
    "LINKEDIN",
    "INDEED",
    "GLASSDOOR",
    "REMOTIVE",
    "ARBEITNOW",
    "OTHER",
  ]),
});

const bulkSchema = z.object({
  userId: z.string().uuid(),
  urls: z.array(z.string()).min(1),
});

const detectPlatform = (url: string) => {
  const lower = url.toLowerCase();
  if (lower.includes("linkedin.com")) return "LINKEDIN";
  if (lower.includes("indeed.com")) return "INDEED";
  if (lower.includes("glassdoor.com")) return "GLASSDOOR";
  if (lower.includes("remotive.com")) return "REMOTIVE";
  if (lower.includes("arbeitnow.com")) return "ARBEITNOW";
  return "OTHER";
};

const hashUrl = (url: string) => createHash("sha1").update(url).digest("hex");

const userSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).optional(),
  aiProvider: z.enum(["AUTO", "OPENAI", "GEMINI"]).optional(),
});

const userUpdateSchema = z
  .object({
    email: z.string().email().optional(),
    fullName: z.string().min(1).optional(),
  })
  .refine((data) => data.email !== undefined || data.fullName !== undefined, {
    message: "At least one field is required",
  });

const preferenceSchema = z.object({
  userId: z.string().uuid(),
  keywords: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  remote: z.boolean().optional(),
  salaryMin: z.number().int().optional(),
  salaryMax: z.number().int().optional(),
  autoApply: z.boolean().optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
});

const app = express();
app.use(cors());
app.use(express.json());

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const uploadsDir = path.join(rootDir, "artifacts", "uploads");
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/users", async (req, res) => {
  try {
    const data = userSchema.parse(req.body);
    const user = await prisma.user.create({ data });
    res.json(user);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Email already exists" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/resume/upload", upload.single("file"), async (req, res) => {
  const userId = req.body?.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  try {
    await mkdir(uploadsDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || ".pdf";
    const filename = `${userId}-${Date.now()}${ext}`;
    const fullPath = path.join(uploadsDir, filename);
    await Bun.write(fullPath, req.file.buffer);

    const pdfData = await pdfParse(req.file.buffer);
    const textContent = pdfData.text?.trim() ?? "";

    const resume = await prisma.resume.create({
      data: {
        userId,
        source: "UPLOAD",
        storageUrl: fullPath,
        textContent,
      },
    });

    res.json({ resumeId: resume.id, textLength: textContent.length });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload resume" });
  }
});

app.post("/resume/parse", async (req, res) => {
  const userId = req.body?.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const resume = await prisma.resume.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (!resume?.textContent) {
      res.status(400).json({ error: "No resume text found. Upload a resume first." });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const provider =
      user?.aiProvider === "OPENAI"
        ? "openai"
        : user?.aiProvider === "GEMINI"
        ? "gemini"
        : undefined;

    const parsed = await extractProfileWithGemini(resume.textContent, provider);

    const updated = await prisma.resume.update({
      where: { id: resume.id },
      data: { parsedData: parsed },
    });

    res.json({ resumeId: updated.id, parsedData: parsed });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to parse resume" });
  }
});

app.get("/users/:id", async (req, res) => {
  const id = req.params.id;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

app.patch("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const data = userUpdateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id },
      data,
    });
    res.json(user);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Email already exists" });
      return;
    }
    if (error?.code === "P2025") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/resume/latest", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  const resume = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!resume) {
    res.json(null);
    return;
  }
  res.json({
    id: resume.id,
    userId: resume.userId,
    parsedData: resume.parsedData ?? null,
    textLength: resume.textContent?.length ?? 0,
    createdAt: resume.createdAt,
  });
});

app.get("/users", async (req, res) => {
  const email = req.query.email;
  if (typeof email !== "string") {
    res.status(400).json({ error: "email query param required" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

app.post("/users/ai-provider", async (req, res) => {
  try {
    const schema = z.object({
      userId: z.string().uuid(),
      aiProvider: z.enum(["AUTO", "OPENAI", "GEMINI"]),
    });
    const { userId, aiProvider } = schema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { aiProvider },
    });
    res.json(updated);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/jobs", async (req, res) => {
  try {
    const { userId, jobUrl, platform } = jobSchema.parse(req.body);

    const job = await prisma.job.create({
      data: {
        userId,
        jobUrl,
        platform,
        applications: {
          create: {
            userId,
            status: "QUEUED",
          },
        },
      },
      include: { applications: true },
    });

    const application = job.applications[0];

    await redis.xadd(
      APPLICATION_STREAM,
      "*",
      "payload",
      JSON.stringify({
        applicationId: application.id,
        jobId: job.id,
        userId,
        jobUrl,
        platform,
        attempts: 0,
      })
    );

    const queuedEvent: JobEvent = {
      jobId: application.id,
      type: "JOB_STARTED",
      message: "Job queued",
      timestamp: new Date().toISOString(),
    };

    await redis.publish(JOB_EVENTS_CHANNEL, JSON.stringify(queuedEvent));

    res.json({ applicationId: application.id, jobId: job.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/jobs/bulk", async (req, res) => {
  try {
    const { userId, urls } = bulkSchema.parse(req.body);
    const cleaned = Array.from(
      new Set(
        urls
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    if (cleaned.length === 0) {
      res.status(400).json({ error: "No valid URLs provided" });
      return;
    }

    const batch = await prisma.jobImportBatch.create({
      data: {
        userId,
        source: "MANUAL",
        status: "PROCESSING",
      },
    });

    let created = 0;
    let duplicates = 0;
    let failed = 0;

    for (const url of cleaned) {
      let importItem = await prisma.jobImportItem.create({
        data: {
          batchId: batch.id,
          jobUrl: url,
          status: "QUEUED",
        },
      });
      try {
        const parsed = new URL(url);
        const platform = detectPlatform(parsed.href);
        const externalId = `manual_${hashUrl(parsed.href)}`;

        const job = await prisma.job.create({
          data: {
            userId,
            externalId,
            platform,
            jobUrl: parsed.href,
          },
        });

        const application = await prisma.application.create({
          data: {
            userId,
            jobId: job.id,
            status: "QUEUED",
          },
        });

        await redis.xadd(
          APPLICATION_STREAM,
          "*",
          "payload",
          JSON.stringify({
            applicationId: application.id,
            jobId: job.id,
            userId,
            jobUrl: job.jobUrl,
            platform: job.platform,
            attempts: 0,
          })
        );

        await prisma.jobImportItem.update({
          where: { id: importItem.id },
          data: { status: "CREATED", jobId: job.id, platform },
        });
        created += 1;
      } catch (err: any) {
        if (err?.code === "P2002") {
          await prisma.jobImportItem.update({
            where: { id: importItem.id },
            data: { status: "DUPLICATE" },
          });
          duplicates += 1;
        } else {
          await prisma.jobImportItem.update({
            where: { id: importItem.id },
            data: { status: "FAILED", error: err?.message ?? "Failed" },
          });
          failed += 1;
        }
      }
    }

    await prisma.jobImportBatch.update({
      where: { id: batch.id },
      data: { status: "COMPLETED" },
    });

    res.json({ ok: true, batchId: batch.id, created, duplicates, failed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const application = await prisma.application.findUnique({
    where: { id },
  });
  res.json(application ?? null);
});

app.get("/applications", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  const apps = await prisma.application.findMany({
    where: { userId },
    include: { job: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(apps);
});

app.get("/applications/:id/cover-letter", async (req, res) => {
  const id = req.params.id;
  const cover = await prisma.coverLetter.findFirst({
    where: { applicationId: id },
    orderBy: { createdAt: "desc" },
  });
  res.json(cover ?? null);
});

app.get("/applications/:id/resume", async (req, res) => {
  const id = req.params.id;
  const app = await prisma.application.findUnique({
    where: { id },
  });
  if (!app?.resumeSnapshotUrl) {
    res.status(404).send("No resume snapshot");
    return;
  }
  try {
    const file = Bun.file(app.resumeSnapshotUrl);
    if (!(await file.exists())) {
      res.status(404).send("File missing");
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(await file.text());
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to read resume file");
  }
});

app.get("/applications/:id/cover-letter.pdf", async (req, res) => {
  const id = req.params.id;
  const cover = await prisma.coverLetter.findFirst({
    where: { applicationId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!cover?.content) {
    res.status(404).send("No cover letter");
    return;
  }
  const pdf = await renderTextToPDF("Cover Letter", cover.content);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=cover-letter.pdf");
  res.send(pdf);
});

app.get("/applications/:id/resume.pdf", async (req, res) => {
  const id = req.params.id;
  const app = await prisma.application.findUnique({
    where: { id },
  });
  if (!app?.resumeSnapshotUrl) {
    res.status(404).send("No resume snapshot");
    return;
  }
  const file = Bun.file(app.resumeSnapshotUrl);
  if (!(await file.exists())) {
    res.status(404).send("File missing");
    return;
  }
  const text = await file.text();
  const pdf = await renderTextToPDF("Tailored Resume", text);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=resume.pdf");
  res.send(pdf);
});

app.get("/applications/:id/interview-prep", async (req, res) => {
  const id = req.params.id;
  const prep = await prisma.interviewPrep.findFirst({
    where: { applicationId: id },
    orderBy: { createdAt: "desc" },
  });
  res.json(prep ?? null);
});

app.post("/applications/:id/interview-prep", async (req, res) => {
  const id = req.params.id;
  try {
    const application = await prisma.application.findUnique({
      where: { id },
      include: { job: true },
    });
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const resume = await prisma.resume.findFirst({
      where: { userId: application.userId },
      orderBy: { createdAt: "desc" },
    });
    if (!resume?.textContent) {
      res.status(400).json({ error: "Resume text not found. Upload first." });
      return;
    }

    const jobDescription = application.job?.rawDescription ?? "";
    const user = await prisma.user.findUnique({ where: { id: application.userId } });
    const provider =
      user?.aiProvider === "OPENAI"
        ? "openai"
        : user?.aiProvider === "GEMINI"
        ? "gemini"
        : undefined;

    const content = await generateInterviewPrep(
      {
        jobTitle: application.job?.title,
        company: application.job?.company,
        jobDescription,
        resumeText: resume.textContent,
      },
      provider
    );

    const prep = await prisma.interviewPrep.create({
      data: {
        userId: application.userId,
        applicationId: application.id,
        jobId: application.jobId,
        content,
      },
    });

    res.json(prep);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate interview prep" });
  }
});

app.get("/preferences/:userId", async (req, res) => {
  const { userId } = req.params;
  const pref = await prisma.searchPreference.findFirst({
    where: { userId },
  });
  res.json(pref ?? null);
});

app.get("/discovery/jobs", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  const jobs = await prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  res.json(jobs);
});

app.get("/discovery/matches", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  const matches = await prisma.jobMatch.findMany({
    where: { userId },
    include: { job: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  res.json(matches);
});

app.post("/discovery/run", async (req, res) => {
  const userId = req.body?.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  try {
    await prisma.searchPreference.updateMany({
      where: { userId },
      data: { lastRunAt: new Date(0) },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to trigger discovery" });
  }
});

app.post("/automation/start", async (req, res) => {
  const userId = req.body?.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  try {
    let pref = await prisma.searchPreference.findFirst({ where: { userId } });

    // Auto-create preferences from parsed resume if none exist
    if (!pref) {
      const resume = await prisma.resume.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      const parsed = (resume?.parsedData as any) ?? {};
      const roles = (Array.isArray(parsed.experience) ? parsed.experience : [])
        .map((e: any) => e?.title)
        .filter(Boolean)
        .slice(0, 6);
      const keywords = (Array.isArray(parsed.skills) ? parsed.skills : [])
        .filter(Boolean)
        .slice(0, 12);
      const locations = parsed.location ? [String(parsed.location)] : [];

      if (!roles.length && !keywords.length) {
        res.status(400).json({
          error: "Upload and parse your resume in Settings first.",
        });
        return;
      }

      pref = await prisma.searchPreference.create({
        data: {
          userId,
          roles,
          keywords,
          locations,
          remote: locations.length === 0,
          autoApply: true,
          scoreThreshold: 0.25,
        },
      });
    }

    await prisma.searchPreference.updateMany({
      where: { userId },
      data: { lastRunAt: new Date(0) },
    });
    await redis.publish(AUTOMATION_CHANNEL, JSON.stringify({ userId }));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start automation" });
  }
});

app.get("/discovery/batches", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  const batches = await prisma.jobImportBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  res.json(batches);
});

app.get("/analytics/summary", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string") {
    res.status(400).json({ error: "userId query param required" });
    return;
  }
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
    fourteenDaysAgo.setHours(0, 0, 0, 0);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      totalJobs,
      totalApplications,
      appliedLast7Days,
      statusGroups,
      platformGroups,
      matchAgg,
      recentApps,
      preference,
      appsForInsights,
    ] = await Promise.all([
      prisma.job.count({ where: { userId } }),
      prisma.application.count({ where: { userId } }),
      prisma.application.count({
        where: { userId, status: "APPLIED", createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.application.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.job.groupBy({
        by: ["platform"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.jobMatch.aggregate({
        where: { userId },
        _avg: { score: true },
        _count: { _all: true },
      }),
      prisma.application.findMany({
        where: { userId, createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true },
      }),
      prisma.searchPreference.findFirst({ where: { userId } }),
      prisma.application.findMany({
        where: { userId, createdAt: { gte: ninetyDaysAgo } },
        select: {
          status: true,
          createdAt: true,
          job: {
            select: {
              company: true,
              title: true,
              location: true,
              rawDescription: true,
            },
          },
        },
        take: 600,
      }),
    ]);

    interface StatusCounts {
      QUEUED?: number;
      APPLIED?: number;
      FAILED?: number;
      MANUAL_INTERVENTION?: number;
      [key: string]: number | undefined;
    }

    const statusCounts = statusGroups.reduce(
      (acc: StatusCounts, item: { status: string; _count: { _all: number } }) => {
      acc[item.status] = item._count._all;
      return acc;
      },
      {} as StatusCounts
    );

    interface PlatformCounts {
      LINKEDIN?: number;
      INDEED?: number;
      GLASSDOOR?: number;
      REMOTIVE?: number;
      ARBEITNOW?: number;
      OTHER?: number;
      [key: string]: number | undefined;
    }

    const platformCounts: PlatformCounts = platformGroups.reduce(
      (acc: PlatformCounts, item: { platform: string; _count: { _all: number } }) => {
      acc[item.platform] = item._count._all;
      return acc;
      },
      {} as PlatformCounts
    );

    const dailyMap = new Map<string, number>();
    for (const app of recentApps) {
      const key = app.createdAt.toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
    }
    const dailyApplications = Array.from({ length: 14 }).map((_, idx) => {
      const date = new Date(fourteenDaysAgo);
      date.setDate(fourteenDaysAgo.getDate() + idx);
      const key = date.toISOString().slice(0, 10);
      return { date: key, count: dailyMap.get(key) ?? 0 };
    });

    const hourlyStats = Array.from({ length: 24 }).map((_, hour) => ({
      hour,
      total: 0,
      applied: 0,
    }));

    for (const app of appsForInsights) {
      const hour = new Date(app.createdAt).getHours();
      const bucket = hourlyStats[hour];
      if (!bucket) continue;
      bucket.total += 1;
      if (app.status === "APPLIED") bucket.applied += 1;
    }

    const bestHour = hourlyStats.reduce(
      (best, entry) => {
        if (entry.total < 2) return best;
        const rate = entry.applied / entry.total;
        if (!best || rate > best.appliedRate) {
          return { hour: entry.hour, total: entry.total, applied: entry.applied, appliedRate: rate };
        }
        return best;
      },
      null as null | { hour: number; total: number; applied: number; appliedRate: number }
    );

    const companyMap = new Map<string, { total: number; applied: number }>();
    for (const app of appsForInsights) {
      const company = app.job?.company?.trim();
      if (!company) continue;
      const entry = companyMap.get(company) ?? { total: 0, applied: 0 };
      entry.total += 1;
      if (app.status === "APPLIED") entry.applied += 1;
      companyMap.set(company, entry);
    }
    const companyInsights = Array.from(companyMap.entries())
      .map(([company, stats]) => ({
        company,
        total: stats.total,
        applied: stats.applied,
        appliedRate: stats.total > 0 ? stats.applied / stats.total : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const keywords = Array.from(
      new Set([...(preference?.keywords ?? []), ...(preference?.roles ?? [])].map((k) => k.trim()).filter(Boolean))
    );
    const keywordInsights = keywords.map((keyword) => {
      const lower = keyword.toLowerCase();
      let matches = 0;
      let applied = 0;
      for (const app of appsForInsights) {
        const text = [
          app.job?.title ?? "",
          app.job?.company ?? "",
          app.job?.location ?? "",
          app.job?.rawDescription ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!text.includes(lower)) continue;
        matches += 1;
        if (app.status === "APPLIED") applied += 1;
      }
      return {
        keyword,
        matches,
        applied,
        appliedRate: matches > 0 ? applied / matches : 0,
      };
    });

    res.json({
      totalJobs,
      totalApplications,
      appliedLast7Days,
      statusCounts,
      platformCounts,
      manualCount: statusCounts.MANUAL_INTERVENTION ?? 0,
      appliedCount: statusCounts.APPLIED ?? 0,
      conversionRate:
        totalApplications > 0 ? (statusCounts.APPLIED ?? 0) / totalApplications : 0,
      avgMatchScore: matchAgg._avg.score ?? null,
      dailyApplications,
      hourlyApplications: hourlyStats,
      bestHour,
      keywordInsights,
      companyInsights,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

app.post("/preferences", async (req, res) => {
  try {
    const data = preferenceSchema.parse(req.body);
    const existing = await prisma.searchPreference.findFirst({
      where: { userId: data.userId },
    });
    if (existing) {
      const updated = await prisma.searchPreference.update({
        where: { id: existing.id },
        data: {
          keywords: data.keywords ?? existing.keywords,
          roles: data.roles ?? existing.roles,
          locations: data.locations ?? existing.locations,
          remote: data.remote ?? existing.remote,
          salaryMin: data.salaryMin ?? existing.salaryMin,
          salaryMax: data.salaryMax ?? existing.salaryMax,
          autoApply: data.autoApply ?? existing.autoApply,
          scoreThreshold: data.scoreThreshold ?? existing.scoreThreshold,
        },
      });
      res.json(updated);
      return;
    }

    const created = await prisma.searchPreference.create({
      data: {
        userId: data.userId,
        keywords: data.keywords ?? [],
        roles: data.roles ?? [],
        locations: data.locations ?? [],
        remote: data.remote ?? false,
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        autoApply: data.autoApply ?? true,
        scoreThreshold: data.scoreThreshold ?? 0.25,
      },
    });
    res.json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.errors });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token");
  if (token !== env.WS_TOKEN) {
    socket.close(1008, "Unauthorized");
    return;
  }
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

const redisSub = redis.duplicate();
redisSub.on("message", (_channel, message) => {
  try {
    const event = JSON.parse(message) as JobEvent;
    broadcast(event);
  } catch (err) {
    console.error("Failed to parse job event", err);
  }
});

redisSub.subscribe(JOB_EVENTS_CHANNEL).catch((err) => {
  console.error("Failed to subscribe to job events", err);
});

server.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
