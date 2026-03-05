"use client";

import { useEffect, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws?token=dev-token";
const runStateKey = "applycraft_auto_apply_run_state";

type LogEntry = {
  time: string;
  message: string;
  type: string;
};

type RunPhase = "idle" | "running" | "done";

type PersistedRunState = {
  phase: RunPhase;
  logs: LogEntry[];
};

const typeIcon: Record<string, string> = {
  JOB_STARTED: "🔍",
  STEP_COMPLETED: "✅",
  ERROR_OCCURRED: "❌",
  JOB_FINISHED: "🎉",
};

export default function StartApplyingPanel() {
  const [userId, setUserId] = useState("");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) setUserId(stored);

    const persisted = window.localStorage.getItem(runStateKey);
    if (!persisted) return;
    try {
      const parsed = JSON.parse(persisted) as PersistedRunState;
      if (parsed.phase && Array.isArray(parsed.logs)) {
        setPhase(parsed.phase);
        setLogs(parsed.logs);
      }
    } catch {
      window.localStorage.removeItem(runStateKey);
    }
  }, []);

  useEffect(() => {
    if (phase === "idle" && logs.length === 0) {
      window.localStorage.removeItem(runStateKey);
      return;
    }
    window.localStorage.setItem(runStateKey, JSON.stringify({ phase, logs }));
  }, [phase, logs]);

  /* auto-scroll log to bottom */
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  /* WebSocket listener for live events */
  useEffect(() => {
    if (phase !== "running") return;

    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          timestamp: string;
          message: string;
          type: string;
        };
        const entry: LogEntry = {
          time: new Date(data.timestamp).toLocaleTimeString(),
          message: data.message,
          type: data.type,
        };
        setLogs((prev) => [...prev, entry].slice(-300));

        if (
          data.type === "JOB_FINISHED" ||
          data.message.toLowerCase().includes("discovery complete")
        ) {
          setPhase("done");
        }
      } catch {
        /* ignore */
      }
    };

    return () => socket.close();
  }, [phase]);

  const resetRunState = () => {
    setPhase("idle");
    setLogs([]);
    setError("");
    window.localStorage.removeItem(runStateKey);
  };

  const startApplying = async () => {
    if (!userId) {
      setError("Go to Settings first — upload your resume.");
      return;
    }
    setError("");
    setLogs([
      {
        time: new Date().toLocaleTimeString(),
        message: "Starting automation — searching LinkedIn & Indeed for matching jobs...",
        type: "INFO",
      },
    ]);
    setPhase("running");

    try {
      const res = await fetch(`${apiUrl}/automation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? `Failed (${res.status})`);
        setPhase("idle");
        setLogs([]);
        return;
      }
    } catch {
      setError("Could not reach the API.");
      setPhase("idle");
      setLogs([]);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      {/* Header */}
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
            🚀 Auto Apply
          </h3>
          <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>
            {phase === "idle" &&
              "Searches LinkedIn & Indeed, matches with your resume, tailors CV, applies, and messages the HR."}
            {phase === "running" && "Automation is running — watch live progress below."}
            {phase === "done" && "Run complete! Check the Jobs tab for results."}
          </p>
        </div>
        <button
          className="button primary"
          onClick={phase === "done" ? resetRunState : startApplying}
          disabled={phase === "running"}
          style={{ minWidth: 140, fontSize: "0.85rem" }}
        >
          {phase === "idle" && "Start applying"}
          {phase === "running" && "Running..."}
          {phase === "done" && "Run again"}
        </button>
      </div>

      {error && (
        <p style={{ color: "#f87171", margin: "0 0 8px", fontSize: "0.82rem" }}>
          {error}
        </p>
      )}

      {/* Live log stream */}
      {(phase === "running" || phase === "done") && (
        <div
          ref={logRef}
          style={{
            background: "rgba(0, 0, 0, 0.2)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--glass-border)",
            borderRadius: 12,
            padding: 14,
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.82rem",
            lineHeight: 1.7,
          }}
        >
          {logs.map((entry, i) => (
            <div key={i} style={{ opacity: 0.9 }}>
              <span style={{ opacity: 0.4 }}>[{entry.time}]</span>{" "}
              {typeIcon[entry.type] ?? "▸"} {entry.message}
            </div>
          ))}
          {phase === "running" && (
            <div style={{ opacity: 0.4, marginTop: 4 }}>⏳ Waiting for events...</div>
          )}
        </div>
      )}

      {/* How it works — shown in idle */}
      {phase === "idle" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginTop: 16,
          }}
        >
          {[
            { icon: "🔍", label: "Search jobs", desc: "LinkedIn + Indeed" },
            { icon: "🤖", label: "AI scoring", desc: "Match vs your resume" },
            { icon: "📝", label: "Tailor resume", desc: "Per job description" },
            { icon: "📨", label: "Auto apply", desc: "Fill forms & submit" },
            { icon: "💬", label: "Message HR", desc: "DM the poster" },
          ].map((step) => (
            <div
              key={step.label}
              style={{
                textAlign: "center",
                padding: "16px 10px",
                borderRadius: 12,
                background: "var(--glass-bg)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                transition: "all 0.3s ease",
              }}
            >
              <div style={{ fontSize: 22 }}>{step.icon}</div>
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginTop: 6 }}>{step.label}</div>
              <div className="helper" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                {step.desc}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
