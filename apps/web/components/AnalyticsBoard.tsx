"use client";

import { useEffect, useMemo, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Summary = {
  totalJobs: number;
  totalApplications: number;
  appliedLast7Days: number;
  manualCount: number;
  statusCounts: Record<string, number>;
  platformCounts: Record<string, number>;
  avgMatchScore: number | null;
  dailyApplications: Array<{ date: string; count: number }>;
  appliedCount: number;
  conversionRate: number;
  hourlyApplications: Array<{ hour: number; total: number; applied: number }>;
  bestHour: { hour: number; total: number; applied: number; appliedRate: number } | null;
  keywordInsights: Array<{ keyword: string; matches: number; applied: number; appliedRate: number }>;
  companyInsights: Array<{ company: string; total: number; applied: number; appliedRate: number }>;
};

export default function AnalyticsBoard() {
  const [userId, setUserId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
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
    setStatus("Loading analytics...");
    const res = await fetch(`${apiUrl}/analytics/summary?userId=${id}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Failed to load: ${err.error ?? res.status}`);
      return;
    }
    const data = (await res.json()) as Summary;
    setSummary(data);
    setStatus("Ready");
  };

  const maxDaily = useMemo(() => {
    if (!summary?.dailyApplications?.length) return 1;
    return Math.max(...summary.dailyApplications.map((d) => d.count), 1);
  }, [summary]);

  const maxHourly = useMemo(() => {
    if (!summary?.hourlyApplications?.length) return 1;
    return Math.max(...summary.hourlyApplications.map((d) => d.total), 1);
  }, [summary]);

  if (!userId) {
    return (
      <div className="panel">
        <h3>Analytics</h3>
        <p className="helper">Set a user id in Settings to view analytics.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Analytics snapshot</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {status}
          </p>
        </div>
        <button className="button ghost" onClick={() => refresh(userId)}>
          Refresh
        </button>
      </div>

      {!summary ? (
        <p className="helper">No analytics yet.</p>
      ) : (
        <>
          <section className="metrics">
            <div className="metric">
              <span>Total jobs</span>
              <h4>{summary.totalJobs}</h4>
            </div>
            <div className="metric">
              <span>Total applications</span>
              <h4>{summary.totalApplications}</h4>
            </div>
            <div className="metric">
              <span>Applied (7 days)</span>
              <h4>{summary.appliedLast7Days}</h4>
            </div>
            <div className="metric">
              <span>Manual interventions</span>
              <h4>{summary.manualCount}</h4>
            </div>
            <div className="metric">
              <span>Avg match score</span>
              <h4>
                {summary.avgMatchScore === null
                  ? "-"
                  : `${Math.round(summary.avgMatchScore * 100)}%`}
              </h4>
            </div>
            <div className="metric">
              <span>Conversion</span>
              <h4>{Math.round(summary.conversionRate * 100)}%</h4>
            </div>
          </section>

          <section className="panel-grid">
            <div className="panel">
              <h3>Status breakdown</h3>
              {Object.keys(summary.statusCounts).length === 0 ? (
                <p className="helper">No applications yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.statusCounts).map(([statusKey, count]) => (
                      <tr key={statusKey}>
                        <td>{statusKey}</td>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>Platforms</h3>
              {Object.keys(summary.platformCounts).length === 0 ? (
                <p className="helper">No jobs discovered yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.platformCounts).map(([platform, count]) => (
                      <tr key={platform}>
                        <td>{platform}</td>
                        <td>{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>Applications (last 14 days)</h3>
              <div className="chart">
                {summary.dailyApplications.map((day) => (
                  <div key={day.date} className="chart-column">
                    <div
                      className="chart-bar"
                      style={{ height: `${(day.count / maxDaily) * 100}%` }}
                      title={`${day.date}: ${day.count}`}
                    />
                    <span>{day.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>Best time to apply</h3>
              <p className="helper" style={{ marginTop: "6px" }}>
                {summary.bestHour ? (
                  <>
                    Best hour: {summary.bestHour.hour}:00 (
                    {Math.round(summary.bestHour.appliedRate * 100)}% applied)
                  </>
                ) : (
                  "Not enough data yet."
                )}
              </p>
              <div className="chart compact">
                {summary.hourlyApplications.map((hour) => (
                  <div key={hour.hour} className="chart-column">
                    <div
                      className="chart-bar alt"
                      style={{ height: `${(hour.total / maxHourly) * 100}%` }}
                      title={`${hour.hour}:00 — ${hour.total} apps`}
                    />
                    <span>{hour.hour}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>Keyword impact</h3>
              {summary.keywordInsights.length === 0 ? (
                <p className="helper">No keyword data yet. Add keywords in Settings.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Keyword</th>
                      <th>Matches</th>
                      <th>Applied</th>
                      <th>Applied rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.keywordInsights.map((row) => (
                      <tr key={row.keyword}>
                        <td>{row.keyword}</td>
                        <td>{row.matches}</td>
                        <td>{row.applied}</td>
                        <td>{Math.round(row.appliedRate * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>Company outcomes</h3>
              {summary.companyInsights.length === 0 ? (
                <p className="helper">No company data yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Total</th>
                      <th>Applied</th>
                      <th>Applied rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.companyInsights.map((row) => (
                      <tr key={row.company}>
                        <td>{row.company}</td>
                        <td>{row.total}</td>
                        <td>{row.applied}</td>
                        <td>{Math.round(row.appliedRate * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
