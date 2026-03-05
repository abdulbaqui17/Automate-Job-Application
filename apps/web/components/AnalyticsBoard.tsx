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

  // Filter out broken keywords like "S3", "CDN)", etc.
  const cleanKeywords = useMemo(() => {
    if (!summary?.keywordInsights) return [];
    return summary.keywordInsights.filter(
      (k) => k.keyword.length > 2 && !k.keyword.includes(")")  && !k.keyword.includes("(")
    );
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
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display), sans-serif", fontSize: "1.05rem", fontWeight: 600 }}>
            Analytics snapshot
          </h3>
          <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>{status}</p>
        </div>
        <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.82rem" }}>
          Refresh
        </button>
      </div>

      {!summary ? (
        <p className="helper">No analytics yet.</p>
      ) : (
        <>
          {/* Metrics grid */}
          <section className="metrics" style={{ marginBottom: 24 }}>
            {[
              { label: "Total jobs", value: summary.totalJobs, color: "#3dd5a3" },
              { label: "Total applications", value: summary.totalApplications, color: "#a78bfa" },
              { label: "Applied (7 days)", value: summary.appliedLast7Days, color: "#06b6d4" },
              { label: "Manual interventions", value: summary.manualCount, color: "#fbbf24" },
              { label: "Avg match score", value: summary.avgMatchScore === null ? "-" : `${Math.round(summary.avgMatchScore * 100)}%`, color: "#f472b6" },
              { label: "Conversion", value: `${Math.round(summary.conversionRate * 100)}%`, color: "#34d399" },
            ].map((item, i) => (
              <div key={item.label} className="metric" style={{ "--i": i } as React.CSSProperties}>
                <span>{item.label}</span>
                <h4>{item.value}</h4>
              </div>
            ))}
          </section>

          {/* Two-column grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
            {/* Status breakdown */}
            <div className="panel">
              <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 600 }}>Status breakdown</h3>
              {Object.keys(summary.statusCounts).length === 0 ? (
                <p className="helper">No applications yet.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "60%" }}>Status</th>
                        <th style={{ width: "40%" }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary.statusCounts).map(([statusKey, count]) => (
                        <tr key={statusKey}>
                          <td>{statusKey.replace(/_/g, " ")}</td>
                          <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Platforms */}
            <div className="panel">
              <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 600 }}>Platforms</h3>
              {Object.keys(summary.platformCounts).length === 0 ? (
                <p className="helper">No jobs discovered yet.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "60%" }}>Platform</th>
                        <th style={{ width: "40%" }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary.platformCounts).map(([platform, count]) => (
                        <tr key={platform}>
                          <td>{platform}</td>
                          <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Applications chart */}
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: "0.95rem", fontWeight: 600 }}>Applications (last 14 days)</h3>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 160, padding: "0 4px" }}>
                {summary.dailyApplications.map((day) => (
                  <div
                    key={day.date}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        minHeight: 4,
                        height: `${(day.count / maxDaily) * 100}%`,
                        borderRadius: "6px 6px 0 0",
                        background: day.count > 0
                          ? "linear-gradient(160deg, rgba(61, 213, 163, 0.7), rgba(6, 182, 212, 0.3))"
                          : "rgba(255, 255, 255, 0.04)",
                        boxShadow: day.count > 0 ? "0 0 12px rgba(61, 213, 163, 0.15)" : "none",
                        transition: "height 0.6s ease",
                      }}
                      title={`${day.date}: ${day.count}`}
                    />
                    <span style={{ fontSize: "0.65rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {day.date.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyword impact */}
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 600 }}>Keyword impact</h3>
              {cleanKeywords.length === 0 ? (
                <p className="helper">No keyword data yet. Add keywords in Settings.</p>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "35%" }}>Keyword</th>
                        <th style={{ width: "20%" }}>Matches</th>
                        <th style={{ width: "20%" }}>Applied</th>
                        <th style={{ width: "25%" }}>Applied rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cleanKeywords.map((row) => (
                        <tr key={row.keyword}>
                          <td style={{ fontWeight: 500 }}>{row.keyword}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.matches}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.applied}</td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 3,
                                background: "rgba(255,255,255,0.06)",
                                overflow: "hidden",
                              }}>
                                <div style={{
                                  width: `${Math.round(row.appliedRate * 100)}%`,
                                  height: "100%",
                                  borderRadius: 3,
                                  background: row.appliedRate > 0 ? "var(--accent)" : "transparent",
                                  transition: "width 0.6s ease",
                                }} />
                              </div>
                              <span style={{ fontSize: "0.78rem", fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
                                {Math.round(row.appliedRate * 100)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Company outcomes */}
            {summary.companyInsights.length > 0 && (
              <div className="panel" style={{ gridColumn: "1 / -1" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 600 }}>Company outcomes</h3>
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "35%" }}>Company</th>
                        <th style={{ width: "20%" }}>Total</th>
                        <th style={{ width: "20%" }}>Applied</th>
                        <th style={{ width: "25%" }}>Applied rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.companyInsights.map((row) => (
                        <tr key={row.company}>
                          <td style={{ fontWeight: 500 }}>{row.company}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.total}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.applied}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(row.appliedRate * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
