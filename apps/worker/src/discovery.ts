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
  const queries = buildQueries(pref);
  if (!queries.length) return [];

  const seenIds = new Set<number>();
  const allJobs: DiscoveredJob[] = [];

  for (const query of queries) {
    try {
      const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
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
      for (const job of jobs) {
        if (seenIds.has(job.id)) continue;
        seenIds.add(job.id);
        allJobs.push({
          externalId: `remotive_${job.id}`,
          jobUrl: job.url,
          applyUrl: job.url,
          title: job.title,
          company: job.company_name,
          location: job.candidate_required_location ?? null,
          description: job.description ?? null,
          postedAt: job.publication_date ? new Date(job.publication_date) : null,
          platform: "REMOTIVE",
        });
      }
    } catch (err) {
      console.error(`[discovery] remotive query "${query}" failed`, err);
    }
  }

  return allJobs;
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

  const terms = scoringTerms(pref, 8);
  const roleSignals = (pref.roles ?? [])
    .flatMap((role) => {
      const normalized = normalizeRoleForQuery(role);
      if (!normalized) return [];
      const words = normalized.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
      const firstBigram = words.length >= 2 ? `${words[0]} ${words[1]}` : null;
      return [normalized.toLowerCase(), firstBigram].filter(Boolean) as string[];
    })
    .filter(Boolean);

  const filtered = jobs.filter((job) => {
    if (pref.remote) {
      const locationText = (job.location ?? "").toLowerCase();
      if (
        job.remote === false &&
        locationText &&
        !/(remote|anywhere|worldwide|global|work from home|wfh|distributed)/.test(locationText)
      ) {
        return false;
      }
    }

    if (!terms.length && roleSignals.length === 0) return true;
    const haystack = [job.title, job.company_name, job.location, job.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const roleMatch = roleSignals.some((signal) => haystack.includes(signal));
    const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
    return roleMatch || matchedTerms >= 2;
  });

  return filtered.slice(0, 40).map((job) => ({
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

/** Rough pre-filter: does this job's text match user roles or ≥2 keywords? */
const matchesPreference = (
  texts: (string | null | undefined)[],
  pref: SearchPreference,
): boolean => {
  const terms = scoringTerms(pref, 8);
  const roleSignals = (pref.roles ?? [])
    .flatMap((role) => {
      const normalized = normalizeRoleForQuery(role);
      if (!normalized) return [];
      const words = normalized.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      return words.length >= 2
        ? [normalized.toLowerCase(), `${words[0]} ${words[1]}`]
        : [normalized.toLowerCase()];
    })
    .filter(Boolean);
  if (!terms.length && !roleSignals.length) return true;
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  return roleSignals.some((s) => haystack.includes(s)) || terms.filter((t) => haystack.includes(t)).length >= 2;
};

// ── RemoteOK (https://remoteok.com/api) ──────────────────────────────────────
const fetchRemoteOKJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!res.ok) { console.error(`[discovery] remoteok HTTP ${res.status}`); return []; }
    const raw = await res.json();
    const jobs = (Array.isArray(raw) ? raw.slice(1) : []) as Array<{
      id?: string | number; slug?: string; url?: string;
      position?: string; company?: string; location?: string;
      description?: string; date?: string; tags?: string[];
    }>;
    return jobs
      .filter((j) => matchesPreference([j.position, j.company, j.description, ...(j.tags ?? [])], pref))
      .slice(0, 40)
      .map((j) => ({
        externalId: `remoteok_${j.id ?? j.slug ?? "x"}`,
        jobUrl: j.url ?? `https://remoteok.com/remote-jobs/${j.slug ?? j.id}`,
        applyUrl: j.url ?? null,
        title: j.position ?? null,
        company: j.company ?? null,
        location: j.location ?? "Remote",
        description: j.description?.replace(/<[^>]*>/g, " ").slice(0, 2000) ?? null,
        postedAt: j.date ? new Date(j.date) : null,
        platform: "OTHER" as Platform,
      }));
  } catch (err) { console.error("[discovery] remoteok failed", err); return []; }
};

// ── Himalayas (https://himalayas.app/jobs/api) ───────────────────────────────
const fetchHimalayasJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  const allJobs: DiscoveredJob[] = [];
  const seenIds = new Set<string>();
  for (const query of queries.slice(0, 2)) {
    try {
      const url = `https://himalayas.app/jobs/api?limit=50&offset=0&query=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const jobs = (data.jobs ?? []) as Array<{
        id: string; title?: string; companyName?: string;
        url?: string; applicationUrl?: string; excerpt?: string;
        locations?: Array<{ name: string }>; pubDate?: string;
      }>;
      for (const j of jobs) {
        if (seenIds.has(j.id)) continue;
        seenIds.add(j.id);
        if (!matchesPreference([j.title, j.companyName, j.excerpt], pref)) continue;
        allJobs.push({
          externalId: `himalayas_${j.id}`,
          jobUrl: j.url ? `https://himalayas.app${j.url}` : `https://himalayas.app/jobs/${j.id}`,
          applyUrl: j.applicationUrl ?? null,
          title: j.title ?? null,
          company: j.companyName ?? null,
          location: j.locations?.map((l) => l.name).join(", ") ?? "Remote",
          description: j.excerpt ?? null,
          postedAt: j.pubDate ? new Date(j.pubDate) : null,
          platform: "OTHER" as Platform,
        });
      }
    } catch (err) { console.error(`[discovery] himalayas query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 40);
};

// ── Jobicy (https://jobicy.com/api/v2/remote-jobs) ──────────────────────────
const fetchJobicyJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  const allJobs: DiscoveredJob[] = [];
  const seenIds = new Set<number>();
  for (const query of queries.slice(0, 2)) {
    try {
      const tag = query.replace(/\s+/g, "-").toLowerCase();
      const url = `https://jobicy.com/api/v2/remote-jobs?count=50&geo=anywhere&industry=tech&tag=${encodeURIComponent(tag)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const jobs = (data.jobs ?? []) as Array<{
        id: number; url?: string; jobTitle?: string;
        companyName?: string; jobGeo?: string; jobExcerpt?: string;
        pubDate?: string;
      }>;
      for (const j of jobs) {
        if (seenIds.has(j.id)) continue;
        seenIds.add(j.id);
        if (!matchesPreference([j.jobTitle, j.companyName, j.jobExcerpt], pref)) continue;
        allJobs.push({
          externalId: `jobicy_${j.id}`,
          jobUrl: j.url ?? `https://jobicy.com/jobs/${j.id}`,
          applyUrl: j.url ?? null,
          title: j.jobTitle ?? null,
          company: j.companyName ?? null,
          location: j.jobGeo ?? "Remote",
          description: j.jobExcerpt ?? null,
          postedAt: j.pubDate ? new Date(j.pubDate) : null,
          platform: "OTHER" as Platform,
        });
      }
    } catch (err) { console.error(`[discovery] jobicy query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 40);
};

// ── Indeed RSS (avoids bot detection unlike browser scraping) ────────────────
const fetchIndeedRSSJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  if (!queries.length) return [];
  const allJobs: DiscoveredJob[] = [];
  const seenUrls = new Set<string>();
  for (const query of queries.slice(0, 3)) {
    try {
      const location = pref.remote ? "remote" : (pref.locations?.[0] ?? "");
      const params = new URLSearchParams({ q: query, l: location, fromage: "7" });
      if (pref.remote) params.set("remotejob", "032b3046-06a3-4876-8dfd-474eb5e7ed11");
      const url = `https://www.indeed.com/rss?${params.toString()}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<rss") && !xml.includes("<item")) continue;
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      for (const item of items) {
        const getTag = (tag: string) =>
          item.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`))?.[1]
          ?? item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]
          ?? null;
        const link = getTag("link");
        if (!link || seenUrls.has(link)) continue;
        seenUrls.add(link);
        const rawTitle = getTag("title") ?? "";
        const desc = getTag("description")?.replace(/<[^>]*>/g, " ").trim() ?? null;
        const pubDate = getTag("pubDate");
        const parts = rawTitle.split(" - ");
        const title = parts[0]?.trim() ?? null;
        const company = parts.length > 1 ? parts[1]?.trim() : null;
        const loc = parts.length > 2 ? parts.slice(2).join(" - ").trim() : null;
        const jk = link.match(/jk=([a-f0-9]+)/)?.[1];
        allJobs.push({
          externalId: jk ? `indeed_rss_${jk}` : `indeed_rss_${link.slice(-20)}`,
          jobUrl: link,
          applyUrl: link,
          title,
          company,
          location: loc,
          description: desc,
          postedAt: pubDate ? new Date(pubDate) : null,
          platform: "INDEED" as Platform,
        });
      }
    } catch (err) { console.error(`[discovery] indeed-rss query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 40);
};

// ── The Muse (https://www.themuse.com/api/public/jobs) ──────────────────────
const fetchMuseJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  try {
    const query = buildQuery(pref);
    const params = new URLSearchParams({ page: "1", descending: "true", category: "Software Engineering" });
    if (query) params.set("query", query);
    const url = `https://www.themuse.com/api/public/jobs?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) { console.error(`[discovery] themuse HTTP ${res.status}`); return []; }
    const data = await res.json();
    const jobs = (data.results ?? []) as Array<{
      id: number; name?: string;
      company?: { name: string };
      locations?: Array<{ name: string }>;
      refs?: { landing_page: string };
      publication_date?: string;
      contents?: string;
    }>;
    return jobs
      .filter((j) => matchesPreference([j.name, j.company?.name, j.contents], pref))
      .slice(0, 40)
      .map((j) => ({
        externalId: `muse_${j.id}`,
        jobUrl: j.refs?.landing_page ?? `https://www.themuse.com/jobs/${j.id}`,
        applyUrl: j.refs?.landing_page ?? null,
        title: j.name ?? null,
        company: j.company?.name ?? null,
        location: j.locations?.map((l) => l.name).join(", ") ?? null,
        description: j.contents?.replace(/<[^>]*>/g, " ").slice(0, 2000) ?? null,
        postedAt: j.publication_date ? new Date(j.publication_date) : null,
        platform: "OTHER" as Platform,
      }));
  } catch (err) { console.error("[discovery] themuse failed", err); return []; }
};

// ── Wellfound (formerly AngelList — best-effort, may need browser) ──────────
const fetchWellfoundJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const query = buildQuery(pref);
  try {
    const slug = query.replace(/\s+/g, "-").toLowerCase();
    const url = `https://wellfound.com/role/l/${encodeURIComponent(slug)}/remote`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return [];
    const nextData = JSON.parse(nextDataMatch[1]);
    const listings = (nextData?.props?.pageProps?.listings ?? nextData?.props?.pageProps?.jobListings ?? []) as any[];
    return listings
      .filter((j: any) => matchesPreference([j.title ?? j.name, j.company?.name, j.description], pref))
      .slice(0, 30)
      .map((j: any) => ({
        externalId: `wellfound_${j.id ?? j.slug ?? Math.random().toString(36).slice(2)}`,
        jobUrl: j.url ? `https://wellfound.com${j.url}` : `https://wellfound.com/jobs/${j.slug ?? j.id}`,
        applyUrl: j.applyUrl ?? null,
        title: j.title ?? j.name ?? null,
        company: j.company?.name ?? j.companyName ?? null,
        location: j.remote ? "Remote" : (j.location ?? null),
        description: j.description?.slice(0, 2000) ?? null,
        postedAt: j.createdAt ? new Date(j.createdAt) : null,
        platform: "OTHER" as Platform,
      }));
  } catch (err) { console.error("[discovery] wellfound failed", err); return []; }
};

// ── Naukri.com (India's largest job board — best-effort API) ────────────────
const fetchNaukriJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const query = buildQuery(pref);
  try {
    const params = new URLSearchParams({
      noOfResults: "20",
      urlType: "search_by_keyword",
      searchType: "adv",
      keyword: query,
    });
    if (pref.remote) params.set("wfhType", "2");
    const url = `https://www.naukri.com/jobapi/v3/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
        appid: "109",
        systemid: "109",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = (data.jobDetails ?? []) as Array<{
      jobId: string; title?: string; companyName?: string;
      placeholders?: Array<{ type: string; label: string }>;
      jdURL?: string; createdDate?: string;
      jobDescription?: string;
    }>;
    return jobs
      .filter((j) => matchesPreference([j.title, j.companyName, j.jobDescription], pref))
      .slice(0, 30)
      .map((j) => ({
        externalId: `naukri_${j.jobId}`,
        jobUrl: j.jdURL ? `https://www.naukri.com${j.jdURL}` : `https://www.naukri.com/job-listings-${j.jobId}`,
        applyUrl: j.jdURL ? `https://www.naukri.com${j.jdURL}` : null,
        title: j.title ?? null,
        company: j.companyName ?? null,
        location: j.placeholders?.find((p) => p.type === "location")?.label ?? null,
        description: j.jobDescription?.replace(/<[^>]*>/g, " ").slice(0, 2000) ?? null,
        postedAt: j.createdDate ? new Date(j.createdDate) : null,
        platform: "OTHER" as Platform,
      }));
  } catch (err) { console.error("[discovery] naukri failed", err); return []; }
};

// ── YC Work at a Startup (Y Combinator job board) ───────────────────────────
const fetchYCJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  const allJobs: DiscoveredJob[] = [];
  const seenIds = new Set<string>();
  for (const query of queries.slice(0, 3)) {
    try {
      // YC's Algolia-powered search API
      const payload = {
        requests: [{
          indexName: "WaaSJobs_production",
          params: `query=${encodeURIComponent(query)}&hitsPerPage=30&filters=isRemote:true`,
        }],
      };
      const res = await fetch("https://45bwzj1sgc-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=45BWZJ1SGC&x-algolia-api-key=MjBjYjRiMzY0NzdhZWY0NjExY2NhZjYxMGIxYjc2MTAwNWFkNTkwNTc4NjgxYjU0YzFhYTY2ZGQ5OGY5NDMzZnJlc3RyaWN0SW5kaWNlcz0lNUIlMjJXYWFTSm9ic19wcm9kdWN0aW9uJTIyJTVEJnRhZ0ZpbHRlcnM9JTVCJTIyJTIyJTVE", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const hits = (data.results?.[0]?.hits ?? []) as Array<{
        objectID: string;
        title?: string;
        company_name?: string;
        company_slug?: string;
        url?: string;
        text?: string;
        location?: string;
        isRemote?: boolean;
        created_at?: number;
      }>;
      for (const h of hits) {
        if (seenIds.has(h.objectID)) continue;
        seenIds.add(h.objectID);
        if (!matchesPreference([h.title, h.company_name, h.text], pref)) continue;
        allJobs.push({
          externalId: `yc_${h.objectID}`,
          jobUrl: h.url ?? `https://www.workatastartup.com/jobs/${h.objectID}`,
          applyUrl: h.url ?? null,
          title: h.title ?? null,
          company: h.company_name ?? null,
          location: h.isRemote ? "Remote" : (h.location ?? null),
          description: h.text?.replace(/<[^>]*>/g, " ").slice(0, 2000) ?? null,
          postedAt: h.created_at ? new Date(h.created_at * 1000) : null,
          platform: "OTHER" as Platform,
        });
      }
    } catch (err) { console.error(`[discovery] yc query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 40);
};

// ── Adzuna (global job board with free API) ─────────────────────────────────
const fetchAdzunaJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  const allJobs: DiscoveredJob[] = [];
  const seenIds = new Set<string>();
  // Adzuna free RSS feed (no API key needed)
  for (const query of queries.slice(0, 2)) {
    try {
      const params = new URLSearchParams({ q: query, what: query, where: "remote", sort_by: "date" });
      const url = `https://www.adzuna.com/search?${params.toString()}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Parse job cards from HTML
      const jobMatches = html.matchAll(/<a[^>]*href="(\/jobs\/[^"]*)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi);
      for (const m of jobMatches) {
        const jobUrl = `https://www.adzuna.com${m[1]}`;
        const title = m[2]?.replace(/<[^>]*>/g, "").trim();
        const id = m[1].match(/\/(\d+)/)?.[1] ?? m[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        if (!matchesPreference([title], pref)) continue;
        allJobs.push({
          externalId: `adzuna_${id}`,
          jobUrl,
          applyUrl: jobUrl,
          title: title ?? null,
          company: null,
          location: "Remote",
          description: null,
          postedAt: null,
          platform: "OTHER" as Platform,
        });
      }
    } catch (err) { console.error(`[discovery] adzuna query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 30);
};

// ── Glassdoor RSS ──────────────────────────────────────────────────────────
const fetchGlassdoorRSSJobs = async (pref: SearchPreference): Promise<DiscoveredJob[]> => {
  const queries = buildQueries(pref);
  const allJobs: DiscoveredJob[] = [];
  const seenUrls = new Set<string>();
  for (const query of queries.slice(0, 2)) {
    try {
      const params = new URLSearchParams({ q: query, locT: "N", locKeyword: "remote" });
      const url = `https://www.glassdoor.com/Job/jobs.htm?${params.toString()}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "text/html",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Try to extract __NEXT_DATA__ or job listing data
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextDataMatch) continue;
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const listings = nextData?.props?.pageProps?.jobListings ?? [];
        for (const job of (listings as any[]).slice(0, 20)) {
          const jobUrl = job.seoJobLink ?? job.jobViewUrl ?? "";
          if (!jobUrl || seenUrls.has(jobUrl)) continue;
          seenUrls.add(jobUrl);
          if (!matchesPreference([job.jobTitle, job.companyName, job.jobDescription], pref)) continue;
          allJobs.push({
            externalId: `glassdoor_${job.jobId ?? jobUrl.slice(-20)}`,
            jobUrl: jobUrl.startsWith("http") ? jobUrl : `https://www.glassdoor.com${jobUrl}`,
            applyUrl: null,
            title: job.jobTitle ?? null,
            company: job.companyName ?? null,
            location: job.location ?? null,
            description: job.jobDescription?.replace(/<[^>]*>/g, " ").slice(0, 2000) ?? null,
            postedAt: job.listingAge ? new Date(Date.now() - job.listingAge * 86400000) : null,
            platform: "GLASSDOOR" as Platform,
          });
        }
      } catch {}
    } catch (err) { console.error(`[discovery] glassdoor query "${query}" failed`, err); }
  }
  return allJobs.slice(0, 30);
};

const sources: JobSource[] = [
  { name: "remotive", fetchJobs: fetchRemotiveJobs },
  { name: "arbeitnow", fetchJobs: fetchArbeitnowJobs },
  { name: "remoteok", fetchJobs: fetchRemoteOKJobs },
  { name: "himalayas", fetchJobs: fetchHimalayasJobs },
  { name: "jobicy", fetchJobs: fetchJobicyJobs },
  { name: "indeed-rss", fetchJobs: fetchIndeedRSSJobs },
  { name: "themuse", fetchJobs: fetchMuseJobs },
  { name: "wellfound", fetchJobs: fetchWellfoundJobs },
  { name: "naukri", fetchJobs: fetchNaukriJobs },
  { name: "yc-startups", fetchJobs: fetchYCJobs },
  { name: "adzuna", fetchJobs: fetchAdzunaJobs },
  { name: "glassdoor-rss", fetchJobs: fetchGlassdoorRSSJobs },
];

const normalizeRoleForQuery = (role: string) =>
  role
    .replace(/\s+/g, " ")
    .trim();

const buildQuery = (pref: SearchPreference) => {
  const primaryRole = pref.roles.find((role) => role.trim().length > 0)?.trim();
  if (primaryRole) {
    const normalized = normalizeRoleForQuery(primaryRole);
    if (normalized) {
      // Use a broader search: primary role words
      const words = normalized.split(/\s+/).filter((word) => word.length > 2);
      if (words.length >= 2) return `${words[0]} ${words[1]}`;
      return normalized;
    }
    return primaryRole;
  }
  return pref.keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
};

/** Build multiple search queries for broader coverage */
const buildQueries = (pref: SearchPreference): string[] => {
  const queries: string[] = [];
  const primaryQuery = buildQuery(pref);
  if (primaryQuery) queries.push(primaryQuery);

  // Add full-time variations of the primary role
  for (const role of (pref.roles ?? []).slice(0, 3)) {
    const trimmed = role.trim();
    if (!trimmed) continue;
    // Add the full role as-is (e.g. "Full Stack Engineer Intern")
    if (!queries.includes(trimmed)) queries.push(trimmed);
    // Also add without "intern" to find full-time roles
    const withoutIntern = trimmed.replace(/\b(intern|internship)\b/gi, "").replace(/\s+/g, " ").trim();
    if (withoutIntern && !queries.includes(withoutIntern)) queries.push(withoutIntern);
  }

  // Add queries for top keywords that are strong tech terms
  const strongKeywords = (pref.keywords ?? [])
    .filter((k) => k.trim().length > 2)
    .slice(0, 6);
  // Group keywords into pairs for better search results
  for (let i = 0; i < strongKeywords.length; i += 2) {
    const pair = strongKeywords.slice(i, i + 2).join(" ");
    if (pair && !queries.includes(pair)) queries.push(pair);
  }

  return queries.slice(0, 6); // max 6 queries (increased from 4 for broader coverage)
};

const scoringTerms = (pref: SearchPreference, limit = 8) =>
  Array.from(
    new Set(
      [...(pref.roles ?? []), ...(pref.keywords ?? [])]
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 2)
    )
  ).slice(0, limit);

const scoreJob = (job: DiscoveredJob, pref: SearchPreference) => {
  const titleHay = (job.title ?? "").toLowerCase();
  const descHay = (job.description ?? "").toLowerCase();
  const fullHay = [titleHay, (job.company ?? "").toLowerCase(), (job.location ?? "").toLowerCase(), descHay].join(" ");

  let score = 0;

  // ── 1. Role matching in title (0-0.35 max) ──
  const roles = (pref.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
  let bestRoleScore = 0;
  for (const role of roles) {
    if (titleHay.includes(role)) { bestRoleScore = Math.max(bestRoleScore, 0.35); continue; }
    const words = role.split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const wordMatches = words.filter((w) => titleHay.includes(w));
    const partialScore = 0.25 * (wordMatches.length / words.length);
    bestRoleScore = Math.max(bestRoleScore, partialScore);
  }
  score += bestRoleScore;

  // ── 2. Keyword matching in full text — each keyword hit counts (0-0.45 max) ──
  const keywords = (pref.keywords ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 1);
  if (keywords.length > 0) {
    let matchedCount = 0;
    for (const kw of keywords) {
      if (fullHay.includes(kw)) { matchedCount++; continue; }
      // For multi-word keywords, check individual words
      const kwWords = kw.split(/[\s/,]+/).filter((w) => w.length > 2);
      if (kwWords.length > 1 && kwWords.some((w) => fullHay.includes(w))) { matchedCount += 0.5; }
    }
    // Only need 3-4 keyword hits for a solid score
    score += 0.45 * Math.min(1, matchedCount / Math.min(keywords.length, 4));
  }

  // ── 3. Title keyword bonus for tech stack mentions (0-0.15 max) ──
  if (keywords.length > 0) {
    const titleKeywordHits = keywords.filter((kw) => titleHay.includes(kw));
    if (titleKeywordHits.length > 0) {
      score += 0.15 * Math.min(1, titleKeywordHits.length / 2);
    }
  }

  // ── 4. Description depth bonus (0-0.05 max) ──
  if (descHay.length > 100) {
    const allTerms = [...new Set([...roles, ...keywords].flatMap((t) => t.split(/[\s/,]+/).filter((w) => w.length > 2)))];
    const descMatches = allTerms.filter((t) => descHay.includes(t));
    if (allTerms.length > 0 && descMatches.length >= 3) {
      score += 0.05;
    }
  }

  return Math.min(1, score);
};

const matchesLocation = (job: DiscoveredJob, pref: SearchPreference) => {
  const locationText = (job.location ?? "").toLowerCase();
  // If user wants remote, accept jobs with remote signals or no location restriction
  if (pref.remote) {
    if (!locationText) return true;
    if (/(remote|anywhere|worldwide|global|work from home|wfh|distributed)/.test(locationText)) {
      return true;
    }
    // Also accept if the location doesn't explicitly say onsite/hybrid
    const onsiteSignals = /(on[\s-]?site|in[\s-]?office|hybrid|office[\s-]?based)/.test(locationText);
    if (!onsiteSignals) return true;
  }
  if (!pref.locations?.length) return true;
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
    // ── 50% match gate: only import jobs matching ≥ 50% of resume ──
    const preScore = scoreJob(job, pref);
    if (preScore < 0.25) continue; // Lowered from 0.5 to 0.25 to let more matching jobs through

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
