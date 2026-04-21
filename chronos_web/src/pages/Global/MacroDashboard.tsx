import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { LineChart } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { MacroSeriesListResponse, MacroSeriesDataResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export function MacroDashboardPage() {
  const { data: seriesList, isLoading } = useQuery({
    queryKey: ["macro-series-list"],
    queryFn: () => api.get<MacroSeriesListResponse>(endpoints.macroSeries()),
    staleTime: 10 * 60_000,
  });

  const series = seriesList?.series ?? [];

  // Find treasury yield series
  const treasurySeries = series.filter((s) =>
    s.series_id.toLowerCase().includes("treasury") ||
    s.series_id.toLowerCase().includes("dgs10") ||
    s.series_id.toLowerCase().includes("dgs2")
  ).slice(0, 5);

  // Fetch first treasury series data
  const { data: treasuryData } = useQuery({
    queryKey: ["macro-data", treasurySeries[0]?.series_id],
    queryFn: () =>
      api.get<MacroSeriesDataResponse>(
        endpoints.macroSeriesById(treasurySeries[0]?.series_id ?? ""),
        { params: { limit: 365, order: "asc" } }
      ),
    enabled: treasurySeries.length > 0,
    staleTime: 10 * 60_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <LineChart size={14} />
          <span>Macro Series Available</span>
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
                  {s.rows} pts · {fmtDay(s.date_min)} → {fmtDay(s.date_max)}
                </span>
              </div>
            ))}
            {series.length > 20 && (
              <span className="chip text-text-tertiary">+{series.length - 20} more</span>
            )}
          </div>
        )}
      </div>

      {/* Treasury yield chart */}
      {treasuryData && (
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {treasuryData.series_id} — Last 365 Days
          </div>
          <MacroLineChart data={treasuryData.items ?? []} />
        </div>
      )}

      {/* Series list table */}
      <div className="card overflow-auto p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">Series ID</th>
              <th className="px-2 py-1.5 text-right">Points</th>
              <th className="px-2 py-1.5">Start</th>
              <th className="px-2 py-1.5">End</th>
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
    return <div className="py-8 text-center text-xs text-text-tertiary">No data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      formatter: (params: { axisValue: string; data: number }[]) => {
        const p = params[0];
        if (!p) return "";
        return `<b>${p.axisValue}</b><br/>${fmtNum(p.data, 3)}`;
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
              { offset: 0, color: "rgba(41,98,255,0.25)" },
              { offset: 1, color: "rgba(41,98,255,0.02)" },
            ],
          },
        },
        symbol: "none",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} />;
}
