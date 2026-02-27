"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const applyTheme = (theme: Theme) => {
  document.documentElement.setAttribute("data-theme", theme);
};

const getSystemTheme = (): Theme => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem("applycraft_theme") as Theme | null;
    const initial = stored ?? getSystemTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("applycraft_theme", next);
    applyTheme(next);
  };

  return (
    <button className="button ghost theme-toggle" onClick={toggleTheme}>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
