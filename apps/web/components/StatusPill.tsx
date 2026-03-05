"use client";

import { motion } from "framer-motion";

const statusConfig: Record<string, { variant: string; label?: string }> = {
  APPLIED: { variant: "success" },
  QUEUED: { variant: "info" },
  PROCESSING: { variant: "processing", label: "In Progress" },
  FAILED: { variant: "danger" },
  MANUAL: { variant: "warn" },
  MANUAL_INTERVENTION: { variant: "warn", label: "Manual" },
  SKIPPED: { variant: "neutral" },
};

export default function StatusPill({ status }: { status: string }) {
  const config = statusConfig[status] ?? { variant: "neutral" };
  const label = config.label ?? status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <motion.span
      className={`status-pill ${config.variant}`}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {label}
    </motion.span>
  );
}
