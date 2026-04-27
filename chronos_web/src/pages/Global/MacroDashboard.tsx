import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { LineChart, TrendingUp, TrendingDown, Activity, Globe, DollarSign } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, endpoints } from "@/lib/api";
import type { MacroSeriesListResponse, MacroSeriesDataResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtNum, fmtDay, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { YieldCurve, YieldSpread } from "@/components/charts/YieldCurve";
import { Sparkline } from "@/components/ui/Sparkline";

// Mock yield curve data - replace with actual API when available
const MOCK_YIELD_CURVE = [
  { tenor: "1M", yield: 5.25 },
  { tenor: "3M", yield: 5.32 },
  { tenor: "6M", yield: 5.28 },
  { tenor: "1Y", yield: 5.15 },
  { tenor: "2Y", yield: 4.85 },
  { tenor: "3Y", yield: 4.65 },
  { tenor: "5Y", yield: 4.45 },
  { tenor: "7Y", yield: 4.35 },
  { tenor: "10Y", yield: 4.25 },
  { tenor: "20Y", yield: 4.45 },
  { tenor: "30Y", yield: 4.35 },
];

const MOCK_YIELD_1M_AGO = [
  { tenor: "1M", yield: 5.15 },
  { tenor: "3M", yield: 5.22 },
  { tenor: "6M", yield: 5.18 },
  { tenor: "1Y", yield: 5.05 },
  { tenor: "2Y", yield: 4.75 },
  { tenor: "3Y", yield: 4.55 },
  { tenor: "5Y", yield: 4.35 },
  { tenor: "7Y", yield: 4.25 },
  { tenor: "10Y", yield: 4.15 },
  { tenor: "20Y", yield: 4.35 },
  { tenor: "30Y", yield: 4.25 },
];

const MOCK_SPREAD_HISTORY = Array.from({ length: 365 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (365 - i));
  const baseSpread = 0.4 + Math.sin(i / 30) * 0.2;
  return {
    date: date.toISOString().split("T")[0],
    spread: baseSpread + (Math.random() - 0.5) * 0.1,
  };
});

export function MacroDashboardPage() {
  const { data: seriesList, isLoading } = useQuery({
    queryKey: ["macro-series-list"],
    queryFn: () => api.get<MacroSeriesListResponse>(endpoints.macroSeries()),
    staleTime: 10 * 60_000,
  });

  const series = seriesList?.series ?? [];

  const prioritySeries = useMemo(() => {
    const ids = ["10Year", "2Year", "CPI", "GDP", "federalFunds", "unemploymentRate", "inflationRate"];
    const map = new Map(series.map((s) => [s.series_id, s]));
    const prioritized = ids.map((id) => map.get(id)).filter(Boolean);
    const rest = series.filter((s) => !ids.includes(s.series_id)).slice(0, 6);
    return [...prioritized, ...rest];
  }, [series]);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("");
  useEffect(() => {
    if (!selectedSeriesId && prioritySeries[0]?.series_id) {
      setSelectedSeriesId(prioritySeries[0].series_id);
    }
  }, [prioritySeries, selectedSeriesId]);

  const { data: selectedSeriesData } = useQuery({
    queryKey: ["macro-data", selectedSeriesId],
    queryFn: () =>
      api.get<MacroSeriesDataResponse>(endpoints.macroSeriesById(selectedSeriesId), {
        params: { limit: 365, order: "asc" },
      }),
    enabled: !!selectedSeriesId,
    staleTime: 10 * 60_000,
  });

  const trendSummary = useMemo(() => {
    const rows = (selectedSeriesData?.items ?? []).filter((d) => typeof d.value === "number");
    if (!rows.length) return null;
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const delta = (last.value as number) - (first.value as number);
    return {
      first: first.value as number,
      last: last.value as number,
      delta,
      start: first.date,
      end: last.date,
      direction: delta > 0 ? "上行" : delta < 0 ? "下行" : "震荡",
    };
  }, [selectedSeriesData?.items]);

  // Key metrics for dashboard
  const keyMetrics = [
    { id: "10Year", name: "10年期国债", icon: <TrendingUp size={14} />, unit: "%" },
    { id: "2Year", name: "2年期国债", icon: <TrendingDown size={14} />, unit: "%" },
    { id: "CPI", name: "CPI通胀", icon: <Activity size={14} />, unit: "%" },
    { id: "unemploymentRate", name: "失业率", icon: <Globe size={14} />, unit: "%" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="宏观周期"
        description="理解宏观环境对投资的影响：利率趋势、通胀水平、增长动能。"
      />

      {/* Key Metrics Dashboard */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {keyMetrics.map((metric) => {
          const seriesData = series.find((s) => s.series_id === metric.id);
          const latestValue = seriesData ? 4.25 : null; // Mock value
          const change = seriesData ? 0.1 : null; // Mock change

          return (
            <div key={metric.id} className="card p-3">
              <div className="flex items-center gap-1.5 text-2xs text-text-tertiary">
                {metric.icon}
                <span>{metric.name}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold text-text-primary">
                  {latestValue?.toFixed(2) ?? "—"}
                  <span className="ml-0.5 text-sm">{metric.unit}</span>
                </span>
                {change !== null && (
                  <span className={cn("text-xs", change > 0 ? "text-up" : "text-down")}>
                    {change > 0 ? "+" : ""}
                    {change.toFixed(2)}
                  </span>
                )}
              </div>
              {/* Mini sparkline */}
              <div className="mt-2">
                <Sparkline
                  data={MOCK_SPREAD_HISTORY.slice(-30).map((d) => d.spread * 10)}
                  width={120}
                  height={24}
                  color={change && change > 0 ? COLORS.up : COLORS.down}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Yield Curve Section */}
      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            <DollarSign size={14} />
            <span>收益率曲线</span>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1 text-2xs text-text-secondary">
              <span className="h-0.5 w-3 bg-accent" /> 当前
            </span>
            <span className="flex items-center gap-1 text-2xs text-text-secondary">
              <span className="h-0.5 w-3 border-b border-dashed border-accent-2" /> 1月前
            </span>
          </div>
        </div>

        <YieldCurve
          current={MOCK_YIELD_CURVE}
          comparison1={{ data: MOCK_YIELD_1M_AGO, label: "1月前" }}
          height={240}
        />

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-2xs">
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">10Y-2Y 利差</div>
            <div className="mt-0.5 font-mono text-sm text-text-primary">-0.60%</div>
          </div>
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">曲线形态</div>
            <div className="mt-0.5 font-mono text-sm text-down">倒挂</div>
          </div>
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">1月变化</div>
            <div className="mt-0.5 font-mono text-sm text-up">+10bp</div>
          </div>
        </div>
      </div>

      {/* Yield Spread History */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          10Y-2Y 利差历史（经济衰退预警指标）
        </div>
        <YieldSpread data={MOCK_SPREAD_HISTORY} height={180} />
        <div className="mt-2 text-2xs text-text-tertiary">
          利差为负（曲线倒挂）往往预示经济衰退风险。当前利差处于历史低位。
        </div>
      </div>

      {/* Macro Series Selection */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          宏观序列选择
        </div>
        {prioritySeries.length === 0 ? (
          <EmptyDataState title="暂无宏观序列可选" detail="请先检查宏观序列同步状态。" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {prioritySeries.slice(0, 16).map((s) => (
              <button
                key={s.series_id}
                type="button"
                onClick={() => setSelectedSeriesId(s.series_id)}
                className={cn(
                  "chip",
                  selectedSeriesId === s.series_id ? "border-accent/40 bg-accent/10 text-accent" : ""
                )}
              >
                {s.series_id}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conclusion Card */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">一句话结论</div>
        {trendSummary ? (
          <div className="text-sm text-text-secondary">
            当前关注序列 <span className="font-mono text-text-primary">{selectedSeriesId}</span> 在近一年呈
            <span
              className={cn(
                "mx-1 font-medium",
                trendSummary.delta > 0 ? "text-up" : trendSummary.delta < 0 ? "text-down" : "text-text-primary"
              )}
            >
              {trendSummary.direction}
            </span>
            趋势，区间变化 {fmtNum(trendSummary.first, 3)} → {fmtNum(trendSummary.last, 3)}（
            {trendSummary.delta >= 0 ? "+" : ""}
            {fmtNum(trendSummary.delta, 3)}）。
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">当前序列暂无可计算趋势数据。</div>
        )}
      </div>

      {/* Selected Series Chart */}
      {selectedSeriesData && (
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {selectedSeriesData.series_id} · 近 365 天趋势
          </div>
          <MacroLineChart data={selectedSeriesData.items ?? []} />
        </div>
      )}

      {/* Series List Table */}
      <div className="card overflow-auto p-2">
        <table className="table-modern">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">序列 ID</th>
              <th className="px-2 py-1.5 text-right">点数</th>
              <th className="px-2 py-1.5">开始</th>
              <th className="px-2 py-1.5">结束</th>
            </tr>
          </thead>
          <tbody>
            {series.slice(0, 30).map((s, i) => (
              <tr
                key={s.series_id}
                className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
              >
                <td className="px-2 py-1.5 font-mono text-text-primary">{s.series_id}</td>
                <td className="px-2 py-1.5 text-right font-mono text-text-secondary">{s.rows}</td>
                <td className="px-2 py-1.5 font-mono text-text-secondary">{fmtDay(s.date_min)}</td>
                <td className="px-2 py-1.5 font-mono text-text-secondary">{fmtDay(s.date_max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MacroLineChart({ data }: { data: Array<{ date: string; value: number | null }> }) {
  const validData = data.filter((d) => d.value != null);
  if (validData.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">暂无宏观序列数据</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const p = params[0];
        if (!p) return "";
        return `<b>${p.axisValue}</b><br/>数值：${fmtNum(p.data, 3)}`;
      },
    },
    grid: { left: 48, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: validData.map((d) => fmtDay(d.date).slice(5)),
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data: validData.map((d) => d.value),
        smooth: true,
        lineStyle: { color: COLORS.accent, width: 1.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${COLORS.accent.replace("rgb(", "rgba(").replace(")", ",0.25)")}` },
              { offset: 1, color: `${COLORS.accent.replace("rgb(", "rgba(").replace(")", ",0.02)")}` },
            ],
          },
        },
        symbol: "none",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} />;
}
