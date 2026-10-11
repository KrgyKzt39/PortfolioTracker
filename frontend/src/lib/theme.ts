import { useEffect, useState } from "react";

// Appearance is a per-device choice (iPhone vs PC), so it lives in this browser, not the database.
export type ThemePref = "system" | "light" | "dark";
const KEY = "pt-theme";
const EVENT = "pt-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()): boolean {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#F2F2F7");
  return dark;
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme() {
  const [state, setState] = useState(() => ({ pref: getThemePref(), dark: document.documentElement.dataset.theme === "dark" }));
  useEffect(() => {
    const update = () => {
      const pref = getThemePref();
      setState({ pref, dark: applyTheme(pref) });
    };
    const m = media();
    m.addEventListener("change", update);
    window.addEventListener(EVENT, update);
    return () => {
      m.removeEventListener("change", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return state;
}

/** Chart colours for the current theme (SVG attributes can't read CSS variables). */
export function chartColors(dark: boolean) {
  return dark
    ? { grid: "#38383A", axis: "#8E8E93", line: "#0A84FF", up: "#30D158", down: "#FF453A", tipBg: "#2C2C2E", tipBorder: "#3A3A3C", tipText: "#FFFFFF", received: "#30D158", expected: "#FF9F0A", dotRing: "#1C1C1E" }
    : { grid: "#E5E5EA", axis: "#8A8A8E", line: "#007AFF", up: "#34C759", down: "#FF3B30", tipBg: "#FFFFFF", tipBorder: "#E5E5EA", tipText: "#000000", received: "#34C759", expected: "#FF9500", dotRing: "#FFFFFF" };
}
