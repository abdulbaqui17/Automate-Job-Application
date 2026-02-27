"use client";

import ThemeToggle from "./ThemeToggle";

export default function Topbar({ title }: { title: string }) {
  return (
    <div className="topbar">
      <div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display), sans-serif" }}>
          {title}
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
          Monitor job pipeline health and worker activity.
        </p>
      </div>
      <div className="topbar-actions">
        <ThemeToggle />
        <button className="button primary">New apply batch</button>
      </div>
    </div>
  );
}
