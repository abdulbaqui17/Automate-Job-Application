"use client";

import { useEffect, useState } from "react";

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

export default function LogStream() {
  const [events, setEvents] = useState<EventItem[]>(seed);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) return;

    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          timestamp: string;
          message: string;
          type: string;
        };
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
      {events.map((event, index) => (
        <div key={`${event.timestamp}-${index}`} className="log-entry">
          [{new Date(event.timestamp).toLocaleTimeString()}] {event.type}: {event.message}
        </div>
      ))}
    </div>
  );
}
