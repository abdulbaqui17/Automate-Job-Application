"use client";

import { useMemo } from "react";

type Props = {
  active: boolean;
  pieces?: number;
};

const colors = ["#0f766e", "#f26a4b", "#f59e0b", "#14b8a6", "#22c55e"];

export default function ConfettiBurst({ active, pieces = 26 }: Props) {
  const confetti = useMemo(() => {
    if (!active) return [];
    return Array.from({ length: pieces }).map((_, index) => {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.6;
      const duration = 1.2 + Math.random() * 0.9;
      const rotate = Math.random() * 360;
      const size = 6 + Math.random() * 6;
      const color = colors[index % colors.length];
      return { left, delay, duration, rotate, size, color };
    });
  }, [active, pieces]);

  if (!active) return null;

  return (
    <div className="confetti">
      {confetti.map((piece, idx) => (
        <span
          key={`confetti-${idx}`}
          className="confetti-piece"
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`,
            width: `${piece.size}px`,
            height: `${piece.size * 1.4}px`,
            background: piece.color,
          }}
        />
      ))}
    </div>
  );
}
