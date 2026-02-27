"use client";

import { useEffect, useState } from "react";

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

export default function DiscoveryFeed() {
  const [userId, setUserId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [status, setStatus] = useState("Ready");

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
    const [matchesRes, jobsRes, batchesRes] = await Promise.all([
      fetch(`${apiUrl}/discovery/matches?userId=${id}`),
      fetch(`${apiUrl}/discovery/jobs?userId=${id}`),
      fetch(`${apiUrl}/discovery/batches?userId=${id}`),
    ]);
    if (matchesRes.ok) {
      const data = await matchesRes.json();
      setMatches(data ?? []);
    }
    if (jobsRes.ok) {
      const data = await jobsRes.json();
      setJobs(data ?? []);
    }
    if (batchesRes.ok) {
      const data = await batchesRes.json();
      setBatches(data ?? []);
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

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Latest discovery</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {status}
          </p>
        </div>
        <div className="cta-row">
          <button className="button ghost" onClick={() => refresh(userId)}>
            Refresh
          </button>
          <button className="button primary" onClick={runDiscovery}>
            Run discovery now
          </button>
        </div>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h3>Top matches</h3>
          {matches.length === 0 ? (
            <p className="helper">No matches yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Score</th>
                  <th>Platform</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td>
                      <a href={match.job.jobUrl} target="_blank" rel="noreferrer">
                        {match.job.title ?? match.job.jobUrl}
                      </a>
                    </td>
                    <td>{match.job.company ?? "-"}</td>
                    <td>{(match.score * 100).toFixed(0)}%</td>
                    <td>{match.job.platform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>Latest jobs</h3>
          {jobs.length === 0 ? (
            <p className="helper">No jobs discovered yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Platform</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <a href={job.jobUrl} target="_blank" rel="noreferrer">
                        {job.title ?? job.jobUrl}
                      </a>
                    </td>
                    <td>{job.company ?? "-"}</td>
                    <td>{job.location ?? "-"}</td>
                    <td>{job.platform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>Discovery runs</h3>
          {batches.length === 0 ? (
            <p className="helper">No runs yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.id.slice(0, 8)}</td>
                    <td>{batch.status}</td>
                    <td>{new Date(batch.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
