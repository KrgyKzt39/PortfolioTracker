/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light and dark values live in src/index.css. "ink" is the neutral surface scale.
        page: "rgb(var(--page) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        sheet: "rgb(var(--sheet) / <alpha-value>)",
        field: "rgb(var(--field) / <alpha-value>)",
        fill: "rgb(var(--fill) / <alpha-value>)",
        ink: { 50: "rgb(var(--ink-50) / <alpha-value>)", 100: "rgb(var(--ink-100) / <alpha-value>)", 600: "rgb(var(--ink-600) / <alpha-value>)", 700: "rgb(var(--ink-100) / <alpha-value>)", 750: "rgb(var(--ink-field) / <alpha-value>)", 800: "rgb(var(--surface) / <alpha-value>)", 850: "rgb(var(--surface) / <alpha-value>)", 900: "rgb(var(--ink-field) / <alpha-value>)", 950: "rgb(var(--ink-600) / <alpha-value>)" },
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        fg2: "rgb(var(--fg2) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        up: { DEFAULT: "rgb(var(--up) / <alpha-value>)", soft: "rgb(var(--up-soft) / <alpha-value>)", strong: "rgb(var(--up-strong) / <alpha-value>)" },
        down: { DEFAULT: "rgb(var(--down) / <alpha-value>)", soft: "rgb(var(--down-soft) / <alpha-value>)", strong: "rgb(var(--down-strong) / <alpha-value>)" },
        gold: { DEFAULT: "rgb(var(--gold) / <alpha-value>)", soft: "rgb(var(--gold-soft) / <alpha-value>)" },
        accent: { DEFAULT: "rgb(var(--accent) / <alpha-value>)", soft: "rgb(var(--accent-soft) / <alpha-value>)" },
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Inter Variable", "Inter", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: { "2xs": ["0.6875rem", "0.95rem"] },
    },
  },
  plugins: [],
};
