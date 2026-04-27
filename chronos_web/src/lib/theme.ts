function normalizeCssColor(raw: string, fallback: string): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value) return fallback;

  // Already a concrete CSS color string.
  if (
    value.startsWith("#") ||
    value.startsWith("rgb(") ||
    value.startsWith("rgba(") ||
    value.startsWith("hsl(") ||
    value.startsWith("hsla(")
  ) {
    return value;
  }

  // Convert CSS variable channels like "14 165 126" to legacy rgb syntax
  // because some chart libs do not parse space-separated rgb channels.
  const channels = value.split(/\s+/).filter(Boolean);
  if (channels.length === 3 && channels.every((c) => /^\d+(\.\d+)?$/.test(c))) {
    return `rgb(${channels.join(",")})`;
  }
  if (channels.length === 4 && channels.every((c) => /^\d+(\.\d+)?$/.test(c))) {
    return `rgba(${channels.join(",")})`;
  }

  return fallback;
}

function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return normalizeCssColor(raw, fallback);
}

export function toRgba(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const c = (color || "").trim();

  const rgbMatch = c.match(/^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${a})`;
  }

  const rgbaMatch = c.match(/^rgba\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]},${a})`;
  }

  const hex = c.replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (/^[\da-f]{3}$/i.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  return c || `rgba(37,99,235,${a})`;
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
  get text2() {
    return cssColor("--text-2", "#94a3b8");
  },
  get text0() {
    return cssColor("--text-0", "#0f172a");
  },
  get textStrong() {
    return cssColor("--text-0", "#0f172a");
  },
};

export const echartsBase = {
  backgroundColor: "transparent",
  textStyle: { color: COLORS.text },
  tooltip: { backgroundColor: "rgba(15,23,42,0.92)", borderColor: COLORS.borderSoft, textStyle: { color: COLORS.text0 } },
  grid: { left: 32, right: 16, top: 24, bottom: 24, containLabel: true },
  xAxis: { axisLine: { lineStyle: { color: COLORS.grid } } },
  yAxis: { axisLine: { lineStyle: { color: COLORS.grid } } },
};

export function signalColor(value: number | null | undefined): string | undefined {
  if (value == null || Number.isNaN(value) || value === 0) return undefined;
  return value > 0 ? COLORS.up : COLORS.down;
}
