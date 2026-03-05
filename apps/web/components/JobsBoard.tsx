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
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
    }
  }, []);

  /* Auto-refresh every 15s */
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => refresh(userId).catch(() => undefined), 15_000);
    return () => clearInterval(interval);
  }, [userId]);

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
    setStatus(`${data.length} application${data.length === 1 ? "" : "s"}`);
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
    setShowImport(false);
    setTimeout(() => refresh(userId), 1200);
  };

  const statuses = ["ALL", ...new Set(apps.map((a) => a.status))];
  const filtered = filter === "ALL" ? apps : apps.filter((a) => a.status === filter);

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Applications</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {status}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="button ghost"
            onClick={() => setShowImport((v) => !v)}
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
          >
            {showImport ? "Hide import" : "Import URLs"}
          </button>
          <button className="button ghost" onClick={() => refresh(userId)}>
            Refresh
          </button>
        </div>
      </div>

      {/* Collapsible URL import */}
      {showImport && (
        <div
          className="panel"
          style={{
            marginBottom: "16px",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
          }}
        >
          <p className="helper" style={{ margin: "0 0 8px", fontSize: "0.8rem" }}>
            Paste one job URL per line to queue them manually. The platform will auto-apply for you — this is optional.
          </p>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            style={{ width: "100%", fontSize: "0.85rem" }}
            placeholder="https://www.linkedin.com/jobs/view/..."
          />
          <div className="cta-row" style={{ marginTop: "8px" }}>
            <button className="button primary" onClick={handleImport} style={{ fontSize: "0.82rem" }}>
              Queue URLs
            </button>
          </div>
        </div>
      )}

      {/* Status filter pills */}
      {apps.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`button ${filter === s ? "primary" : "ghost"}`}
              style={{ fontSize: "0.75rem", padding: "4px 10px", borderRadius: 20 }}
            >
              {s === "ALL" ? `All (${apps.length})` : `${s} (${apps.filter((a) => a.status === s).length})`}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <p className="helper" style={{ fontSize: "0.9rem" }}>
            No applications yet. Start the auto-apply from the Dashboard to begin.
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="activity-table">
            <thead>
              <tr>
                <th className="col-role">Role</th>
                <th className="col-company">Company</th>
                <th className="col-status">Platform</th>
                <th className="col-status">Status</th>
                <th className="col-updated">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id}>
                  <td className="col-role">
                    <a
                      href={app.job.jobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="role-link"
                      title={app.job.title ?? app.job.jobUrl}
                    >
                      {app.job.title ?? app.job.jobUrl}
                    </a>
                  </td>
                  <td className="col-company">
                    <div className="company-cell">
                      <CompanyAvatar company={app.job.company} jobUrl={app.job.jobUrl} />
                      <span className="company-name">{app.job.company ?? "-"}</span>
                    </div>
                  </td>
                  <td className="col-status">{app.job.platform}</td>
                  <td className="col-status">
                    <StatusPill status={app.status} />
                  </td>
                  <td className="col-updated" title={new Date(app.updatedAt).toLocaleString()}>
                    {new Date(app.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
