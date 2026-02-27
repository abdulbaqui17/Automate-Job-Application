"use client";

import { useEffect, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws?token=dev-token";

type LogEntry = {
  time: string;
  message: string;
  type: string;
};

const typeIcon: Record<string, string> = {
  JOB_STARTED: "🔍",
  STEP_COMPLETED: "✅",
  ERROR_OCCURRED: "❌",
  JOB_FINISHED: "🎉",
};

export default function StartApplyingPanel() {
  const [userId, setUserId] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) setUserId(stored);
  }, []);

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
        setLogs((prev) => [...prev, entry]);

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
        return;
      }
    } catch {
      setError("Could not reach the API.");
      setPhase("idle");
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>🚀 Auto Apply</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {phase === "idle" &&
              "Searches LinkedIn & Indeed, matches with your resume, tailors CV, applies, and messages the HR."}
            {phase === "running" && "Automation is running — watch live progress below."}
            {phase === "done" && "Run complete! Check the Jobs tab for results."}
          </p>
        </div>
        <button
          className="button primary"
          onClick={phase === "done" ? () => setPhase("idle") : startApplying}
          disabled={phase === "running"}
          style={{ minWidth: 140 }}
        >
          {phase === "idle" && "Start applying"}
          {phase === "running" && "Running..."}
          {phase === "done" && "Run again"}
        </button>
      </div>

      {error && (
        <p style={{ color: "var(--danger, #ef4444)", margin: "0 0 8px", fontSize: 14 }}>
          {error}
        </p>
      )}

      {/* Live log stream */}
      {(phase === "running" || phase === "done") && (
        <div
          ref={logRef}
          style={{
            background: "var(--surface, #111)",
            border: "1px solid var(--border, #333)",
            borderRadius: 8,
            padding: 12,
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {logs.map((entry, i) => (
            <div key={i} style={{ opacity: 0.9 }}>
              <span style={{ opacity: 0.5 }}>[{entry.time}]</span>{" "}
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
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            marginTop: 12,
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
                padding: "14px 8px",
                borderRadius: 8,
                background: "var(--surface, #f9fafb)",
                border: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div style={{ fontSize: 24 }}>{step.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{step.label}</div>
              <div className="helper" style={{ fontSize: 12, marginTop: 2 }}>
                {step.desc}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
