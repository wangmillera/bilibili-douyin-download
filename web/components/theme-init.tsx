"use client";

import { useEffect } from "react";

export function ThemeInit() {
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const theme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.className = theme;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(e: MediaQueryListEvent) {
      if (localStorage.getItem("theme")) return;
      document.documentElement.className = e.matches ? "dark" : "light";
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return null;
}
