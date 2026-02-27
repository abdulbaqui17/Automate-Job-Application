import { prisma } from "./db";
import { redis } from "./redis";
import { APPLICATION_STREAM, JOB_EVENTS_CHANNEL } from "./stream";

type SearchPreference = NonNullable<
  Awaited<ReturnType<typeof prisma.searchPreference.findFirst>>
>;
type Platform = "LINKEDIN" | "INDEED" | "GLASSDOOR" | "REMOTIVE" | "ARBEITNOW" | "OTHER";

const DISCOVERY_INTERVAL_MS = Number(
  process.env.DISCOVERY_INTERVAL_MS ?? 24 * 60 * 60 * 1000
);

type DiscoveredJob = {
  externalId: string;
  jobUrl: string;
  applyUrl?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  postedAt?: Date | null;
  platform: Platform;
};

type JobSource = {
  name: string;
  fetchJobs: (pref: SearchPreference) => Promise<DiscoveredJob[]>;
};

const fetchRemotiveJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const query = buildQuery(pref);
  if (!query) return [];
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Remotive API error: ${res.status}`);
  const data = await res.json();
  const jobs = (data.jobs ?? []) as Array<{
    id: number;
    url: string;
    title: string;
    company_name: string;
    candidate_required_location?: string;
    description?: string;
    publication_date?: string;
  }>;
  return jobs.map((job) => ({
    externalId: `remotive_${job.id}`,
    jobUrl: job.url,
    applyUrl: job.url,
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location ?? null,
    description: job.description ?? null,
    postedAt: job.publication_date ? new Date(job.publication_date) : null,
    platform: "REMOTIVE",
  }));
};

const fetchArbeitnowJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const url = "https://www.arbeitnow.com/api/job-board-api";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Arbeitnow API error: ${res.status}`);
  const data = await res.json();
  const jobs = (data.data ?? []) as Array<{
    slug: string;
    url: string;
    title: string;
    company_name: string;
    location?: string;
    remote?: boolean;
    description?: string;
    created_at?: string;
  }>;

  const filtered = jobs.filter((job) => {
    if (pref.remote && !job.remote) return false;
    return true;
  });

  return filtered.map((job) => ({
    externalId: `arbeitnow_${job.slug}`,
    jobUrl: job.url,
    applyUrl: job.url,
    title: job.title,
    company: job.company_name,
    location: job.location ?? null,
    description: job.description ?? null,
    postedAt: job.created_at ? new Date(job.created_at) : null,
    platform: "ARBEITNOW",
  }));
};

const sources: JobSource[] = [
  { name: "remotive", fetchJobs: fetchRemotiveJobs },
  { name: "arbeitnow", fetchJobs: fetchArbeitnowJobs },
];

const buildQuery = (pref: SearchPreference) => {
  const terms = [...(pref.roles ?? []), ...(pref.keywords ?? [])]
    .map((t) => t.trim())
    .filter(Boolean);
  return terms.join(" ");
};

const scoreJob = (job: DiscoveredJob, pref: SearchPreference) => {
  const terms = [...(pref.roles ?? []), ...(pref.keywords ?? [])]
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return 0;
  const haystack = [job.title, job.company, job.location, job.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matches = terms.filter((term) => haystack.includes(term.toLowerCase()));
  return matches.length / terms.length;
};

const matchesLocation = (job: DiscoveredJob, pref: SearchPreference) => {
  if (!pref.locations?.length) return true;
  const locationText = (job.location ?? "").toLowerCase();
  return pref.locations.some((loc: string) => locationText.includes(loc.toLowerCase()));
};

const enqueueApplication = async (payload: {
  applicationId: string;
  jobId: string;
  userId: string;
  jobUrl: string;
  platform: string;
}) => {
  await redis.xadd(
    APPLICATION_STREAM,
    "*",
    "payload",
    JSON.stringify({ ...payload, attempts: 0 })
  );
};

const publishEvent = async (event: { jobId: string; type: string; message: string }) => {
  await redis.publish(
    JOB_EVENTS_CHANNEL,
    JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    })
  );
};

const processPreference = async (
  pref: SearchPreference,
  { force = false }: { force?: boolean } = {}
) => {
  const now = new Date();
  const lastRun = pref.lastRunAt ? new Date(pref.lastRunAt) : null;
  if (!force && lastRun && now.getTime() - lastRun.getTime() < DISCOVERY_INTERVAL_MS) {
    return;
  }

  const batch = await prisma.jobImportBatch.create({
    data: {
      userId: pref.userId,
      source: "DISCOVERY",
      status: "PROCESSING",
    },
  });

  const discovered: DiscoveredJob[] = [];
  for (const source of sources) {
    try {
      const jobs = await source.fetchJobs(pref);
      discovered.push(...jobs);
    } catch (err) {
      console.error(`[discovery] ${source.name} failed`, err);
    }
  }

  await prisma.searchPreference.update({
    where: { id: pref.id },
    data: { lastRunAt: now },
  });

  for (const job of discovered) {
    const importItem = await prisma.jobImportItem.create({
      data: {
        batchId: batch.id,
        jobUrl: job.jobUrl,
        platform: job.platform,
        status: "QUEUED",
      },
    });

    try {
      const createdJob = await prisma.job.create({
        data: {
          userId: pref.userId,
          externalId: job.externalId,
          platform: job.platform,
          jobUrl: job.jobUrl,
          applyUrl: job.applyUrl ?? null,
          title: job.title ?? null,
          company: job.company ?? null,
          location: job.location ?? null,
          rawDescription: job.description ?? null,
          postedAt: job.postedAt ?? null,
        },
      });

      const score = scoreJob(job, pref);
      await prisma.jobMatch.create({
        data: {
          userId: pref.userId,
          jobId: createdJob.id,
          score,
          rationale: {
            keywords: pref.keywords,
            roles: pref.roles,
          },
        },
      });

      await prisma.jobImportItem.update({
        where: { id: importItem.id },
        data: { status: "CREATED", jobId: createdJob.id },
      });

      if (pref.autoApply && score >= pref.scoreThreshold && matchesLocation(job, pref)) {
        const application = await prisma.application.create({
          data: {
            userId: pref.userId,
            jobId: createdJob.id,
            status: "QUEUED",
          },
        });

        await enqueueApplication({
          applicationId: application.id,
          jobId: createdJob.id,
          userId: pref.userId,
          jobUrl: createdJob.jobUrl,
          platform: createdJob.platform,
        });

        await publishEvent({
          jobId: application.id,
          type: "JOB_STARTED",
          message: `Discovered job queued: ${createdJob.title ?? createdJob.jobUrl}`,
        });
      }
    } catch (err: any) {
      const isDuplicate = err?.code === "P2002";
      await prisma.jobImportItem.update({
        where: { id: importItem.id },
        data: { status: isDuplicate ? "DUPLICATE" : "FAILED", error: err?.message },
      });
    }
  }

  await prisma.jobImportBatch.update({
    where: { id: batch.id },
    data: { status: "COMPLETED" },
  });

  await prisma.searchPreference.update({
    where: { id: pref.id },
    data: { lastRunAt: now },
  });
};

export const startDiscovery = async () => {
  const runOnce = async () => {
    const prefs = await prisma.searchPreference.findMany();
    for (const pref of prefs) {
      await processPreference(pref);
    }
  };

  const runInterval = setInterval(runOnce, DISCOVERY_INTERVAL_MS);

  await runOnce();

  return () => clearInterval(runInterval);
};

export const runDiscoveryNow = async (userId?: string) => {
  const prefs = await prisma.searchPreference.findMany({
    where: userId ? { userId } : undefined,
  });
  for (const pref of prefs) {
    await processPreference(pref, { force: true });
  }
};
