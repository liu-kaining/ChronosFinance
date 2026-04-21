import type { Config } from "tailwindcss";

// TradingView Pro dark-gray palette + financial signal colors.
// Usage: `bg-panel`, `text-muted`, `border-border-soft`, `text-up`, `bg-down-soft`, etc.
const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Background layers
        "bg-0": "#0d1015",
        "bg-1": "#131722",
        "bg-2": "#1e222d",
        "bg-3": "#2a2e39",
        panel: "#131722",
        "panel-hi": "#1e222d",
        "panel-lo": "#0d1015",

        // Borders
        border: "#363a45",
        "border-soft": "#2a2e39",

        // Text
        "text-primary": "#d1d4dc",
        "text-secondary": "#9598a1",
        "text-tertiary": "#5d606b",
        muted: "#9598a1",
        subtle: "#5d606b",

        // Financial signal (TradingView default)
        up: "#26a69a",
        down: "#ef5350",
        "up-soft": "rgba(38,166,154,0.15)",
        "down-soft": "rgba(239,83,80,0.15)",

        // Accents
        accent: "#2962ff",
        "accent-2": "#f7931a",
        warn: "#ff9800",
        purple: "#9c27b0",
        cyan: "#00bcd4",
        pink: "#e91e63",

        // Semantic
        ok: "#26a69a",
        stale: "#ff9800",
        fail: "#ef5350",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        tabular: ["12px", { lineHeight: "16px" }],
      },
      borderRadius: {
        card: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.4)",
        glow: "0 0 20px rgba(41,98,255,0.15)",
      },
      spacing: {
        gutter: "12px",
      },
      transitionTimingFunction: {
        flip: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "flash-up": {
          "0%": { backgroundColor: "rgba(38,166,154,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-down": {
          "0%": { backgroundColor: "rgba(239,83,80,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "flash-up": "flash-up 500ms ease-out",
        "flash-down": "flash-down 500ms ease-out",
        "fade-in": "fade-in 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
