"use client";

import { useEffect, useState } from "react";
import StatusPill from "./StatusPill";
import CompanyAvatar from "./CompanyAvatar";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type JobLink = {
  matchId: string;
  score: number;
  applicationStatus: string | null;
  job: {
    id: string;
    title: string | null;
    company: string | null;
    location: string | null;
    jobUrl: string;
    applyUrl: string | null;
    platform: string;
    rawDescription: string | null;
    postedAt: string | null;
    createdAt: string;
  };
};

const scoreColor = (score: number) => {
  if (score >= 0.7) return "#3dd5a3";
  if (score >= 0.4) return "#fbbf24";
  return "#f87171";
};

const scoreLabel = (score: number) => {
  if (score >= 0.7) return "Strong match";
  if (score >= 0.4) return "Good match";
  if (score >= 0.2) return "Partial match";
  return "Low match";
};

const extractSkillsFromDesc = (desc: string | null, keywords: string[]): string[] => {
  if (!desc) return [];
  const lower = desc.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase())).slice(0, 8);
};

export default function JobLinksBoard() {
  const [userId, setUserId] = useState("");
  const [jobs, setJobs] = useState<JobLink[]>([]);
  const [userKeywords, setUserKeywords] = useState<string[]>([]);
  const [status, setStatus] = useState("Ready");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "high" | "unapplied">("all");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
      loadPreferences(stored).catch(() => undefined);
    }
  }, []);

  const loadPreferences = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/preferences/${id}`);
      if (res.ok) {
        const pref = await res.json();
        setUserKeywords(pref?.keywords ?? []);
      }
    } catch {}
  };

  const refresh = async (id = userId) => {
    if (!id) return;
    setStatus("Loading matched jobs...");
    try {
      const res = await fetch(`${apiUrl}/discovery/job-links?userId=${id}`);
      if (!res.ok) {
        setStatus("Failed to load job links.");
        return;
      }
      const data = (await res.json()) as JobLink[];
      setJobs(data);
      setStatus(`${data.length} matched job${data.length === 1 ? "" : "s"} found`);
    } catch {
      setStatus("Failed to reach API.");
    }
  };

  const runDiscovery = async () => {
    if (!userId) return;
    setStatus("Running discovery...");
    try {
      await fetch(`${apiUrl}/discovery/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setStatus("Discovery started. Refreshing in a few seconds...");
      setTimeout(() => refresh(userId), 5000);
    } catch {
      setStatus("Failed to trigger discovery.");
    }
  };

  const filtered = jobs.filter((j) => {
    if (filter === "high") return j.score >= 0.3;
    if (filter === "unapplied") return !j.applicationStatus;
    return true;
  });

  if (!userId) {
    return (
      <div className="panel">
        <h3>Job Links</h3>
        <p className="helper">Set up your account in Settings first.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      {/* Header */}
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display), sans-serif" }}>
            🔗 Job Links
          </h3>
          <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>
            {status} — Click any job to apply directly on the company site.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button primary" onClick={runDiscovery} style={{ fontSize: "0.82rem" }}>
            Find more jobs
          </button>
          <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.82rem" }}>
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {([
          { key: "all", label: `All (${jobs.length})` },
          { key: "high", label: `Best matches (${jobs.filter((j) => j.score >= 0.3).length})` },
          { key: "unapplied", label: `Not applied (${jobs.filter((j) => !j.applicationStatus).length})` },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`button ${filter === f.key ? "primary" : "ghost"}`}
            style={{ fontSize: "0.75rem", padding: "5px 12px", borderRadius: 20 }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Job cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <p style={{ fontSize: "1rem", marginBottom: 8 }}>No matched jobs yet</p>
          <p className="helper" style={{ fontSize: "0.85rem", maxWidth: 400, margin: "0 auto" }}>
            Click &quot;Find more jobs&quot; to discover positions matching your skills, or start the
            auto-apply from the Dashboard.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item) => {
            const isExpanded = expandedId === item.matchId;
            const matchedSkills = extractSkillsFromDesc(item.job.rawDescription, userKeywords);
            const applyLink = item.job.applyUrl || item.job.jobUrl;

            return (
              <div
                key={item.matchId}
                style={{
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: `1px solid ${item.score >= 0.4 ? "rgba(61, 213, 163, 0.2)" : "var(--glass-border)"}`,
                  borderRadius: 14,
                  padding: "16px 18px",
                  transition: "all 0.2s ease",
                }}
              >
                {/* Top row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <CompanyAvatar company={item.job.company} jobUrl={item.job.jobUrl} />
                      <div style={{ minWidth: 0 }}>
                        <h4 style={{
                          margin: 0,
                          fontSize: "0.95rem",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {item.job.title ?? "Untitled"}
                        </h4>
                        <p className="helper" style={{ margin: 0, fontSize: "0.78rem" }}>
                          {item.job.company ?? "Unknown"} · {item.job.location ?? "Remote"} · {item.job.platform}
                        </p>
                      </div>
                    </div>

                    {/* Matched skills */}
                    {matchedSkills.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                        {matchedSkills.map((skill) => (
                          <span
                            key={skill}
                            style={{
                              fontSize: "0.7rem",
                              padding: "2px 8px",
                              borderRadius: 12,
                              background: "rgba(61, 213, 163, 0.12)",
                              color: "#3dd5a3",
                              fontWeight: 500,
                            }}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right side: score + apply button */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color: scoreColor(item.score),
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {(item.score * 100).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
                        {scoreLabel(item.score)}
                      </div>
                    </div>

                    {item.applicationStatus ? (
                      <StatusPill status={item.applicationStatus} />
                    ) : (
                      <a
                        href={applyLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "7px 16px",
                          borderRadius: 10,
                          background: "linear-gradient(135deg, var(--accent), #06b6d4)",
                          color: "#000",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          textDecoration: "none",
                          transition: "all 0.2s ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Apply now ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Expandable description */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.matchId)}
                  className="button ghost"
                  style={{
                    fontSize: "0.72rem",
                    padding: "4px 8px",
                    marginTop: 8,
                    color: "var(--muted)",
                  }}
                >
                  {isExpanded ? "Hide description ▲" : "Show description ▼"}
                </button>

                {isExpanded && item.job.rawDescription && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 14,
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.15)",
                      fontSize: "0.8rem",
                      lineHeight: 1.6,
                      maxHeight: 300,
                      overflowY: "auto",
                      color: "var(--muted)",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: item.job.rawDescription.slice(0, 3000),
                    }}
                  />
                )}

                {/* Posted date */}
                {item.job.postedAt && (
                  <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.7rem" }}>
                    Posted {new Date(item.job.postedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
