"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ApplicationItem = {
  id: string;
  createdAt: string;
  status: string;
  resumeSnapshotUrl: string | null;
  job: {
    title: string | null;
    company: string | null;
    jobUrl: string;
  };
};

type InterviewPrep = {
  id: string;
  content: string;
};

const statusColor = (s: string) => {
  if (s === "APPLIED") return "#3dd5a3";
  if (s === "MANUAL_INTERVENTION") return "#fbbf24";
  if (s === "FAILED") return "#f87171";
  return "var(--muted)";
};

export default function ResumeViewer() {
  const [userId, setUserId] = useState("");
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [selected, setSelected] = useState<ApplicationItem | null>(null);
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [resumeText, setResumeText] = useState<string>("");
  const [status, setStatus] = useState("Loading...");
  const [prepStatus, setPrepStatus] = useState<string>("");
  const [docTab, setDocTab] = useState<"resume" | "prep">("resume");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      refresh(stored).catch(() => undefined);
    } else {
      setStatus("Create a user in Settings first.");
    }
  }, []);

  const refresh = async (id: string) => {
    setStatus("Loading applications...");
    const res = await fetch(`${apiUrl}/applications?userId=${id}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Failed to load: ${error.error ?? res.status}`);
      return;
    }
    const data = (await res.json()) as ApplicationItem[];
    setApps(data);
    setSelected(data[0] ?? null);
    if (data[0]) await loadDetails(data[0]);
    setStatus("Ready");
  };

  const loadDetails = async (app: ApplicationItem) => {
    setSelected(app);
    setPrep(null);
    setResumeText("");
    setPrepStatus("");

    if (app.resumeSnapshotUrl) {
      const res = await fetch(`${apiUrl}/applications/${app.id}/resume`);
      if (res.ok) {
        const text = await res.text();
        setResumeText(text);
      }
    }

    const prepRes = await fetch(`${apiUrl}/applications/${app.id}/interview-prep`);
    if (prepRes.ok) {
      const data = (await prepRes.json()) as InterviewPrep | null;
      setPrep(data);
    }
  };

  const generatePrep = async () => {
    if (!selected) return;
    setPrepStatus("Generating interview prep...");
    const res = await fetch(`${apiUrl}/applications/${selected.id}/interview-prep`, {
      method: "POST",
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setPrepStatus(`Failed: ${error.error ?? res.status}`);
      return;
    }
    const data = (await res.json()) as InterviewPrep;
    setPrep(data);
    setPrepStatus("Interview prep ready.");
  };

  if (!userId) {
    return (
      <div className="panel">
        <h3>Documents</h3>
        <p className="helper">Set a user id in Settings to view documents.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display), sans-serif", fontSize: "1.05rem", fontWeight: 600 }}>
            Application documents
          </h3>
          <p className="helper" style={{ margin: "6px 0 0", fontSize: "0.82rem" }}>{status}</p>
        </div>
        <button className="button ghost" onClick={() => refresh(userId)} style={{ fontSize: "0.82rem" }}>
          Refresh
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, minHeight: 420 }}>
        {/* Applications list */}
        <div className="panel" style={{ overflow: "auto", maxHeight: 600 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem", fontWeight: 600 }}>
            Applications ({apps.length})
          </h3>
          {apps.length === 0 ? (
            <p className="helper">No applications yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {apps.map((app) => {
                const isActive = selected?.id === app.id;
                return (
                  <div
                    key={app.id}
                    onClick={() => loadDetails(app)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isActive
                        ? "linear-gradient(135deg, rgba(61, 213, 163, 0.12), rgba(6, 182, 212, 0.08))"
                        : "rgba(255,255,255,0.02)",
                      border: isActive ? "1px solid rgba(61, 213, 163, 0.3)" : "1px solid transparent",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ fontSize: "0.88rem", fontWeight: 500, marginBottom: 4 }}>
                      {app.job.title ?? "Untitled"}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        {app.job.company ?? "Unknown"}
                      </span>
                      <span style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: `${statusColor(app.status)}18`,
                        color: statusColor(app.status),
                      }}>
                        {app.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Document viewer */}
        <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <p className="helper">Select an application to view documents.</p>
          ) : (
            <>
              {/* Selected application header */}
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 600 }}>
                  {selected.job.title ?? "Untitled"}
                </h3>
                <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: "0.82rem" }}>
                  <span style={{ color: "var(--muted)" }}>{selected.job.company ?? "Unknown"}</span>
                  <a
                    href={selected.job.jobUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    View job ↗
                  </a>
                </div>
              </div>

              {/* Document tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 1 }}>
                {(["resume", "prep"] as const).map((tab) => {
                  const label = tab === "resume" ? "Resume" : "Interview prep";
                  const isActive = docTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setDocTab(tab)}
                      style={{
                        padding: "8px 16px",
                        fontSize: "0.82rem",
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--accent)" : "var(--muted)",
                        background: "none",
                        border: "none",
                        borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflow: "auto" }}>
                {docTab === "resume" && (
                  <>
                    {selected.resumeSnapshotUrl && (
                      <div style={{ marginBottom: 12 }}>
                        <a
                          className="button ghost"
                          href={`${apiUrl}/applications/${selected.id}/resume.pdf`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: "0.82rem" }}
                        >
                          Download PDF
                        </a>
                      </div>
                    )}
                    {selected.resumeSnapshotUrl ? (
                      <pre style={{
                        whiteSpace: "pre-wrap",
                        fontSize: "0.82rem",
                        lineHeight: 1.7,
                        color: "var(--fg)",
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: 8,
                        padding: 16,
                        margin: 0,
                        maxHeight: 400,
                        overflow: "auto",
                      }}>
                        {resumeText || "Loading resume..."}
                      </pre>
                    ) : (
                      <p className="helper">No tailored resume saved for this application.</p>
                    )}
                  </>
                )}

                {docTab === "prep" && (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <button className="button ghost" onClick={generatePrep} style={{ fontSize: "0.82rem" }}>
                        Generate prep
                      </button>
                    </div>
                    {prepStatus && <p className="helper" style={{ marginBottom: 8 }}>{prepStatus}</p>}
                    {prep?.content ? (
                      <pre style={{
                        whiteSpace: "pre-wrap",
                        fontSize: "0.82rem",
                        lineHeight: 1.7,
                        color: "var(--fg)",
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: 8,
                        padding: 16,
                        margin: 0,
                        maxHeight: 400,
                        overflow: "auto",
                      }}>
                        {prep.content}
                      </pre>
                    ) : (
                      <p className="helper">No interview prep generated yet. Click "Generate prep" above.</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
