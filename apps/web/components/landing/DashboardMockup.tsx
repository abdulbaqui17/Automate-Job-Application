"use client";

import { motion } from "framer-motion";
import Tilt from "react-parallax-tilt";

/** Floating 3D mockup of the dashboard for the hero section */
export default function DashboardMockup() {
  return (
    <Tilt
      tiltMaxAngleX={8}
      tiltMaxAngleY={8}
      glareEnable
      glareMaxOpacity={0.08}
      glareColor="rgba(61,213,163,0.15)"
      glareBorderRadius="20px"
      perspective={1200}
      transitionSpeed={1600}
      style={{ transformStyle: "preserve-3d" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 1, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{
          position: "relative",
          background: "rgba(255, 255, 255, 0.03)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: 20,
          padding: "28px 24px 20px",
          boxShadow:
            "0 40px 80px rgba(0, 0, 0, 0.25), 0 0 60px rgba(61, 213, 163, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
          overflow: "hidden",
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        {/* Window chrome dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <span style={dot("#ff5f57")} />
          <span style={dot("#febc2e")} />
          <span style={dot("#28c840")} />
          <span
            style={{
              marginLeft: "auto",
              fontSize: "0.65rem",
              color: "rgba(255,255,255,0.2)",
              fontFamily: "monospace",
              letterSpacing: "0.04em",
            }}
          >
            applycraft.io/dashboard
          </span>
        </div>

        {/* Mini metrics row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginBottom: 16,
          }}
        >
          {[
            { label: "Queues", value: "6", color: "#3dd5a3" },
            { label: "Workers", value: "2", color: "#06b6d4" },
            { label: "In flight", value: "38", color: "#a78bfa" },
          ].map((m) => (
            <div
              key={m.label}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 10,
                padding: "12px 10px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {m.label}
              </div>
              <div
                style={{
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  fontFamily: "var(--font-display), sans-serif",
                  color: m.color,
                  textShadow: `0 0 20px ${m.color}33`,
                }}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Fake table */}
        <div
          style={{
            background: "rgba(0,0,0,0.15)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: "0.72rem",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <div style={tableRow(true)}>
            <span style={{ color: "rgba(255,255,255,0.3)", width: "38%" }}>
              ROLE
            </span>
            <span style={{ color: "rgba(255,255,255,0.3)", width: "28%" }}>
              COMPANY
            </span>
            <span style={{ color: "rgba(255,255,255,0.3)", width: "18%" }}>
              STATUS
            </span>
            <span style={{ color: "rgba(255,255,255,0.3)", width: "16%" }}>
              UPDATED
            </span>
          </div>
          {[
            {
              role: "Sr. Frontend Eng",
              company: "Stripe",
              status: "APPLIED",
              time: "2m ago",
              statusColor: "#34d399",
            },
            {
              role: "Full Stack Dev",
              company: "Vercel",
              status: "PROCESSING",
              time: "5m ago",
              statusColor: "#a78bfa",
            },
            {
              role: "Platform Eng",
              company: "Datadog",
              status: "QUEUED",
              time: "8m ago",
              statusColor: "#60a5fa",
            },
          ].map((row) => (
            <div key={row.role} style={tableRow(false)}>
              <span
                style={{
                  color: "rgba(255,255,255,0.7)",
                  width: "38%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.role}
              </span>
              <span
                style={{
                  color: "rgba(255,255,255,0.4)",
                  width: "28%",
                }}
              >
                {row.company}
              </span>
              <span style={{ width: "18%" }}>
                <span
                  style={{
                    background: `${row.statusColor}18`,
                    color: row.statusColor,
                    border: `1px solid ${row.statusColor}30`,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: "0.62rem",
                    fontWeight: 600,
                  }}
                >
                  {row.status}
                </span>
              </span>
              <span
                style={{
                  color: "rgba(255,255,255,0.25)",
                  width: "16%",
                  fontSize: "0.65rem",
                }}
              >
                {row.time}
              </span>
            </div>
          ))}
        </div>

        {/* Scan-line overlay */}
        <motion.div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 60,
            background:
              "linear-gradient(180deg, transparent, rgba(61,213,163,0.03), transparent)",
            pointerEvents: "none",
          }}
          animate={{ top: ["-60px", "110%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </motion.div>
    </Tilt>
  );
}

function dot(color: string): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    display: "inline-block",
  };
}

function tableRow(isHeader: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: isHeader ? "4px 0 8px" : "7px 0",
    borderBottom: isHeader
      ? "1px solid rgba(255,255,255,0.06)"
      : "1px solid rgba(255,255,255,0.02)",
    fontWeight: isHeader ? 600 : 400,
    textTransform: isHeader ? "uppercase" : "none",
    letterSpacing: isHeader ? "0.06em" : "0",
    fontSize: isHeader ? "0.6rem" : "0.72rem",
  };
}
