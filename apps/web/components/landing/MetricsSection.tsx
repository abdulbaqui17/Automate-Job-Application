"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import CountUp from "./CountUp";

const stats = [
  { label: "Daily throughput", value: 72, suffix: "", color: "#3dd5a3" },
  { label: "Retry success", value: 91, suffix: "%", color: "#06b6d4" },
  { label: "Avg apply time", value: 47, suffix: "s", color: "#a78bfa" },
  { label: "Uptime", value: 99, suffix: ".9%", color: "#f59e0b" },
];

export default function MetricsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 20,
      }}
    >
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{
            delay: i * 0.1 + 0.2,
            duration: 0.5,
            ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
          }}
          style={{
            position: "relative",
            background: "rgba(255, 255, 255, 0.03)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 16,
            padding: "28px 20px",
            textAlign: "center",
            overflow: "hidden",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            cursor: "default",
          }}
          whileHover={{
            y: -4,
            scale: 1.03,
            boxShadow: `0 20px 40px rgba(0,0,0,0.15), 0 0 30px ${stat.color}10`,
          }}
        >
          {/* Label */}
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            {stat.label}
          </div>

          {/* Value */}
          <div
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontSize: "2.2rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: stat.color,
              textShadow: `0 0 30px ${stat.color}30`,
              lineHeight: 1,
            }}
          >
            <CountUp value={stat.value} suffix={stat.suffix} />
          </div>

          {/* Glow */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: "60%",
              height: 30,
              background: `radial-gradient(ellipse, ${stat.color}15, transparent)`,
              filter: "blur(10px)",
              pointerEvents: "none",
            }}
          />

          {/* Accent line */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "25%",
              right: "25%",
              height: 1,
              background: `linear-gradient(90deg, transparent, ${stat.color}50, transparent)`,
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}
