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
        "bg-0": "rgb(var(--bg-0) / <alpha-value>)",
        "bg-1": "rgb(var(--bg-1) / <alpha-value>)",
        "bg-2": "rgb(var(--bg-2) / <alpha-value>)",
        "bg-3": "rgb(var(--bg-3) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        "panel-hi": "rgb(var(--panel-hi) / <alpha-value>)",
        "panel-lo": "rgb(var(--panel-lo) / <alpha-value>)",

        // Borders
        border: "rgb(var(--border) / <alpha-value>)",
        "border-soft": "rgb(var(--border-soft) / <alpha-value>)",

        // Text
        "text-primary": "rgb(var(--text-0) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-1) / <alpha-value>)",
        "text-tertiary": "rgb(var(--text-2) / <alpha-value>)",
        muted: "rgb(var(--text-1) / <alpha-value>)",
        subtle: "rgb(var(--text-2) / <alpha-value>)",

        // Financial signal (TradingView default)
        up: "rgb(var(--up) / <alpha-value>)",
        down: "rgb(var(--down) / <alpha-value>)",
        "up-soft": "rgb(var(--up-soft) / <alpha-value>)",
        "down-soft": "rgb(var(--down-soft) / <alpha-value>)",

        // Accents
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-2": "rgb(var(--accent-2) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        purple: "rgb(var(--purple) / <alpha-value>)",
        cyan: "rgb(var(--cyan) / <alpha-value>)",
        pink: "rgb(var(--pink) / <alpha-value>)",

        // Semantic
        ok: "rgb(var(--up) / <alpha-value>)",
        stale: "rgb(var(--warn) / <alpha-value>)",
        fail: "rgb(var(--down) / <alpha-value>)",
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
