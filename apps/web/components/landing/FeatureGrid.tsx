"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Tilt from "react-parallax-tilt";

const features = [
  {
    icon: "⚡",
    title: "Queue orchestration",
    desc: "Redis + BullMQ handle retries, exponential backoff, and intelligent rate-limits across providers.",
    color: "#3dd5a3",
  },
  {
    icon: "📡",
    title: "Live observability",
    desc: "WebSocket log streaming with step-level status updates and real-time pipeline health monitoring.",
    color: "#06b6d4",
  },
  {
    icon: "🧠",
    title: "Profile intelligence",
    desc: "Structured profile data piped to Gemini for context-aware resume tailoring per job description.",
    color: "#a78bfa",
  },
  {
    icon: "🛡️",
    title: "Human-in-the-loop",
    desc: "Pause jobs for manual intervention, review AI decisions, and resume processing safely.",
    color: "#f59e0b",
  },
  {
    icon: "🔄",
    title: "Auto retry engine",
    desc: "Smart retry with jitter, circuit breakers, and dead-letter queues for zero-loss processing.",
    color: "#f87171",
  },
  {
    icon: "📊",
    title: "Analytics pipeline",
    desc: "Conversion funnels, keyword insights, company heatmaps, and hourly throughput analysis.",
    color: "#34d399",
  },
];

export default function FeatureGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 20,
      }}
    >
      {features.map((feat, i) => (
        <Tilt
          key={feat.title}
          tiltMaxAngleX={6}
          tiltMaxAngleY={6}
          glareEnable
          glareMaxOpacity={0.06}
          glareColor={feat.color}
          glareBorderRadius="16px"
          transitionSpeed={1400}
          style={{ height: "100%" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{
              delay: i * 0.08 + 0.2,
              duration: 0.5,
              ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
            }}
            style={{
              height: "100%",
              position: "relative",
              background: "rgba(255, 255, 255, 0.03)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: 16,
              padding: "28px 22px",
              overflow: "hidden",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              cursor: "default",
            }}
            whileHover={{
              borderColor: `${feat.color}25`,
              boxShadow: `0 16px 40px rgba(0,0,0,0.12), 0 0 20px ${feat.color}08`,
            }}
          >
            {/* Icon with glow */}
            <div style={{ position: "relative", marginBottom: 16, width: 44, height: 44 }}>
              <div
                style={{
                  position: "absolute",
                  inset: -4,
                  borderRadius: 12,
                  background: `radial-gradient(circle, ${feat.color}15, transparent 70%)`,
                  filter: "blur(8px)",
                }}
              />
              <div
                style={{
                  position: "relative",
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  background: `${feat.color}10`,
                  border: `1px solid ${feat.color}20`,
                  fontSize: "1.3rem",
                }}
              >
                {feat.icon}
              </div>
            </div>

            {/* Title */}
            <div
              style={{
                fontFamily: "var(--font-display), sans-serif",
                fontWeight: 600,
                fontSize: "1rem",
                color: "var(--text)",
                marginBottom: 8,
              }}
            >
              {feat.title}
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--muted)",
                lineHeight: 1.6,
              }}
            >
              {feat.desc}
            </div>

            {/* Bottom accent */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: "15%",
                right: "15%",
                height: 1,
                background: `linear-gradient(90deg, transparent, ${feat.color}30, transparent)`,
              }}
            />
          </motion.div>
        </Tilt>
      ))}
    </div>
  );
}
