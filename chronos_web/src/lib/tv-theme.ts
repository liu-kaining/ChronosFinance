import type { DeepPartial, ChartOptions } from "lightweight-charts";

export const maColors = {
  ma20: "#f59e0b",
  ma50: "#06b6d4",
};

export const candleStyle = {
  upColor: "#22c55e",
  downColor: "#ef4444",
  borderUpColor: "#22c55e",
  borderDownColor: "#ef4444",
  wickUpColor: "#22c55e",
  wickDownColor: "#ef4444",
};

export const volumeStyle = {
  upColor: "rgba(34, 197, 94, 0.45)",
  downColor: "rgba(239, 68, 68, 0.45)",
};

export function tvChartOptions(): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { color: "#0b1220" },
      textColor: "#9ca3af",
    },
    grid: {
      vertLines: { color: "#1f2937" },
      horzLines: { color: "#1f2937" },
    },
    rightPriceScale: {
      borderColor: "#1f2937",
    },
    timeScale: {
      borderColor: "#1f2937",
    },
    crosshair: {
      vertLine: { color: "#334155" },
      horzLine: { color: "#334155" },
    },
  };
}
