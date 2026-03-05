"use client";

import { useEffect, useMemo, useState } from "react";
import Topbar from "../../../components/Topbar";
import StatusPill from "../../../components/StatusPill";
import PageWrapper from "../../../components/PageWrapper";
import AnimatedNumber from "../../../components/AnimatedNumber";

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
      <PageWrapper>
        <Topbar title="Queue" />
        <div className="panel">
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "1.05rem",
              fontWeight: 600,
            }}
          >
            Queue status
          </h3>
          <p className="helper">Set a user id in Settings to view queue status.</p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <Topbar title="Queue" />
      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-display), sans-serif",
                fontSize: "1.05rem",
                fontWeight: 600,
              }}
            >
              Queue status
            </h3>
            <p className="helper" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
              {status}
            </p>
          </div>
          <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
            Refresh
          </button>
        </div>

        <section className="metrics" style={{ marginBottom: 24 }}>
          <div className="metric">
            <span>Queued</span>
            <h4><AnimatedNumber value={queuedCount} /></h4>
          </div>
          <div className="metric">
            <span>Processing</span>
            <h4><AnimatedNumber value={processingCount} /></h4>
          </div>
        </section>

        {queueItems.length === 0 ? (
          <p className="helper">No queued applications right now.</p>
        ) : (
          <div className="table-wrapper">
            <table className="activity-table">
              <thead>
                <tr>
                  <th className="col-role">Role</th>
                  <th className="col-company">Company</th>
                  <th className="col-status">Status</th>
                  <th className="col-updated">Updated</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.map((item) => (
                  <tr key={item.id}>
                    <td className="col-role">
                      <a
                        href={item.job.jobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="role-link"
                        title={item.job.title ?? item.job.jobUrl}
                      >
                        {item.job.title ?? item.job.jobUrl}
                      </a>
                    </td>
                    <td className="col-company">
                      <span className="company-name">{item.job.company ?? "-"}</span>
                    </td>
                    <td className="col-status">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="col-updated" title={new Date(item.updatedAt).toLocaleString()}>
                      {new Date(item.updatedAt).toLocaleDateString(undefined, {
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
    </PageWrapper>
  );
}
