"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "◈" },
  { href: "/dashboard/job-links", label: "Job Links", icon: "🔗" },
  { href: "/dashboard/discovery", label: "Discovery", icon: "◎" },
  { href: "/dashboard/jobs", label: "Applications", icon: "▦" },
  { href: "/dashboard/resume-viewer", label: "Documents", icon: "▤" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "◐" },
  { href: "/dashboard/settings", label: "Settings", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div style={{ marginBottom: 32, paddingLeft: 8 }}>
        <h2
          style={{
            fontSize: "1.15rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, var(--accent), var(--glow-2, #06b6d4))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            margin: 0,
          }}
        >
          ApplyCraft
        </h2>
        <p
          style={{
            fontSize: "0.7rem",
            color: "var(--muted)",
            marginTop: 4,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          AI Job Automation
        </p>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <motion.div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: "0.88rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--accent)" : "var(--muted)",
                  background: active ? "rgba(61, 213, 163, 0.08)" : "transparent",
                  border: active
                    ? "1px solid rgba(61, 213, 163, 0.12)"
                    : "1px solid transparent",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                whileHover={{
                  x: 3,
                  backgroundColor: active
                    ? "rgba(61, 213, 163, 0.1)"
                    : "rgba(255, 255, 255, 0.04)",
                }}
                transition={{ duration: 0.15 }}
              >
                {active && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    style={{
                      position: "absolute",
                      left: -16,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 3,
                      height: 20,
                      borderRadius: 2,
                      background: "linear-gradient(180deg, var(--accent), var(--glow-2, #06b6d4))",
                      boxShadow: "0 0 12px rgba(61, 213, 163, 0.4)",
                    }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span style={{ fontSize: "1rem", opacity: active ? 1 : 0.6, width: 20, textAlign: "center" }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            fontSize: "0.78rem",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Pro tip:</span> Configure your
          resume in Settings to start auto-applying.
        </div>
      </div>
    </aside>
  );
}
