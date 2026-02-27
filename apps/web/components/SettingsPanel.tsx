"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Experience = { title?: string; company?: string; summary?: string };
type Education = { school?: string; degree?: string; details?: string };

type ParsedProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  skills?: string[];
  experience?: Experience[];
  education?: Education[];
};

export default function SettingsPanel() {
  /* ── auth / user ── */
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  /* ── resume flow ── */
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"user" | "upload" | "parsing" | "profile">("user");
  const [status, setStatus] = useState("");

  /* ── parsed profile (editable) ── */
  const [profile, setProfile] = useState<ParsedProfile>({});
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);

  /* ── bootstrap ── */
  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      loadUser(stored);
      loadResume(stored);
    }
  }, []);

  /* ── helpers ── */
  const save = (id: string) => {
    setUserId(id);
    window.localStorage.setItem("applycraft_userId", id);
  };

  const loadUser = async (id: string) => {
    const res = await fetch(`${apiUrl}/users/${id}`);
    if (!res.ok) return;
    const u = await res.json();
    if (u.fullName) setFullName(u.fullName);
    if (u.email) setEmail(u.email);
    setStep("upload");
  };

  const loadResume = async (id: string) => {
    const res = await fetch(`${apiUrl}/resume/latest?userId=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data?.parsedData) {
      applyProfile(data.parsedData);
      setStep("profile");
    }
  };

  const applyProfile = (p: ParsedProfile) => {
    setProfile(p);
    if (p.fullName) setFullName(p.fullName);
    if (p.email) setEmail(p.email);
    setSkills((p.skills ?? []).join(", "));
    setExperience(p.experience ?? []);
    setEducation(p.education ?? []);
  };

  /* ── step 1: create / load user ── */
  const createUser = async () => {
    if (!email) { setStatus("Enter your email."); return; }
    setStatus("Saving…");
    try {
      const lookup = await fetch(`${apiUrl}/users?email=${encodeURIComponent(email)}`);
      if (lookup.ok) {
        const existing = await lookup.json();
        save(existing.id);
        setFullName(existing.fullName ?? fullName);
        await loadResume(existing.id);
        setStep(step === "user" ? "upload" : step);
        setStatus("");
        return;
      }
      const res = await fetch(`${apiUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName: fullName || undefined }),
      });
      if (!res.ok) { setStatus("Failed to create user."); return; }
      const u = await res.json();
      save(u.id);
      setStep("upload");
      setStatus("");
    } catch { setStatus("Network error."); }
  };

  /* ── step 2: upload resume ── */
  const uploadResume = async () => {
    if (!file) { setStatus("Select a PDF file."); return; }
    setStatus("Uploading…");
    const form = new FormData();
    form.append("file", file);
    form.append("userId", userId);
    const res = await fetch(`${apiUrl}/resume/upload`, { method: "POST", body: form });
    if (!res.ok) { setStatus("Upload failed."); return; }
    setStatus("Uploaded ✓ — now parse your resume.");
    setStep("parsing");
  };

  /* ── step 3: parse resume ── */
  const parseResume = async () => {
    setStatus("Parsing with AI — this may take a moment…");
    const res = await fetch(`${apiUrl}/resume/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) { setStatus("Parse failed."); return; }
    const data = await res.json();
    if (data.parsedData) {
      applyProfile(data.parsedData);
      setStep("profile");
      setStatus("Parsed ✓ — review and fill in any blanks below.");
    } else {
      setStatus("No data extracted. Try a different resume.");
    }
  };

  /* ── save profile back ── */
  const saveProfile = async () => {
    setStatus("Saving profile…");
    try {
      // save user name
      await fetch(`${apiUrl}/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email }),
      });

      // save preferences from profile
      const roles = experience.map((e) => e.title).filter(Boolean);
      const keywords = skills.split(",").map((s) => s.trim()).filter(Boolean);
      const locations = profile.location ? [profile.location] : [];

      await fetch(`${apiUrl}/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          roles,
          keywords,
          locations,
          remote: true,
          autoApply: true,
          scoreThreshold: 0.25,
        }),
      });

      setStatus("Profile saved ✓");
    } catch { setStatus("Failed to save."); }
  };

  /* ── experience helpers ── */
  const updateExp = (i: number, field: keyof Experience, value: string) => {
    setExperience((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  };
  const addExp = () => setExperience((prev) => [...prev, { title: "", company: "", summary: "" }]);
  const removeExp = (i: number) => setExperience((prev) => prev.filter((_, idx) => idx !== i));

  /* ── education helpers ── */
  const updateEdu = (i: number, field: keyof Education, value: string) => {
    setEducation((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  };
  const addEdu = () => setEducation((prev) => [...prev, { school: "", degree: "", details: "" }]);
  const removeEdu = (i: number) => setEducation((prev) => prev.filter((_, idx) => idx !== i));

  /* ── render ── */
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>

      {/* ─── STEP 1: User ─── */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700,
            background: userId ? "var(--accent, #6366f1)" : "var(--muted, #e5e7eb)",
            color: userId ? "#fff" : "var(--fg, #111)",
          }}>1</span>
          <h3 style={{ margin: 0 }}>Your info</h3>
          {userId && <span style={{ fontSize: 13, color: "var(--success, #22c55e)" }}>✓</span>}
        </div>

        <div className="form-grid">
          <div className="field">
            <label className="label">Email</label>
            <input className="input" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={!!userId} />
          </div>
          <div className="field">
            <label className="label">Full name</label>
            <input className="input" placeholder="Your Name" value={fullName}
              onChange={(e) => setFullName(e.target.value)} />
          </div>
          {!userId && (
            <div className="field" style={{ alignSelf: "end" }}>
              <button className="button primary" onClick={createUser}>Continue</button>
            </div>
          )}
        </div>
      </section>

      {/* ─── STEP 2: Upload ─── */}
      {(step === "upload" || step === "parsing" || step === "profile") && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700,
              background: step !== "upload" ? "var(--accent, #6366f1)" : "var(--muted, #e5e7eb)",
              color: step !== "upload" ? "#fff" : "var(--fg, #111)",
            }}>2</span>
            <h3 style={{ margin: 0 }}>Upload your resume</h3>
            {step !== "upload" && <span style={{ fontSize: 13, color: "var(--success, #22c55e)" }}>✓</span>}
          </div>
          <p className="helper">Upload a PDF and we'll extract your profile using AI.</p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
            <input type="file" accept="application/pdf" className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="button primary" onClick={uploadResume}>Upload</button>
          </div>
        </section>
      )}

      {/* ─── STEP 3: Parse ─── */}
      {(step === "parsing" || step === "profile") && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: "50%", fontSize: 14, fontWeight: 700,
              background: step === "profile" ? "var(--accent, #6366f1)" : "var(--muted, #e5e7eb)",
              color: step === "profile" ? "#fff" : "var(--fg, #111)",
            }}>3</span>
            <h3 style={{ margin: 0 }}>Parse my resume</h3>
            {step === "profile" && <span style={{ fontSize: 13, color: "var(--success, #22c55e)" }}>✓</span>}
          </div>
          {step === "parsing" && (
            <button className="button primary" onClick={parseResume} style={{ marginTop: 4 }}>
              Parse with AI
            </button>
          )}
          {step === "profile" && (
            <p className="helper">Resume parsed — edit your profile below.</p>
          )}
        </section>
      )}

      {/* ─── STEP 4: Fill in the blanks ─── */}
      {step === "profile" && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 12 }}>Your profile</h3>
          <p className="helper" style={{ marginBottom: 16 }}>
            Review the data extracted from your resume. Fill in anything that's missing.
          </p>

          <div className="form-grid">
            <div className="field">
              <label className="label">Full name</label>
              <input className="input" value={fullName}
                onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Phone</label>
              <input className="input" placeholder="(optional)"
                value={profile.phone ?? ""}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Location</label>
              <input className="input" placeholder="e.g. New York, Remote"
                value={profile.location ?? ""}
                onChange={(e) => setProfile({ ...profile, location: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="label">Skills (comma-separated)</label>
              <input className="input" placeholder="react, typescript, node"
                value={skills} onChange={(e) => setSkills(e.target.value)} />
            </div>
          </div>

          {/* Experience */}
          <h4 style={{ marginTop: 20, marginBottom: 8 }}>Experience</h4>
          {experience.map((exp, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto",
              gap: 8, marginBottom: 8, alignItems: "end",
            }}>
              <div className="field">
                <label className="label">Title</label>
                <input className="input" value={exp.title ?? ""}
                  onChange={(e) => updateExp(i, "title", e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Company</label>
                <input className="input" value={exp.company ?? ""}
                  onChange={(e) => updateExp(i, "company", e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Summary</label>
                <input className="input" value={exp.summary ?? ""}
                  onChange={(e) => updateExp(i, "summary", e.target.value)} />
              </div>
              <button className="button ghost" onClick={() => removeExp(i)}
                style={{ padding: "6px 10px", fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button className="button ghost" onClick={addExp} style={{ fontSize: 13 }}>
            + Add experience
          </button>

          {/* Education */}
          <h4 style={{ marginTop: 20, marginBottom: 8 }}>Education</h4>
          {education.map((edu, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto",
              gap: 8, marginBottom: 8, alignItems: "end",
            }}>
              <div className="field">
                <label className="label">School</label>
                <input className="input" value={edu.school ?? ""}
                  onChange={(e) => updateEdu(i, "school", e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Degree</label>
                <input className="input" value={edu.degree ?? ""}
                  onChange={(e) => updateEdu(i, "degree", e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Details</label>
                <input className="input" value={edu.details ?? ""}
                  onChange={(e) => updateEdu(i, "details", e.target.value)} />
              </div>
              <button className="button ghost" onClick={() => removeEdu(i)}
                style={{ padding: "6px 10px", fontSize: 13 }}>✕</button>
            </div>
          ))}
          <button className="button ghost" onClick={addEdu} style={{ fontSize: 13 }}>
            + Add education
          </button>

          <div style={{ marginTop: 20 }}>
            <button className="button primary" onClick={saveProfile}>Save profile</button>
          </div>
        </section>
      )}

      {/* ─── Status bar ─── */}
      {status && (
        <div className="helper" style={{ textAlign: "center", marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}
