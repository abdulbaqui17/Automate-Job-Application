"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ResumeUploader() {
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("Upload a PDF resume to extract your profile.");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) setUserId(stored);
  }, []);

  const uploadResume = async () => {
    if (!userId) {
      setStatus("Create a user in Settings first.");
      return;
    }
    if (!file) {
      setStatus("Select a PDF file.");
      return;
    }

    setStatus("Uploading resume...");
    const form = new FormData();
    form.append("file", file);
    form.append("userId", userId);

    const res = await fetch(`${apiUrl}/resume/upload`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus(`Upload failed: ${error.error ?? res.status}`);
      return;
    }

    setStatus("Resume uploaded. Extracting profile...");
    const parseRes = await fetch(`${apiUrl}/resume/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (!parseRes.ok) {
      const error = await parseRes.json().catch(() => ({}));
      setStatus(`Parse failed: ${error.error ?? parseRes.status}`);
      return;
    }

    const parsed = await parseRes.json().catch(() => null);
    if (parsed?.parsedData) {
      window.dispatchEvent(
        new CustomEvent("applycraft:resume-parsed", { detail: parsed.parsedData })
      );
    }
    setStatus("Resume parsed and profile saved.");
  };

  return (
    <div className="panel" style={{ marginBottom: "18px" }}>
      <h3>Resume intake</h3>
      <p className="helper">Upload a PDF resume, then we extract your profile with Gemini.</p>
      <div className="form-grid" style={{ marginTop: "12px" }}>
        <div className="field">
          <input
            className="input"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button className="button primary" onClick={uploadResume}>
            Upload & parse
          </button>
        </div>
      </div>
      <p className="helper">{status}</p>
    </div>
  );
}
