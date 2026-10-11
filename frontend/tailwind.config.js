/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light, Apple-style surfaces. "ink" is the neutral surface scale (names kept from the first dark theme).
        page: "#F2F4F8",
        ink: { 50: "#F7F8FB", 100: "#EEF1F6", 600: "#E1E6EE", 700: "#EDF0F5", 750: "#F3F5F9", 800: "#FFFFFF", 850: "#FFFFFF", 900: "#F3F5F9", 950: "#E9EDF3" },
        line: "#E8ECF2",
        fg: "#0F172A",
        fg2: "#334155",
        muted: "#64748B",
        faint: "#94A3B8",
        up: "#15803D",
        down: "#DC2626",
        gold: "#B45309",
        accent: { DEFAULT: "#1D4ED8", soft: "#E7EEFD" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 20px rgba(15, 23, 42, 0.05)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Inter", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: { "2xs": ["0.6875rem", "0.95rem"] },
    },
  },
  plugins: [],
};
