"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import LogStream from "./LogStream";
import StatusPill from "./StatusPill";
import CompanyAvatar from "./CompanyAvatar";
import ConfettiBurst from "./ConfettiBurst";
import AnimatedNumber from "./AnimatedNumber";

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

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.08,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  }),
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

  /* Auto-refresh every 10s while automation is running */
  useEffect(() => {
    if (!userId) return;
    const runState = window.localStorage.getItem("applycraft_auto_apply_run_state");
    let isRunning = false;
    try {
      isRunning = runState ? JSON.parse(runState)?.phase === "running" : false;
    } catch {}

    // Also listen for localStorage changes from StartApplyingPanel
    const onStorage = (e: StorageEvent) => {
      if (e.key === "applycraft_auto_apply_run_state") {
        refresh(userId).catch(() => undefined);
      }
    };
    window.addEventListener("storage", onStorage);

    // Poll every 10s if running, every 30s otherwise
    const interval = setInterval(
      () => refresh(userId).catch(() => undefined),
      isRunning ? 10_000 : 30_000
    );

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

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

  const metricItems = [
    { label: "Jobs queued", value: metrics.queued, accent: "#3dd5a3" },
    { label: "In progress", value: metrics.processing, accent: "#a78bfa" },
    { label: "Applied this week", value: metrics.applied, accent: "#06b6d4" },
    { label: "Manual interventions", value: metrics.manual, accent: "#fbbf24" },
  ];

  return (
    <div className="celebration">
      <ConfettiBurst active={celebrate} />

      {/* Stats Grid */}
      <section className="metrics">
        {metricItems.map((item, i) => (
          <motion.div
            key={item.label}
            className="metric"
            style={{ "--i": i } as CSSProperties}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
          >
            <span>{item.label}</span>
            <h4>
              <AnimatedNumber value={item.value} />
            </h4>
            {/* Subtle glow under number */}
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 60,
                height: 20,
                background: `radial-gradient(ellipse, ${item.accent}22, transparent)`,
                filter: "blur(8px)",
                pointerEvents: "none",
              }}
            />
          </motion.div>
        ))}
      </section>

      {/* Main Grid: Activity + Logs */}
      <section className="panel-grid">
        <motion.div
          className="panel"
          style={{ "--i": 4 } as CSSProperties}
          custom={4}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
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
                Recent activity
              </h3>
              <p className="helper" style={{ margin: "4px 0 0", fontSize: "0.8rem" }}>
                {status}
              </p>
            </div>
            <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
              Refresh
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="helper">No recent applications yet.</p>
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
                  {recent.map((job) => (
                    <tr key={job.id}>
                      <td className="col-role">
                        <a
                          href={job.job.jobUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={job.job.title ?? job.job.jobUrl}
                          className="role-link"
                        >
                          {job.job.title ?? job.job.jobUrl}
                        </a>
                      </td>
                      <td className="col-company">
                        <div className="company-cell" title={job.job.company ?? ""}>
                          <CompanyAvatar
                            company={job.job.company}
                            jobUrl={job.job.jobUrl}
                          />
                          <span className="company-name">{job.job.company ?? "-"}</span>
                        </div>
                      </td>
                      <td className="col-status">
                        <StatusPill status={job.status} />
                      </td>
                      <td className="col-updated" title={new Date(job.updatedAt).toLocaleString()}>
                        {new Date(job.updatedAt).toLocaleDateString(undefined, {
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
        </motion.div>

        <motion.div
          className="panel"
          style={{ "--i": 5 } as CSSProperties}
          custom={5}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "1.05rem",
              fontWeight: 600,
            }}
          >
            Log stream
          </h3>
          <p className="helper" style={{ marginTop: 4, fontSize: "0.8rem" }}>
            Live automation events via WebSocket.
          </p>
          <div style={{ marginTop: 12 }}>
            <LogStream />
          </div>
        </motion.div>
      </section>
    </div>
  );
}
