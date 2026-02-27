"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import LogStream from "./LogStream";
import StatusPill from "./StatusPill";
import CompanyAvatar from "./CompanyAvatar";
import ConfettiBurst from "./ConfettiBurst";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Summary = {
  totalApplications: number;
  appliedLast7Days: number;
  manualCount: number;
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

export default function OverviewBoard() {
  const [userId, setUserId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [status, setStatus] = useState("Ready");
  const [celebrate, setCelebrate] = useState(false);
  const prevApplied = useRef<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
    }
  }, []);

  const refresh = async (id = userId) => {
    if (!id) return;
    setStatus("Loading latest data...");
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
      setStatus("Failed to load dashboard data.");
    }
  };

  const metrics = useMemo(() => {
    const queued = summary?.statusCounts?.QUEUED ?? 0;
    const processing = summary?.statusCounts?.PROCESSING ?? 0;
    const applied = summary?.appliedLast7Days ?? 0;
    const manual = summary?.manualCount ?? summary?.statusCounts?.MANUAL_INTERVENTION ?? 0;
    return { queued, processing, applied, manual };
  }, [summary]);

  const recent = apps.slice(0, 6);

  useEffect(() => {
    if (!summary) return;
    const currentApplied = summary.appliedLast7Days ?? 0;
    const previous = prevApplied.current;
    prevApplied.current = currentApplied;
    if (previous !== null && currentApplied > previous) {
      setCelebrate(true);
      const timeout = setTimeout(() => setCelebrate(false), 2200);
      return () => clearTimeout(timeout);
    }
  }, [summary]);

  if (!userId) {
    return (
      <div className="panel">
        <h3>Overview</h3>
        <p className="helper">Set a user id in Settings to view live metrics.</p>
      </div>
    );
  }

  return (
    <div className="celebration">
      <ConfettiBurst active={celebrate} />
      <section className="metrics">
        <div className="metric" style={{ "--i": 0 } as CSSProperties}>
          <span>Jobs queued</span>
          <h4>{metrics.queued}</h4>
        </div>
        <div className="metric" style={{ "--i": 1 } as CSSProperties}>
          <span>In progress</span>
          <h4>{metrics.processing}</h4>
        </div>
        <div className="metric" style={{ "--i": 2 } as CSSProperties}>
          <span>Applied this week</span>
          <h4>{metrics.applied}</h4>
        </div>
        <div className="metric" style={{ "--i": 3 } as CSSProperties}>
          <span>Manual interventions</span>
          <h4>{metrics.manual}</h4>
        </div>
      </section>

      <section className="panel-grid">
        <div className="panel" style={{ "--i": 4 } as CSSProperties}>
          <div className="topbar" style={{ marginBottom: "12px" }}>
            <div>
              <h3 style={{ margin: 0 }}>Recent activity</h3>
              <p className="helper" style={{ margin: "6px 0 0" }}>
                {status}
              </p>
            </div>
            <button className="button ghost" onClick={() => refresh(userId)}>
              Refresh
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="helper">No recent applications yet.</p>
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
                {recent.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <a href={job.job.jobUrl} target="_blank" rel="noreferrer">
                        {job.job.title ?? job.job.jobUrl}
                      </a>
                    </td>
                    <td>
                      <div className="company-cell">
                        <CompanyAvatar
                          company={job.job.company}
                          jobUrl={job.job.jobUrl}
                        />
                        <span>{job.job.company ?? "-"}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill status={job.status} />
                    </td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel" style={{ "--i": 5 } as CSSProperties}>
          <h3>Log stream</h3>
          <p className="helper" style={{ marginTop: "4px" }}>
            Live automation events via WebSocket.
          </p>
          <LogStream />
        </div>
      </section>
    </div>
  );
}
