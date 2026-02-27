"use client";

import { useEffect, useMemo, useState } from "react";
import Topbar from "../../../components/Topbar";
import StatusPill from "../../../components/StatusPill";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Summary = {
  statusCounts: Record<string, number>;
};

type ApplicationRow = {
  id: string;
  status: string;
  updatedAt: string;
  job: {
    title: string | null;
    company: string | null;
    jobUrl: string;
  };
};

export default function QueuePage() {
  const [userId, setUserId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [apps, setApps] = useState<ApplicationRow[]>([]);
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
    setStatus("Loading queue...");
    try {
      const [summaryRes, appsRes] = await Promise.all([
        fetch(`${apiUrl}/analytics/summary?userId=${id}`),
        fetch(`${apiUrl}/applications?userId=${id}`),
      ]);
      if (summaryRes.ok) {
        const data = (await summaryRes.json()) as Summary;
        setSummary(data);
      }
      if (appsRes.ok) {
        const data = (await appsRes.json()) as ApplicationRow[];
        setApps(data ?? []);
      }
      setStatus("Ready");
    } catch (err) {
      console.error(err);
      setStatus("Failed to load queue data.");
    }
  };

  const queueItems = useMemo(
    () => apps.filter((app) => ["QUEUED", "PROCESSING"].includes(app.status)),
    [apps]
  );

  const queuedCount = summary?.statusCounts?.QUEUED ?? 0;
  const processingCount = summary?.statusCounts?.PROCESSING ?? 0;

  if (!userId) {
    return (
      <div>
        <Topbar title="Queue" />
        <div className="panel">
          <h3>Queue status</h3>
          <p className="helper">Set a user id in Settings to view queue status.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Queue" />
      <div className="panel">
        <div className="topbar" style={{ marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0 }}>Queue status</h3>
            <p className="helper" style={{ margin: "6px 0 0" }}>
              {status}
            </p>
          </div>
          <button className="button ghost" onClick={() => refresh(userId)}>
            Refresh
          </button>
        </div>

        <section className="metrics" style={{ marginBottom: "20px" }}>
          <div className="metric">
            <span>Queued</span>
            <h4>{queuedCount}</h4>
          </div>
          <div className="metric">
            <span>Processing</span>
            <h4>{processingCount}</h4>
          </div>
        </section>

        {queueItems.length === 0 ? (
          <p className="helper">No queued applications right now.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={item.job.jobUrl} target="_blank" rel="noreferrer">
                      {item.job.title ?? item.job.jobUrl}
                    </a>
                  </td>
                  <td>{item.job.company ?? "-"}</td>
                  <td>
                    <StatusPill status={item.status} />
                  </td>
                  <td>{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
