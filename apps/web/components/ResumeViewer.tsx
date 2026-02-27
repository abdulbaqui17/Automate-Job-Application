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

type CoverLetter = {
  id: string;
  applicationId: string | null;
  content: string;
};

type InterviewPrep = {
  id: string;
  content: string;
};

export default function ResumeViewer() {
  const [userId, setUserId] = useState("");
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [selected, setSelected] = useState<ApplicationItem | null>(null);
  const [cover, setCover] = useState<CoverLetter | null>(null);
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [resumeText, setResumeText] = useState<string>("");
  const [status, setStatus] = useState("Loading...");
  const [prepStatus, setPrepStatus] = useState<string>("");

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
    setCover(null);
    setPrep(null);
    setResumeText("");
    setPrepStatus("");

    if (app.resumeSnapshotUrl) {
      const res = await fetch(
        `${apiUrl}/applications/${app.id}/resume`
      );
      if (res.ok) {
        const text = await res.text();
        setResumeText(text);
      }
    }

    const coverRes = await fetch(`${apiUrl}/applications/${app.id}/cover-letter`);
    if (coverRes.ok) {
      const data = (await coverRes.json()) as CoverLetter | null;
      setCover(data);
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

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0 }}>Application documents</h3>
          <p className="helper" style={{ margin: "6px 0 0" }}>
            {status}
          </p>
        </div>
        <button className="button ghost" onClick={() => refresh(userId)}>
          Refresh
        </button>
      </div>

      <div className="panel-grid">
        <div className="panel" style={{ maxHeight: "420px", overflow: "auto" }}>
          <h3>Applications</h3>
          {apps.length === 0 ? (
            <p className="helper">No applications yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr
                    key={app.id}
                    onClick={() => loadDetails(app)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{app.job.title ?? "Untitled"}</td>
                    <td>{app.job.company ?? "-"}</td>
                    <td>{app.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h3>Tailored resume</h3>
          {selected?.resumeSnapshotUrl ? (
            <div className="cta-row" style={{ marginBottom: "8px" }}>
              <a
                className="button ghost"
                href={`${apiUrl}/applications/${selected.id}/resume.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Download PDF
              </a>
            </div>
          ) : null}
          {selected?.resumeSnapshotUrl ? (
            <pre className="log-stream" style={{ whiteSpace: "pre-wrap" }}>
              {resumeText || "Loading resume..."}
            </pre>
          ) : (
            <p className="helper">No tailored resume saved for this application.</p>
          )}
        </div>

        <div className="panel">
          <h3>Cover letter</h3>
          {cover?.content ? (
            <div className="cta-row" style={{ marginBottom: "8px" }}>
              <a
                className="button ghost"
                href={`${apiUrl}/applications/${selected?.id}/cover-letter.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Download PDF
              </a>
            </div>
          ) : null}
          {cover?.content ? (
            <pre className="log-stream" style={{ whiteSpace: "pre-wrap" }}>
              {cover.content}
            </pre>
          ) : (
            <p className="helper">No cover letter available.</p>
          )}
        </div>

        <div className="panel">
          <h3>Interview prep</h3>
          <div className="cta-row" style={{ marginBottom: "8px" }}>
            <button className="button ghost" onClick={generatePrep}>
              Generate prep
            </button>
          </div>
          {prepStatus ? <p className="helper">{prepStatus}</p> : null}
          {prep?.content ? (
            <pre className="log-stream" style={{ whiteSpace: "pre-wrap" }}>
              {prep.content}
            </pre>
          ) : (
            <p className="helper">No interview prep generated yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
