import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { LineChart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api, endpoints } from "@/lib/api";
import type { MacroSeriesListResponse, MacroSeriesDataResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";

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
      api.get<MacroSeriesDataResponse>(
        endpoints.macroSeriesById(selectedSeriesId),
        { params: { limit: 365, order: "asc" } }
      ),
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
        title="宏观叙事"
        description="这页用于回答三件事：当前宏观变量在上行还是下行、变化幅度多大、它对市场风格意味着什么。"
      />

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">一句话结论</div>
        {trendSummary ? (
          <div className="text-sm text-text-secondary">
            当前关注序列 <span className="font-mono text-text-primary">{selectedSeriesId}</span> 在近一年呈
            <span className={cn("mx-1 font-medium", trendSummary.delta > 0 ? "text-up" : trendSummary.delta < 0 ? "text-down" : "text-text-primary")}>
              {trendSummary.direction}
            </span>
            趋势，区间变化 {fmtNum(trendSummary.first, 3)} → {fmtNum(trendSummary.last, 3)}（
            {trendSummary.delta >= 0 ? "+" : ""}{fmtNum(trendSummary.delta, 3)}）。
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">当前序列暂无可计算趋势数据。</div>
        )}
      </div>

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">可切换观察序列</div>
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
                  selectedSeriesId === s.series_id ? "border-accent/40 bg-accent/10 text-accent" : "",
                )}
              >
                {s.series_id}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <LineChart size={14} />
          <span>宏观序列覆盖</span>
          <span className="ml-auto font-mono text-text-secondary">{series.length}</span>
        </div>

        {isLoading ? (
          <div className="h-[100px] animate-pulse rounded bg-bg-3" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {series.slice(0, 20).map((s) => (
              <div
                key={s.series_id}
                className="chip flex items-center gap-2"
              >
                <span className="font-mono text-text-primary">{s.series_id}</span>
                <span className="text-2xs text-text-tertiary">
                  {s.rows} 点 · {fmtDay(s.date_min)} 至 {fmtDay(s.date_max)}
                </span>
              </div>
            ))}
            {series.length > 20 && (
              <span className="chip text-text-tertiary">+{series.length - 20} 条</span>
            )}
          </div>
        )}
      </div>

      {/* Treasury yield chart */}
      {selectedSeriesData && (
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {selectedSeriesData.series_id} · 近 365 天趋势
          </div>
          <MacroLineChart data={selectedSeriesData.items ?? []} />
        </div>
      )}

      {/* Series list table */}
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
      formatter: (params: { axisValue: string; data: number }[]) => {
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
