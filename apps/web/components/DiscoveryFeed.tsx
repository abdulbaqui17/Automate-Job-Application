"use client";

import { useEffect, useState } from "react";
import StatusPill from "./StatusPill";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Match = {
  id: string;
  score: number;
  job: {
    id: string;
    title: string | null;
    company: string | null;
    location: string | null;
    jobUrl: string;
    platform: string;
    createdAt: string;
  };
};

type Job = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  jobUrl: string;
  platform: string;
  createdAt: string;
};

type Batch = {
  id: string;
  status: string;
  createdAt: string;
};

const scoreColor = (score: number) => {
  if (score >= 0.5) return "#3dd5a3";
  if (score >= 0.3) return "#fbbf24";
  return "var(--muted)";
};

export default function DiscoveryFeed() {
  const [userId, setUserId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [status, setStatus] = useState("Ready");
  const [tab, setTab] = useState<"matches" | "jobs" | "runs">("matches");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
    }
  }, []);

  const refresh = async (id = userId) => {
    if (!id) return;
    setStatus("Loading latest discovery...");
    try {
      const [matchesRes, jobsRes, batchesRes] = await Promise.all([
        fetch(`${apiUrl}/discovery/matches?userId=${id}`),
        fetch(`${apiUrl}/discovery/jobs?userId=${id}`),
        fetch(`${apiUrl}/discovery/batches?userId=${id}`),
      ]);
      if (matchesRes.ok) setMatches((await matchesRes.json()) ?? []);
      if (jobsRes.ok) setJobs((await jobsRes.json()) ?? []);
      if (batchesRes.ok) setBatches((await batchesRes.json()) ?? []);
    } catch (err) {
      console.error("Failed to refresh discovery data:", err);
      setStatus("Failed to load discovery data.");
      return;
    }
    setStatus("Ready");
  };

  const runDiscovery = async () => {
    if (!userId) {
      setStatus("Create a user in Settings first.");
      return;
    }
    setStatus("Triggering discovery...");
    const res = await fetch(`${apiUrl}/discovery/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Failed to run discovery: ${error.error ?? res.status}`);
      return;
    }
    setStatus("Discovery queued. Refreshing...");
    setTimeout(() => refresh(userId), 2500);
  };

  const tabs = [
    { key: "matches" as const, label: `Top matches (${matches.length})` },
    { key: "jobs" as const, label: `All jobs (${jobs.length})` },
    { key: "runs" as const, label: `Runs (${batches.length})` },
  ];

  return (
    <div className="panel">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display), sans-serif", fontSize: "1.05rem", fontWeight: 600 }}>
            Latest discovery
          </h3>
          <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>{status}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.82rem" }}>
            Refresh
          </button>
          <button className="button primary" onClick={runDiscovery} style={{ fontSize: "0.82rem" }}>
            Run discovery now
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`button ${tab === t.key ? "primary" : "ghost"}`}
            style={{ fontSize: "0.78rem", padding: "6px 14px", borderRadius: 20 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Top matches */}
      {tab === "matches" && (
        matches.length === 0 ? (
          <p className="helper" style={{ textAlign: "center", padding: 32 }}>No matches yet. Run discovery to find jobs.</p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Title</th>
                  <th style={{ width: "22%" }}>Company</th>
                  <th style={{ width: "13%" }}>Score</th>
                  <th style={{ width: "13%" }}>Platform</th>
                  <th style={{ width: "12%" }}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td>
                      <a href={match.job.jobUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        {match.job.title ?? "Untitled"}
                      </a>
                    </td>
                    <td>{match.job.company ?? "-"}</td>
                    <td>
                      <span style={{ fontWeight: 600, color: scoreColor(match.score), fontVariantNumeric: "tabular-nums" }}>
                        {(match.score * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: "0.72rem",
                        padding: "3px 8px",
                        borderRadius: 12,
                        background: "rgba(61, 213, 163, 0.08)",
                        border: "1px solid rgba(61, 213, 163, 0.12)",
                        fontWeight: 500,
                      }}>
                        {match.job.platform}
                      </span>
                    </td>
                    <td>
                      <a
                        href={match.job.jobUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 8,
                          background: "linear-gradient(135deg, var(--accent), #06b6d4)",
                          color: "#000",
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Apply ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* All jobs */}
      {tab === "jobs" && (
        jobs.length === 0 ? (
          <p className="helper" style={{ textAlign: "center", padding: 32 }}>No jobs discovered yet.</p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>Title</th>
                  <th style={{ width: "20%" }}>Company</th>
                  <th style={{ width: "18%" }}>Location</th>
                  <th style={{ width: "12%" }}>Platform</th>
                  <th style={{ width: "15%" }}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <a href={job.jobUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        {job.title ?? "Untitled"}
                      </a>
                    </td>
                    <td>{job.company ?? "-"}</td>
                    <td>{job.location ?? "Remote"}</td>
                    <td>
                      <span style={{
                        fontSize: "0.72rem",
                        padding: "3px 8px",
                        borderRadius: 12,
                        background: "rgba(61, 213, 163, 0.08)",
                        border: "1px solid rgba(61, 213, 163, 0.12)",
                        fontWeight: 500,
                      }}>
                        {job.platform}
                      </span>
                    </td>
                    <td>
                      <a
                        href={job.jobUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 8,
                          background: "linear-gradient(135deg, var(--accent), #06b6d4)",
                          color: "#000",
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Apply ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Discovery runs */}
      {tab === "runs" && (
        batches.length === 0 ? (
          <p className="helper" style={{ textAlign: "center", padding: 32 }}>No runs yet.</p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>Batch</th>
                  <th style={{ width: "30%" }}>Status</th>
                  <th style={{ width: "35%" }}>Started</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.82rem" }}>
                      {batch.id.slice(0, 8)}
                    </td>
                    <td>
                      <StatusPill status={batch.status} />
                    </td>
                    <td>{new Date(batch.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
