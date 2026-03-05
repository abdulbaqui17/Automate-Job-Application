"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const nodes = [
  { id: "cp", label: "Control Plane", sub: "Next.js Dashboard", x: 0, color: "#3dd5a3" },
  { id: "api", label: "API Gateway", sub: "Bun + WebSockets", x: 1, color: "#06b6d4" },
  { id: "wf", label: "Worker Fleet", sub: "Playwright Workers", x: 2, color: "#a78bfa" },
  { id: "pg", label: "PostgreSQL", sub: "State & Audit Logs", x: 3, color: "#f59e0b" },
];

export default function ArchitectureDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} style={{ position: "relative", padding: "20px 0" }}>
      {/* Connection lines */}
      <svg
        viewBox="0 0 1200 80"
        fill="none"
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          transform: "translateY(-50%)",
          width: "100%",
          height: 80,
          zIndex: 0,
          overflow: "visible",
        }}
      >
        {[0, 1, 2].map((i) => {
          const x1 = 150 + i * 300 + 75;
          const x2 = 150 + (i + 1) * 300 + 75;
          return (
            <g key={i}>
              {/* Base line */}
              <line
                x1={x1}
                y1={40}
                x2={x2}
                y2={40}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth={2}
              />
              {/* Animated pulse */}
              <motion.circle
                r={4}
                fill={nodes[i].color}
                filter={`drop-shadow(0 0 6px ${nodes[i].color})`}
                initial={{ cx: x1, cy: 40, opacity: 0 }}
                animate={
                  isInView
                    ? {
                        cx: [x1, x2],
                        cy: [40, 40],
                        opacity: [0, 1, 1, 0],
                      }
                    : {}
                }
                transition={{
                  duration: 2,
                  delay: i * 0.6 + 1,
                  repeat: Infinity,
                  repeatDelay: 1.5,
                  ease: "easeInOut",
                }}
              />
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 20,
          position: "relative",
          zIndex: 1,
        }}
      >
        {nodes.map((node, i) => (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{
              delay: i * 0.15 + 0.3,
              duration: 0.6,
              ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
            }}
            style={{
              position: "relative",
              background: "rgba(255, 255, 255, 0.03)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: 16,
              padding: "24px 16px",
              textAlign: "center",
              transition: "all 0.3s ease",
              cursor: "default",
            }}
            whileHover={{
              scale: 1.04,
              borderColor: `${node.color}30`,
              boxShadow: `0 0 30px ${node.color}15`,
            }}
          >
            {/* Glow dot */}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: node.color,
                boxShadow: `0 0 12px ${node.color}80`,
                margin: "0 auto 14px",
              }}
            />
            <div
              style={{
                fontFamily: "var(--font-display), sans-serif",
                fontWeight: 600,
                fontSize: "0.92rem",
                color: "var(--text)",
                marginBottom: 4,
              }}
            >
              {node.label}
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--muted)",
              }}
            >
              {node.sub}
            </div>

            {/* Bottom accent line */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: "20%",
                right: "20%",
                height: 1,
                background: `linear-gradient(90deg, transparent, ${node.color}40, transparent)`,
              }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
