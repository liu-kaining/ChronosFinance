function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw})` : fallback;
}

export const COLORS = {
  get up() {
    return cssColor("--up", "#16a34a");
  },
  get down() {
    return cssColor("--down", "#dc2626");
  },
  get accent() {
    return cssColor("--accent", "#2563eb");
  },
  get accent2() {
    return cssColor("--accent-2", "#d97706");
  },
  get warn() {
    return cssColor("--warn", "#d97706");
  },
  get purple() {
    return cssColor("--purple", "#9333ea");
  },
  get cyan() {
    return cssColor("--cyan", "#0891b2");
  },
  get pink() {
    return cssColor("--pink", "#db2777");
  },
  get grid() {
    return cssColor("--border-soft", "#334155");
  },
  get borderSoft() {
    return cssColor("--border-soft", "#334155");
  },
  get text() {
    return cssColor("--text-1", "#64748b");
  },
  get text1() {
    return cssColor("--text-1", "#64748b");
  },
  get textStrong() {
    return cssColor("--text-0", "#0f172a");
  },
};

export const echartsBase = {
  backgroundColor: "transparent",
  textStyle: { color: COLORS.text },
  grid: { left: 32, right: 16, top: 24, bottom: 24, containLabel: true },
  xAxis: { axisLine: { lineStyle: { color: COLORS.grid } } },
  yAxis: { axisLine: { lineStyle: { color: COLORS.grid } } },
};

export function signalColor(value: number | null | undefined): string | undefined {
  if (value == null || Number.isNaN(value) || value === 0) return undefined;
  return value > 0 ? COLORS.up : COLORS.down;
}
