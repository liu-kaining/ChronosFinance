import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";

import { api, endpoints } from "@/lib/api";
import type { PricesSeriesResponse } from "@/lib/types";
import { tvChartOptions, candleStyle, volumeStyle, maColors } from "@/lib/tv-theme";
import { PageNarrative } from "@/components/ui/PageNarrative";

const CHART_HEIGHT = 420;
const VOLUME_HEIGHT = 80;

export function SymbolChart() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data, isLoading, error } = useQuery({
    queryKey: ["prices", sym],
    queryFn: () =>
      api.get<PricesSeriesResponse>(endpoints.prices(sym), {
        params: { limit: 2000, order: "asc" },
      }),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [ma20Data, setMa20Data] = useState<{ time: string; value: number }[]>([]);
  const [ma50Data, setMa50Data] = useState<{ time: string; value: number }[]>([]);

  // Compute MAs when data arrives
  useEffect(() => {
    if (!data?.items?.length) {
      setMa20Data([]);
      setMa50Data([]);
      return;
    }

    const closes = data.items
      .filter((d) => d.close != null)
      .map((d) => ({ time: d.date, close: d.close! }));

    const calcMA = (period: number) => {
      const result: { time: string; value: number }[] = [];
      for (let i = period - 1; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          sum += closes[j]?.close ?? 0;
        }
        result.push({ time: closes[i]!.time, value: sum / period });
      }
      return result;
    };

    setMa20Data(calcMA(20));
    setMa50Data(calcMA(50));
  }, [data]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...tvChartOptions(),
      width: chartContainerRef.current.clientWidth,
      height: CHART_HEIGHT + VOLUME_HEIGHT,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      ...candleStyle,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candleSeriesRef.current = candleSeries;

    // Volume series (pane below)
    const volumeSeries = chart.addHistogramSeries({
      ...volumeStyle,
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // MA lines
    const ma20Line = chart.addLineSeries({
      color: maColors.ma20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ma50Line = chart.addLineSeries({
      color: maColors.ma50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Store MA refs for data updates
    (chart as unknown as Record<string, unknown>).__ma20 = ma20Line;
    (chart as unknown as Record<string, unknown>).__ma50 = ma50Line;

    // Responsive resize
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0]?.contentRect ?? {};
      if (width) chart.applyOptions({ width });
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data when fetched
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !data?.items?.length) return;

    const candleData: CandlestickData[] = [];
    const volumeData: HistogramData[] = [];

    let prevClose: number | null = null;
    for (const d of data.items) {
      if (d.open == null || d.high == null || d.low == null || d.close == null) continue;
      candleData.push({
        time: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      });
      if (d.volume != null) {
        volumeData.push({
          time: d.date,
          value: d.volume,
          color: d.close >= (prevClose ?? d.open) ? volumeStyle.upColor : volumeStyle.downColor,
        });
      }
      prevClose = d.close;
    }

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Update MA lines
    const ma20 = (chart as unknown as Record<string, ISeriesApi<"Line">>).__ma20;
    const ma50 = (chart as unknown as Record<string, ISeriesApi<"Line">>).__ma50;
    if (ma20 && ma20Data.length) ma20.setData(ma20Data);
    if (ma50 && ma50Data.length) ma50.setData(ma50Data);

    chart.timeScale().fitContent();
  }, [data, ma20Data, ma50Data]);

  if (isLoading) {
    return (
      <div className="card flex h-[500px] items-center justify-center">
        <div className="text-sm text-text-tertiary">加载价格图表中…</div>
      </div>
    );
  }

  if (error || !data?.items?.length) {
    return (
      <div className="card flex h-[500px] items-center justify-center">
        <div className="text-sm text-text-tertiary">暂无价格数据。</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageNarrative
        title="价格叙事"
        description="先看趋势与均线结构，再结合成交量确认突破/回撤是否有资金支持。"
      />
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: maColors.ma20 }} />
          <span className="text-text-secondary">均线20</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: maColors.ma50 }} />
          <span className="text-text-secondary">均线50</span>
        </div>
        <div className="ml-auto text-text-tertiary">
          {data.rows} 根K线 · {data.items[0]?.date} 至 {data.items[data.items.length - 1]?.date}
        </div>
      </div>

      {/* Chart container */}
      <div className="card overflow-hidden p-1">
        <div ref={chartContainerRef} className="w-full" />
      </div>
    </div>
  );
}
