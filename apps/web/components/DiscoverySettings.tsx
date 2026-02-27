"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type User = {
  id: string;
  email: string;
  fullName?: string | null;
  aiProvider?: "AUTO" | "OPENAI" | "GEMINI";
};

type Preference = {
  id: string;
  userId: string;
  keywords: string[];
  roles: string[];
  locations: string[];
  remote: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  autoApply: boolean;
  scoreThreshold: number;
  lastRunAt?: string | null;
};

type ParsedResume = {
  fullName?: string;
  email?: string;
  location?: string;
  skills?: string[];
  experience?: Array<{ title?: string }>;
};

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function DiscoverySettings() {
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState<string>("");
  const [aiProvider, setAiProvider] = useState<"AUTO" | "OPENAI" | "GEMINI">("AUTO");

  const [roles, setRoles] = useState("");
  const [keywords, setKeywords] = useState("");
  const [locations, setLocations] = useState("");
  const [remote, setRemote] = useState(true);
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [autoApply, setAutoApply] = useState(true);
  const [scoreThreshold, setScoreThreshold] = useState("0.25");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [resumeReady, setResumeReady] = useState(false);
  const [prefLoaded, setPrefLoaded] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_userId");
    if (stored) {
      setUserId(stored);
      loadUser(stored).catch(() => undefined);
      loadPreferences(stored).catch(() => undefined);
      loadResumeProfile(stored).catch(() => undefined);
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as ParsedResume | undefined;
      if (detail) {
        applyParsedProfile(detail, true);
        setStatus("Resume parsed. Preferences auto-filled.");
      }
    };
    window.addEventListener("applycraft:resume-parsed", handler as EventListener);
    return () => window.removeEventListener("applycraft:resume-parsed", handler as EventListener);
  }, []);

  const saveUserId = (id: string) => {
    setUserId(id);
    window.localStorage.setItem("applycraft_userId", id);
  };

  const loadUser = async (id: string) => {
    const res = await fetch(`${apiUrl}/users/${id}`);
    if (!res.ok) return;
    const user = (await res.json()) as User;
    if (user.aiProvider) setAiProvider(user.aiProvider);
    if (user.fullName) setFullName(user.fullName);
    if (user.email) setEmail(user.email);
  };

  const loadPreferences = async (id: string) => {
    const res = await fetch(`${apiUrl}/preferences/${id}`);
    if (!res.ok) return;
    const pref = (await res.json()) as Preference | null;
    if (!pref) return;
    setRoles(pref.roles.join(", "));
    setKeywords(pref.keywords.join(", "));
    setLocations(pref.locations.join(", "));
    setRemote(pref.remote);
    setSalaryMin(pref.salaryMin?.toString() ?? "");
    setSalaryMax(pref.salaryMax?.toString() ?? "");
    setAutoApply(pref.autoApply);
    setScoreThreshold(pref.scoreThreshold.toString());
    setLastRunAt(pref.lastRunAt ?? null);
    setPrefLoaded(true);
  };

  const loadResumeProfile = async (id: string) => {
    const res = await fetch(`${apiUrl}/resume/latest?userId=${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { parsedData?: ParsedResume | null } | null;
    if (!data?.parsedData) return;
    applyParsedProfile(data.parsedData);
  };

  const applyParsedProfile = (parsed: ParsedResume, forceSave = false) => {
    const roles = (parsed.experience ?? [])
      .map((item) => item?.title ?? "")
      .filter(Boolean);
    const skills = (parsed.skills ?? []).filter(Boolean);
    const locations = parsed.location ? [parsed.location] : [];
    const autoRemote =
      locations.length === 0 || locations.some((loc) => loc.toLowerCase().includes("remote"));

    if (!fullName && parsed.fullName) setFullName(parsed.fullName);
    if (!email && parsed.email) setEmail(parsed.email);

    setResumeReady(true);

    if (!rolesStateFilled()) setRoles(roles.join(", "));
    if (!keywordsStateFilled()) setKeywords(skills.join(", "));
    if (!locationsStateFilled()) setLocations(locations.join(", "));
    setRemote(autoRemote);

    if ((forceSave || !prefLoaded) && userId) {
      persistPreferences({
        userId,
        roles: roles.length ? roles : parseList(rolesStateValue()),
        keywords: skills.length ? skills : parseList(keywordsStateValue()),
        locations: locations.length ? locations : parseList(locationsStateValue()),
        remote: autoRemote,
      }).catch(() => undefined);
    }
  };

  const rolesStateFilled = () => roles.trim().length > 0;
  const keywordsStateFilled = () => keywords.trim().length > 0;
  const locationsStateFilled = () => locations.trim().length > 0;
  const rolesStateValue = () => roles;
  const keywordsStateValue = () => keywords;
  const locationsStateValue = () => locations;

  const createOrLoadUser = async () => {
    setStatus("Saving user...");
    try {
      const lookup = await fetch(`${apiUrl}/users?email=${encodeURIComponent(email)}`);
      if (lookup.ok) {
        const existing = (await lookup.json()) as User;
        saveUserId(existing.id);
        setFullName(existing.fullName ?? "");
        if (existing.aiProvider) setAiProvider(existing.aiProvider);
        await loadPreferences(existing.id);
        setStatus("Loaded existing user.");
        return;
      }

      const res = await fetch(`${apiUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName }),
      });
      if (!res.ok) {
        const error = await res.json();
        setStatus(`Failed to save user: ${error.error ?? res.status}`);
        return;
      }
      const user = (await res.json()) as User;
      saveUserId(user.id);
      if (user.aiProvider) setAiProvider(user.aiProvider);
      await loadResumeProfile(user.id);
      setStatus("User created.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to save user.");
    }
  };

  const persistPreferences = async (payload: {
    userId: string;
    roles?: string[];
    keywords?: string[];
    locations?: string[];
    remote?: boolean;
  }) => {
    await fetch(`${apiUrl}/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: payload.userId,
        roles: payload.roles ?? parseList(roles),
        keywords: payload.keywords ?? parseList(keywords),
        locations: payload.locations ?? parseList(locations),
        remote: payload.remote ?? remote,
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        autoApply,
        scoreThreshold: Number(scoreThreshold),
      }),
    });
  };

  const saveAiProvider = async () => {
    if (!userId) {
      setStatus("Create or load a user first.");
      return;
    }
    setStatus("Saving AI provider...");
    try {
      const res = await fetch(`${apiUrl}/users/ai-provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, aiProvider }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        setStatus(`Failed to save provider: ${error.error ?? res.status}`);
        return;
      }
      setStatus("AI provider saved.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to save provider.");
    }
  };

  const savePreferences = async () => {
    if (!userId) {
      setStatus("Create or load a user first.");
      return;
    }
    setStatus("Saving preferences...");
    try {
      const res = await fetch(`${apiUrl}/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          roles: parseList(roles),
          keywords: parseList(keywords),
          locations: parseList(locations),
          remote,
          salaryMin: salaryMin ? Number(salaryMin) : undefined,
          salaryMax: salaryMax ? Number(salaryMax) : undefined,
          autoApply,
          scoreThreshold: Number(scoreThreshold),
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        setStatus(`Failed to save preferences: ${error.error ?? res.status}`);
        return;
      }
      const pref = (await res.json()) as Preference;
      setLastRunAt(pref.lastRunAt ?? null);
      setStatus("Preferences saved.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to save preferences.");
    }
  };

  return (
    <div className="panel">
      <h3>Discovery settings</h3>
      <p className="helper">
        Configure job discovery preferences. The worker will fetch new jobs daily and
        auto-queue matches above your score threshold.
      </p>

      <div className="form-grid">
        <div className="field">
          <label className="label">Email</label>
          <input
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Full name</label>
          <input
            className="input"
            placeholder="Your Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button className="button primary" onClick={createOrLoadUser}>
            Save user
          </button>
        </div>
      </div>

      {!resumeReady ? (
        <p className="helper">
          Upload your resume first. We’ll auto-fill roles, keywords, and locations.
        </p>
      ) : null}

      <fieldset disabled={!resumeReady} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="form-grid">
          <div className="field">
            <label className="label">Roles</label>
            <input
              className="input"
              placeholder="software engineer, frontend"
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Keywords</label>
            <input
              className="input"
              placeholder="react, typescript, node"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Locations</label>
            <input
              className="input"
              placeholder="remote, new york"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Remote only</label>
            <div className="checkbox">
              <input
                type="checkbox"
                checked={remote}
                onChange={(e) => setRemote(e.target.checked)}
              />
              <span>Only remote roles</span>
            </div>
          </div>
          <div className="field">
            <label className="label">Salary min</label>
            <input
              className="input"
              type="number"
              placeholder="80000"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Salary max</label>
            <input
              className="input"
              type="number"
              placeholder="150000"
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Auto-apply</label>
            <div className="checkbox">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
              />
              <span>Queue applications automatically</span>
            </div>
          </div>
          <div className="field">
            <label className="label">Score threshold</label>
            <input
              className="input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(e.target.value)}
            />
          </div>
          <div className="field" style={{ alignSelf: "end" }}>
            <button className="button primary" onClick={savePreferences}>
              Save preferences
            </button>
          </div>
        </div>
      </fieldset>

      <div className="form-grid">
        <div className="field">
          <label className="label">AI provider</label>
          <select
            className="input"
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value as "AUTO" | "OPENAI" | "GEMINI")}
          >
            <option value="AUTO">Auto (use OpenAI if available)</option>
            <option value="OPENAI">OpenAI (GPT)</option>
            <option value="GEMINI">Gemini</option>
          </select>
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button className="button ghost" onClick={saveAiProvider}>
            Save AI provider
          </button>
        </div>
      </div>

      <div className="helper">
        User ID: <strong>{userId || "Not set"}</strong>
        {lastRunAt ? ` • Last discovery run: ${new Date(lastRunAt).toLocaleString()}` : ""}
      </div>

      {status ? <div className="helper">{status}</div> : null}
    </div>
  );
}
