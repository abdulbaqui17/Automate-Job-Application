"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type EventItem = {
  timestamp: string;
  message: string;
  type: string;
};

const seed: EventItem[] = [
  {
    timestamp: new Date().toISOString(),
    message: "Waiting for live events...",
    type: "INFO",
  },
];

const typeColor: Record<string, string> = {
  JOB_STARTED: "text-blue-400",
  STEP_COMPLETED: "text-emerald-400",
  ERROR_OCCURRED: "text-red-400",
  JOB_FINISHED: "text-green-400",
  INFO: "text-[var(--muted)]",
};

export default function LogStream() {
  const [events, setEvents] = useState<EventItem[]>(seed);

  useEffect(() => {
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws?token=dev-token";
    if (!wsUrl) return;

    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as EventItem;
        setEvents((prev) => [data, ...prev].slice(0, 30));
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  return (
    <div className="log-stream">
      <AnimatePresence>
        {events.map((event, index) => (
          <motion.div
            key={`${event.timestamp}-${index}`}
            className={`log-entry ${typeColor[event.type] ?? "text-[var(--muted)]"}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            [{new Date(event.timestamp).toLocaleTimeString()}] {event.type}:{" "}
            {event.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
