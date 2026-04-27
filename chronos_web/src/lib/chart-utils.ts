import { toRgba } from "@/lib/theme";

export function safePct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function safeValue(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

export function buildDivergingScale(negative: string, neutral: string, positive: string): string[] {
  return [toRgba(negative, 0.9), toRgba(neutral, 0.8), toRgba(positive, 0.9)];
}

export function clampAbsMax(values: number[], floor = 1): number {
  if (!values.length) return floor;
  const m = Math.max(...values.map((v) => Math.abs(v)));
  return Number.isFinite(m) ? Math.max(m, floor) : floor;
}
