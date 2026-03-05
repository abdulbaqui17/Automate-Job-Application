"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import GridBackground from "../components/landing/GridBackground";
import DashboardMockup from "../components/landing/DashboardMockup";
import ArchitectureDiagram from "../components/landing/ArchitectureDiagram";
import MetricsSection from "../components/landing/MetricsSection";
import FeatureGrid from "../components/landing/FeatureGrid";

/* ─── Shared helpers ─── */
const ease: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease }}
      style={{
        display: "inline-block",
        fontFamily: "var(--font-display), monospace",
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "var(--accent)",
        marginBottom: 10,
        background: "rgba(61, 213, 163, 0.08)",
        border: "1px solid rgba(61, 213, 163, 0.15)",
        borderRadius: 999,
        padding: "6px 16px",
      }}
    >
      {children}
    </motion.span>
  );
}

function SectionHeading({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div style={{ textAlign: "center", marginBottom: 56 }}>
      <motion.h2
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.55, ease }}
        style={{
          fontFamily: "var(--font-display), sans-serif",
          fontWeight: 700,
          fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)",
          color: "var(--text)",
          lineHeight: 1.25,
          margin: "0 0 12px",
        }}
      >
        {children}
      </motion.h2>
      {sub && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, delay: 0.1, ease }}
          style={{
            fontSize: "1rem",
            color: "var(--muted)",
            maxWidth: 560,
            margin: "0 auto",
            lineHeight: 1.7,
          }}
        >
          {sub}
        </motion.p>
      )}
    </div>
  );
}

/* ─── Page ─── */
export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.7], [1, 0.96]);

  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        overflow: "hidden",
      }}
    >
      <GridBackground />

      {/* ─────── Hero ─────── */}
      <motion.section
        ref={heroRef}
        style={{
          opacity: heroOpacity,
          scale: heroScale,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "120px 24px 80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          style={{ textAlign: "center", maxWidth: 720, marginBottom: 48 }}
        >
          <SectionLabel>Automation infrastructure for hiring pipelines</SectionLabel>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.12, ease }}
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontWeight: 800,
              fontSize: "clamp(2.2rem, 6vw, 4rem)",
              lineHeight: 1.08,
              margin: "20px 0 0",
              background: "linear-gradient(135deg, var(--text), var(--accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Enterprise-grade
            <br />
            automation infrastructure.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24, ease }}
            style={{
              fontSize: "clamp(1rem, 2vw, 1.15rem)",
              color: "var(--muted)",
              lineHeight: 1.7,
              marginTop: 22,
              maxWidth: 520,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Queue orchestration, real-time observability, and human-in-the-loop
            safety nets — from script to production pipeline.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.36, ease }}
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginTop: 32,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 28px",
                fontFamily: "var(--font-display), sans-serif",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "#000",
                background: "linear-gradient(135deg, var(--accent), var(--glow-2))",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow:
                  "0 4px 20px rgba(61, 213, 163, 0.25), 0 0 40px rgba(61, 213, 163, 0.08)",
              }}
            >
              Open dashboard
              <span style={{ fontSize: "1rem" }}>→</span>
            </Link>
            <Link
              href="/dashboard/settings"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 28px",
                fontFamily: "var(--font-display), sans-serif",
                fontWeight: 600,
                fontSize: "0.9rem",
                color: "var(--text)",
                background: "rgba(255, 255, 255, 0.04)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                cursor: "pointer",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              Configure sources
            </Link>
          </motion.div>
        </motion.div>

        {/* Floating dashboard mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.48, ease }}
          style={{ width: "100%", maxWidth: 860, position: "relative" }}
        >
          <DashboardMockup />
          {/* Edge glow beneath mockup */}
          <div
            style={{
              position: "absolute",
              bottom: -4,
              left: "10%",
              right: "10%",
              height: 120,
              background:
                "radial-gradient(ellipse at center, rgba(61, 213, 163, 0.12), transparent 70%)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />
        </motion.div>
      </motion.section>

      {/* ─────── Metrics ─────── */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px 24px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <SectionLabel>Performance</SectionLabel>
        </div>
        <SectionHeading sub="Real-time metrics from your automation pipeline, updated every second.">
          Built for throughput, designed for reliability.
        </SectionHeading>
        <MetricsSection />
      </section>

      {/* ─────── Architecture ─────── */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          padding: "80px 24px 100px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <SectionLabel>System design</SectionLabel>
        </div>
        <SectionHeading sub="Four production-grade components orchestrated for resilience and observability.">
          Architecture at a glance
        </SectionHeading>
        <ArchitectureDiagram />
      </section>

      {/* ─────── Features ─────── */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          padding: "80px 24px 120px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <SectionLabel>Capabilities</SectionLabel>
        </div>
        <SectionHeading sub="Everything you need to build, run, and observe automation pipelines at scale.">
          What ships in the platform
        </SectionHeading>
        <FeatureGrid />
      </section>

      {/* ─────── CTA Footer ─────── */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          padding: "80px 24px 140px",
          textAlign: "center",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease }}
          style={{
            maxWidth: 680,
            margin: "0 auto",
            background: "rgba(255, 255, 255, 0.02)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 20,
            padding: "56px 40px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Glow */}
          <div
            style={{
              position: "absolute",
              top: "-50%",
              left: "30%",
              width: 400,
              height: 400,
              background: "radial-gradient(circle, rgba(61, 213, 163, 0.06), transparent 70%)",
              filter: "blur(60px)",
              pointerEvents: "none",
            }}
          />

          <h2
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontWeight: 700,
              fontSize: "clamp(1.4rem, 3vw, 2rem)",
              margin: "0 0 12px",
              position: "relative",
              background: "linear-gradient(135deg, var(--text), var(--accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Ready to automate?
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: "0.95rem",
              lineHeight: 1.7,
              maxWidth: 420,
              margin: "0 auto 28px",
              position: "relative",
            }}
          >
            Open the dashboard and start running your first automation pipeline
            in under 60 seconds.
          </p>
          <Link
            href="/dashboard"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 36px",
              fontFamily: "var(--font-display), sans-serif",
              fontWeight: 600,
              fontSize: "0.9rem",
              color: "#000",
              background: "linear-gradient(135deg, var(--accent), var(--glow-2))",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              boxShadow:
                "0 4px 20px rgba(61, 213, 163, 0.3), 0 0 60px rgba(61, 213, 163, 0.1)",
            }}
          >
            Launch dashboard
            <span style={{ fontSize: "1rem" }}>→</span>
          </Link>
        </motion.div>

        {/* Footer tagline */}
        <p
          style={{
            marginTop: 48,
            fontSize: "0.75rem",
            color: "var(--muted)",
            letterSpacing: "0.08em",
            opacity: 0.5,
          }}
        >
          APPLYCRAFT · AUTOMATION INFRASTRUCTURE
        </p>
      </section>
    </main>
  );
}
