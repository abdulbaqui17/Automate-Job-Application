"use client";

import { motion } from "framer-motion";
import ThemeToggle from "./ThemeToggle";

export default function Topbar({ title }: { title: string }) {
  return (
    <motion.div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 32,
        paddingBottom: 24,
        borderBottom: "1px solid var(--glass-border)",
      }}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div>
        <h1
          style={{
            fontFamily: "var(--font-display), sans-serif",
            fontSize: "1.75rem",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: 0,
            background: "linear-gradient(135deg, var(--text), var(--accent))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 6 }}>
          Monitor pipeline health and worker activity.
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ThemeToggle />
        <button className="button primary" style={{ fontSize: "0.85rem" }}>
          New apply batch
        </button>
      </div>
    </motion.div>
  );
}
