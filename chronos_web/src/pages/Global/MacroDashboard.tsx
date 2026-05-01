import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { DollarSign } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, endpoints } from "@/lib/api";
import type {
  MacroSeriesListResponse,
  MacroSeriesDataResponse,
  YieldCurveResponse,
  YieldSpreadResponse,
} from "@/lib/types";
import { echartsBase, COLORS, toRgba } from "@/lib/theme";
import { fmtNum, fmtDay, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { YieldCurve, YieldSpread } from "@/components/charts/YieldCurve";

const SERIES_LABELS: Record<string, string> = {
  "10Year": "10Y 国债收益率",
  "2Year": "2Y 国债收益率",
  "CPI": "CPI 通胀",
  "GDP": "GDP",
  "federalFunds": "联邦基金利率",
  "unemploymentRate": "失业率",
  "inflationRate": "通胀率",
  "consumerSentiment": "消费者信心",
  "realGDP": "实际 GDP",
  "retailSales": "零售销售",
};

const MACRO_GROUPS = [
  { key: "rates", label: "利率", ids: ["10Year", "2Year", "federalFunds"] },
  { key: "inflation", label: "通胀", ids: ["CPI", "inflationRate"] },
  { key: "growth", label: "增长", ids: ["GDP", "realGDP", "retailSales"] },
  { key: "labor", label: "就业/信心", ids: ["unemploymentRate", "consumerSentiment"] },
];

export function MacroDashboardPage() {
  const { data: seriesList, isLoading } = useQuery({
    queryKey: ["macro-series-list"],
    queryFn: () => api.get<MacroSeriesListResponse>(endpoints.macroSeries()),
    staleTime: 10 * 60_000,
  });

  const { data: yieldCurve } = useQuery({
    queryKey: ["yieldCurve"],
    queryFn: () => api.get<YieldCurveResponse>(endpoints.yieldCurve()),
    staleTime: 60_000,
  });

  const { data: yieldSpread } = useQuery({
    queryKey: ["yieldSpread"],
    queryFn: () => api.get<YieldSpreadResponse>(endpoints.yieldSpread(), {
      params: { tenor1: "10Y", tenor2: "2Y", days: 365 },
    }),
    staleTime: 60_000,
  });

  const series = seriesList?.series ?? [];

  // Convert yield curve data for the chart
  const currentCurveData = yieldCurve?.curves?.map((c) => ({
    tenor: c.tenor,
    yield: c.yield_rate ?? 0,
  })) ?? [];

  const prioritySeries = useMemo(() => {
    const ids = ["10Year", "2Year", "CPI", "GDP", "federalFunds", "unemploymentRate", "inflationRate"];
    const map = new Map(series.map((s) => [s.series_id, s]));
    const prioritized = ids.map((id) => map.get(id)).filter(Boolean);
    const rest = series.filter((s) => !ids.includes(s.series_id)).slice(0, 6);
    return [...prioritized, ...rest];
  }, [series]);

  const groupedSeries = useMemo(
    () =>
      MACRO_GROUPS.map((group) => ({
        ...group,
        series: prioritySeries.filter((s) => group.ids.includes(s.series_id)),
      })).filter((group) => group.series.length > 0),
    [prioritySeries],
  );

  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("");
  useEffect(() => {
    if (!selectedSeriesId && prioritySeries[0]?.series_id) {
      setSelectedSeriesId(prioritySeries[0].series_id);
    }
  }, [prioritySeries, selectedSeriesId]);

  const {
    data: selectedSeriesData,
    isFetching: isSeriesFetching,
    isError: isSeriesError,
  } = useQuery({
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

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="宏观周期"
        description="理解宏观环境对投资的影响：利率趋势、通胀水平、增长动能。"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MACRO_GROUPS.map((group) => {
          const available = series.filter((s) => group.ids.includes(s.series_id));
          const latestDate = available
            .map((s) => s.date_max)
            .filter(Boolean)
            .sort()
            .at(-1);
          return (
            <div key={group.key} className="card p-3">
              <div className="text-2xs text-text-tertiary">{group.label}覆盖</div>
              <div className="mt-1 text-xl font-semibold text-text-primary">
                {available.length}/{group.ids.length}
              </div>
              <div className="mt-1 text-2xs text-text-tertiary">
                最新日期：{latestDate ? fmtDay(latestDate) : "暂无"}
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
          current={currentCurveData}
          height={240}
        />

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-2xs">
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">10Y-2Y 利差</div>
            <div className="mt-0.5 font-mono text-sm text-text-primary">
              {yieldCurve ? (() => {
                const y10 = yieldCurve.curves?.find((c) => c.tenor === "10Y")?.yield_rate;
                const y2 = yieldCurve.curves?.find((c) => c.tenor === "2Y")?.yield_rate;
                if (y10 != null && y2 != null) {
                  const spread = y10 - y2;
                  return `${spread >= 0 ? "+" : ""}${spread.toFixed(2)}%`;
                }
                return "—";
              })() : "—"}
            </div>
          </div>
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">曲线形态</div>
            <div className="mt-0.5 font-mono text-sm">
              {yieldCurve ? (() => {
                const y10 = yieldCurve.curves?.find((c) => c.tenor === "10Y")?.yield_rate;
                const y2 = yieldCurve.curves?.find((c) => c.tenor === "2Y")?.yield_rate;
                if (y10 != null && y2 != null) {
                  return y10 < y2
                    ? <span className="text-down">倒挂</span>
                    : <span className="text-up">正常</span>;
                }
                return "—";
              })() : "—"}
            </div>
          </div>
          <div className="rounded-md bg-bg-2 p-2">
            <div className="text-text-tertiary">数据日期</div>
            <div className="mt-0.5 font-mono text-sm text-text-primary">
              {yieldCurve?.date ? fmtDay(yieldCurve.date) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Yield Spread History */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          {yieldSpread?.tenor1 ?? "10Y"}-{yieldSpread?.tenor2 ?? "2Y"} 利差历史（经济衰退预警指标）
        </div>
        <YieldSpread
          data={yieldSpread?.items?.map((item) => ({
            date: item.date,
            spread: item.spread ?? 0,
          })) ?? []}
          height={180}
        />
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
          <div className="space-y-3">
            {groupedSeries.map((group) => (
              <div key={group.key}>
                <div className="mb-1 text-2xs text-text-tertiary">{group.label}</div>
                <div className="flex flex-wrap gap-2">
                  {group.series.map((s) => (
                    <button
                      key={s.series_id}
                      type="button"
                      onClick={() => setSelectedSeriesId(s.series_id)}
                      className={cn(
                        "chip max-w-full px-2.5 py-1 text-xs",
                        selectedSeriesId === s.series_id
                          ? "border-accent/50 bg-accent/15 text-accent"
                          : "border-border-soft bg-bg-2/80 text-text-secondary",
                      )}
                      title={`${SERIES_LABELS[s.series_id] ?? s.series_id} (${s.rows} 点，${fmtDay(s.date_min)} 到 ${fmtDay(s.date_max)})`}
                    >
                      <span className="truncate">
                        {SERIES_LABELS[s.series_id] ?? s.series_id}
                      </span>
                      <span className="ml-1 text-2xs text-text-tertiary">{s.rows}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-2xs text-text-tertiary">
          当前：{SERIES_LABELS[selectedSeriesId] ?? (selectedSeriesId || "—")}
          {isSeriesFetching ? "（加载中）" : ""}
          {isSeriesError ? "（加载失败）" : ""}
        </div>
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
              { offset: 0, color: toRgba(COLORS.accent, 0.25) },
              { offset: 1, color: toRgba(COLORS.accent, 0.02) },
            ],
          },
        },
        symbol: "none",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} />;
}
