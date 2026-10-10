/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0a101d", 900: "#0e1626", 850: "#121b2d", 800: "#172235", 750: "#1b2740", 700: "#233150", 600: "#2e3d5f" },
        hero: { from: "#1c3769", to: "#13284f", edge: "#2f4f8f" },
        muted: "#8a97ad",
        faint: "#5f6c84",
        up: "#2ed38a",
        down: "#f2545b",
        gold: "#f5a524",
        accent: "#3b82f6",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Inter", "Segoe UI", "Roboto", "sans-serif"],
      },
      fontSize: { "2xs": ["0.6875rem", "0.95rem"] },
    },
  },
  plugins: [],
};
