"use client";

import { useEffect, useState } from "react";
import StatusPill from "./StatusPill";
import CompanyAvatar from "./CompanyAvatar";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ApplicationRow = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  job: {
    title: string | null;
    company: string | null;
    platform: string;
    jobUrl: string;
  };
};

export default function JobsBoard() {
  const [userId, setUserId] = useState("");
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [status, setStatus] = useState("Ready");
  const [urls, setUrls] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
    }
  }, []);

  const refresh = async (id = userId) => {
    if (!id) return;
    setStatus("Loading applications...");
    const res = await fetch(`${apiUrl}/applications?userId=${id}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Failed to load: ${err.error ?? res.status}`);
      return;
    }
    const data = (await res.json()) as ApplicationRow[];
    setApps(data ?? []);
    setStatus("Ready");
  };

  const handleImport = async () => {
    if (!userId) {
      setStatus("Create a user in Settings first.");
      return;
    }
    const list = urls
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (list.length === 0) {
      setStatus("Paste one or more URLs.");
      return;
    }

    setStatus("Queuing jobs...");
    const res = await fetch(`${apiUrl}/jobs/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, urls: list }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Import failed: ${err.error ?? res.status}`);
      return;
    }
    const summary = await res.json();
    setStatus(
      `Queued: ${summary.created}, duplicates: ${summary.duplicates}, failed: ${summary.failed}`
    );
    setUrls("");
    setTimeout(() => refresh(userId), 1200);
  };

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Applications</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {status}
          </p>
        </div>
        <button className="button ghost" onClick={() => refresh(userId)}>
          Refresh
        </button>
      </div>

      <div className="panel" style={{ marginBottom: "16px" }}>
        <h3>Bulk URL import</h3>
        <p className="helper" style={{ marginTop: "4px" }}>
          Paste one job URL per line to queue them instantly.
        </p>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={4}
          style={{ width: "100%", marginTop: "10px" }}
          placeholder="https://www.linkedin.com/jobs/view/..."
        />
        <div className="cta-row" style={{ marginTop: "12px" }}>
          <button className="button primary" onClick={handleImport}>
            Queue URLs
          </button>
        </div>
      </div>

      {apps.length === 0 ? (
        <p className="helper">No applications yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Company</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => (
              <tr key={app.id}>
                <td>
                  <a href={app.job.jobUrl} target="_blank" rel="noreferrer">
                    {app.job.title ?? app.job.jobUrl}
                  </a>
                </td>
                <td>
                  <div className="company-cell">
                    <CompanyAvatar company={app.job.company} jobUrl={app.job.jobUrl} />
                    <span>{app.job.company ?? "-"}</span>
                  </div>
                </td>
                <td>{app.job.platform}</td>
                <td>
                  <StatusPill status={app.status} />
                </td>
                <td>{new Date(app.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
