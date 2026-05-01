import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi } from "lightweight-charts";
import type { DailyPrice } from "../../lib/types";

interface PriceChartProps {
  data: DailyPrice[];
  height?: number;
  showVolume?: boolean;
  showMA?: boolean;
  maPeriod?: number;
}

export function PriceChart({
  data,
  height = 400,
  showVolume = true,
  showMA = true,
  maPeriod = 20,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(75, 85, 99, 0.3)" },
        horzLines: { color: "rgba(75, 85, 99, 0.3)" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "rgba(75, 85, 99, 0.5)",
      },
      timeScale: {
        borderColor: "rgba(75, 85, 99, 0.5)",
        timeVisible: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#10b981",
      wickDownColor: "#ef4444",
      wickUpColor: "#10b981",
    });
    candleSeriesRef.current = candleSeries;

    // Volume series
    if (showVolume) {
      const volumeSeries = chart.addHistogramSeries({
        color: "#6b7280",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;
    }

    // MA series
    if (showMA) {
      const maSeries = chart.addLineSeries({
        color: "#f59e0b",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      maSeriesRef.current = maSeries;
    }

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [height, showVolume, showMA]);

  // Update data
  useEffect(() => {
    if (!data.length) return;

    // Sort by date ascending
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    // Candlestick data
    const candleData = sorted.map((d) => ({
      time: d.date as string,
      open: d.open ?? 0,
      high: d.high ?? 0,
      low: d.low ?? 0,
      close: d.close ?? 0,
    }));
    candleSeriesRef.current?.setData(candleData);

    // Volume data
    if (volumeSeriesRef.current) {
      const volumeData = sorted.map((d) => ({
        time: d.date as string,
        value: d.volume ?? 0,
        color: (d.close ?? 0) >= (d.open ?? 0)
          ? "rgba(16, 185, 129, 0.3)"
          : "rgba(239, 68, 68, 0.3)",
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    // MA data
    if (maSeriesRef.current && sorted.length >= maPeriod) {
      const maData: Array<{ time: string; value: number }> = [];
      for (let i = maPeriod - 1; i < sorted.length; i++) {
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) {
          sum += sorted[i - j].close ?? 0;
        }
        maData.push({
          time: sorted[i].date as string,
          value: sum / maPeriod,
        });
      }
      maSeriesRef.current.setData(maData);
    }

    // Fit content
    chartRef.current?.timeScale().fitContent();
  }, [data, maPeriod]);

  return <div ref={containerRef} className="w-full" />;
}
