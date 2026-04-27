import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { EarningsSeriesResponse, CorporateActionsResponse, InsiderSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { buildDivergingScale, clampAbsMax, safePct } from "@/lib/chart-utils";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

export function SymbolEvents() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [epsWindow, setEpsWindow] = useState<8 | 12 | 16>(8);
  const [selectedEarningsKey, setSelectedEarningsKey] = useState<string>("");

  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ["earnings", sym],
    queryFn: () => api.get<EarningsSeriesResponse>(endpoints.earnings(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: actions } = useQuery({
    queryKey: ["corp-actions", sym],
    queryFn: () => api.get<CorporateActionsResponse>(endpoints.corpActions(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: insider } = useQuery({
    queryKey: ["insider", sym],
    queryFn: () => api.get<InsiderSeriesResponse>(endpoints.insider(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const earningsRows = useMemo(() => {
    const base = (earnings?.items ?? []).slice(0, Math.max(12, epsWindow));
    return base.map((e, idx) => ({
      ...e,
      __key: earningsKey(e, idx),
    }));
  }, [earnings?.items, epsWindow]);
  const positiveEpsBeats = earningsRows.filter((e) => {
    if (typeof e.eps_actual !== "number" || typeof e.eps_estimated !== "number" || e.eps_estimated === 0) {
      return false;
    }
    return e.eps_actual > e.eps_estimated;
  }).length;
  const beatRatio = earningsRows.length > 0 ? positiveEpsBeats / earningsRows.length : 0;
  const eventSignal = beatRatio >= 0.6 ? "业绩偏强" : beatRatio <= 0.4 ? "业绩偏弱" : "业绩分化";

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="事件叙事"
        description="先看 EPS 是否持续超预期，再结合公司行为与内部人交易，判断基本面改善是否被资金验证。"
        actions={
          <span className="chip">
            当前信号：<span className="font-medium text-text-primary">{eventSignal}</span>（近 {fmtNum(earningsRows.length, 0)} 期，超预期 {fmtNum(positiveEpsBeats, 0)} 期）
          </span>
        }
      />

      <div className="card grid grid-cols-3 gap-3 p-3 text-center">
        <div>
          <div className="text-2xs text-text-tertiary">财报记录</div>
          <div className="kpi-num">{(earnings?.items ?? []).length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">内部人交易</div>
          <div className="kpi-num">{(insider?.items ?? []).length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">公司行为</div>
          <div className="kpi-num">{(actions?.items ?? []).length}</div>
        </div>
      </div>

      {/* EPS Surprise Chart */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <span>EPS 超预期（近 {epsWindow} 个季度）</span>
          <div className="flex items-center gap-1 normal-case tracking-normal">
            {[8, 12, 16].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setEpsWindow(w as 8 | 12 | 16)}
                className={cn(
                  "rounded border px-2 py-0.5 text-2xs",
                  epsWindow === w
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border-soft text-text-tertiary",
                )}
              >
                {w}Q
              </button>
            ))}
          </div>
        </div>
        {earningsLoading ? (
          <div className="h-[200px] animate-pulse rounded bg-bg-3" />
        ) : (
          <EpsSurpriseChart
            items={earningsRows}
            window={epsWindow}
            selectedKey={selectedEarningsKey}
            onSelect={setSelectedEarningsKey}
          />
        )}
      </div>

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          EPS 超预期热力图（季度矩阵）
        </div>
        <EpsSurpriseHeatmap
          items={earningsRows}
          window={epsWindow}
          selectedKey={selectedEarningsKey}
          onSelect={setSelectedEarningsKey}
        />
        {earningsRows.length === 0 ? (
          <div className="mt-2 flex flex-wrap gap-2 text-2xs">
            <Link to={`/symbol/${sym}/raw`} className="chip">
              查看原始接口返回
            </Link>
            <Link to="/global/data-assets?table=earnings_calendar" className="chip">
              查看财报表覆盖
            </Link>
          </div>
        ) : null}
      </div>

      {/* Earnings table */}
      <div className="card overflow-auto p-2">
        <table className="table-modern">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">日期</th>
              <th className="px-2 py-1.5">财报期</th>
              <th className="px-2 py-1.5 text-right">EPS 预期</th>
              <th className="px-2 py-1.5 text-right">EPS 实际</th>
              <th className="px-2 py-1.5 text-right">超预期</th>
              <th className="px-2 py-1.5 text-right">营收预期</th>
              <th className="px-2 py-1.5 text-right">营收实际</th>
            </tr>
          </thead>
          <tbody>
            {earningsRows.slice(0, 12).map((e, i) => {
              const epsSurprise =
                e.eps_estimated != null && e.eps_estimated !== 0 && e.eps_actual != null
                  ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
                  : null;
              return (
                <tr
                  key={e.__key}
                  className={cn(
                    "cursor-pointer border-b border-border-soft/50",
                    i % 2 === 0 ? "bg-bg-2/30" : "",
                    selectedEarningsKey === e.__key ? "bg-accent/10" : "",
                  )}
                  onClick={() => setSelectedEarningsKey(e.__key)}
                >
                  <td className="px-2 py-1.5 font-mono text-text-primary">{fmtDay(e.date)}</td>
                  <td className="px-2 py-1.5 text-text-secondary">{e.fiscal_period_end ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtNum(e.eps_estimated, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-primary">
                    {fmtNum(e.eps_actual, 2)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-mono"
                    style={{ color: signalColor(epsSurprise != null ? epsSurprise / 100 : null) }}
                  >
                    {safePct(epsSurprise, 1)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtCap(e.revenue_estimated)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-primary">
                    {fmtCap(e.revenue_actual)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Corporate Actions */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          公司行为（分红 / 拆股）
        </div>
        <div className="flex flex-wrap gap-2">
          {(actions?.items ?? []).slice(0, 10).map((a, i) => (
            <div
              key={`${a.action_date}-${i}`}
              className="chip flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-2xs font-medium",
                  a.action_type === "dividend"
                    ? "bg-up-soft text-up"
                    : a.action_type === "split"
                      ? "bg-purple/15 text-purple"
                      : "bg-bg-3 text-text-secondary",
                )}
              >
                {a.action_type}
              </span>
              <span className="font-mono text-2xs text-text-secondary">
                {fmtDay(a.action_date)}
              </span>
            </div>
          ))}
          {(!actions?.items || actions.items.length === 0) && (
            <EmptyDataState
              title="暂无近期公司行为"
              detail="可能是该标的近期没有分红/拆股，也可能是该数据仍在同步中。"
              actions={
                <Link to="/global/data-assets?table=corporate_actions" className="chip">
                  去看公司行为覆盖
                </Link>
              }
            />
          )}
        </div>
      </div>

      {/* Insider trades */}
      <div className="card overflow-auto p-2">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          内部人交易
        </div>
        <table className="table-modern">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">申报日期</th>
              <th className="px-2 py-1.5">主体</th>
              <th className="px-2 py-1.5">类型</th>
              <th className="px-2 py-1.5 text-right">股数</th>
              <th className="px-2 py-1.5 text-right">价格</th>
            </tr>
          </thead>
          <tbody>
            {(insider?.items ?? []).slice(0, 15).map((ins, i) => (
              <tr
                key={`${ins.filing_date}-${i}`}
                className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
              >
                <td className="px-2 py-1.5 font-mono text-text-secondary">
                  {fmtDay(ins.filing_date)}
                </td>
                <td className="max-w-[200px] truncate px-2 py-1.5 text-text-primary">
                  {ins.reporting_name ?? "—"}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-2xs",
                      ins.transaction_type?.toLowerCase().includes("buy")
                        ? "bg-up-soft text-up"
                        : ins.transaction_type?.toLowerCase().includes("sell")
                          ? "bg-down-soft text-down"
                          : "bg-bg-3 text-text-secondary",
                    )}
                  >
                    {ins.transaction_type ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                  {fmtCap(ins.securities_transacted, 0)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                  {fmtNum(ins.price, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!insider?.items || insider.items.length === 0) && (
          <div className="p-3">
            <EmptyDataState
              title="暂无内部人交易"
              detail="可先检查表覆盖情况，再去原始页确认接口返回。"
              actions={
                <>
                  <Link to="/global/data-assets?table=insider_trades" className="chip">
                    去看内部人覆盖
                  </Link>
                  <Link to={`/symbol/${sym}/raw`} className="chip">
                    去看原始数据
                  </Link>
                </>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EpsSurpriseChart({
  items,
  window,
  selectedKey,
  onSelect,
}: {
  items: Array<{ date: string; eps_estimated: number | null; eps_actual: number | null; __key: string }>;
  window: number;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const data = items
    .filter((e) => e.eps_estimated != null && e.eps_actual != null)
    .slice(0, window)
    .reverse();

  if (data.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">暂无 EPS 数据</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; dataIndex: number }>) => {
        const p = params?.[0];
        if (!p) return "";
        const row = data[p.dataIndex];
        const d = row?.date ? fmtDay(row.date) : "—";
        const est = row?.eps_estimated ?? null;
        const act = row?.eps_actual ?? null;
        const surprise =
          typeof est === "number" && typeof act === "number" && est !== 0
            ? ((act - est) / Math.abs(est)) * 100
            : null;
        return [
          `<b>${d}</b>`,
          `EPS 预期：${fmtNum(est, 2)}`,
          `EPS 实际：${fmtNum(act, 2)}`,
          `超预期：${surprise === null ? "—" : `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%`}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: ["预期", "实际"],
      top: 0,
      textStyle: { color: COLORS.text },
    },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    xAxis: {
      type: "category",
      data: data.map((d) => fmtDay(d.date).slice(5)),
      axisLine: { lineStyle: { color: COLORS.grid } },
      axisLabel: { color: COLORS.text, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: COLORS.text, fontSize: 10 },
      splitLine: { lineStyle: { color: COLORS.grid, type: "dashed" } },
    },
    series: [
      {
        name: "预期",
        type: "bar",
        data: data.map((d) => ({
          value: d.eps_estimated,
          itemStyle: {
            color: d.__key === selectedKey ? COLORS.accent2 : "#6b7280",
          },
        })),
        barWidth: "35%",
      },
      {
        name: "实际",
        type: "bar",
        data: data.map((d, idx) => ({
          value: d.eps_actual,
          itemStyle: {
            color:
              d.__key === selectedKey
                ? COLORS.accent
                : (d.eps_actual ?? 0) >= (data[idx]?.eps_estimated ?? 0)
                  ? COLORS.up
                  : COLORS.down,
          },
        })),
        itemStyle: {
          color: (params: { value: number; dataIndex: number }) =>
            params.value >= (data[params.dataIndex]?.eps_estimated ?? 0) ? COLORS.up : COLORS.down,
        },
        barWidth: "35%",
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 200 }}
      onEvents={{
        click: (params: { dataIndex?: number }) => {
          if (typeof params.dataIndex !== "number") return;
          const row = data[params.dataIndex];
          if (row?.__key) onSelect(row.__key);
        },
      }}
    />
  );
}

function EpsSurpriseHeatmap({
  items,
  window,
  selectedKey,
  onSelect,
}: {
  items: Array<{ date: string; eps_estimated: number | null; eps_actual: number | null; __key: string }>;
  window: number;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const enriched = items
    .filter((e) => e.eps_estimated != null && e.eps_actual != null && e.eps_estimated !== 0)
    .slice(0, window)
    .map((e) => {
      const dt = new Date(e.date);
      const year = Number.isNaN(dt.getTime()) ? "N/A" : String(dt.getUTCFullYear());
      const q = Number.isNaN(dt.getTime()) ? "?" : `Q${Math.floor(dt.getUTCMonth() / 3) + 1}`;
      const surprise = ((e.eps_actual! - e.eps_estimated!) / Math.abs(e.eps_estimated!)) * 100;
      return { year, quarter: q, surprise, key: e.__key };
    })
    .sort((a, b) => a.year.localeCompare(b.year));

  if (enriched.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">暂无 EPS 超预期数据</div>;
  }

  const years = Array.from(new Set(enriched.map((x) => x.year)));
  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const matrix = enriched
    .map((x) => {
      const xIdx = years.indexOf(x.year);
      const yIdx = quarters.indexOf(x.quarter);
      return {
        value: [xIdx, yIdx, Number(x.surprise.toFixed(2))] as [number, number, number],
        __key: x.key,
      };
    })
    .filter((row) => row.value[0] >= 0 && row.value[1] >= 0);
  const matrixValues = matrix
    .map((m) => m.value)
    .filter((row) => row[0] >= 0 && row[1] >= 0);
  const maxAbs = clampAbsMax(matrixValues.map((m) => m[2]), 5);

  const option = {
    ...echartsBase,
    tooltip: {
      position: "top",
      formatter: (p: { data?: { value?: [number, number, number] } | [number, number, number]; value?: [number, number, number] }) => {
        const tuple = Array.isArray(p.value)
          ? p.value
          : Array.isArray(p.data)
            ? p.data
            : p.data?.value;
        if (!tuple) return "超预期：--";
        const [x, y, v] = tuple;
        return `${years[x]} ${quarters[y]}<br/>超预期：${safePct(v, 2)}`;
      },
    },
    grid: { left: 52, right: 18, top: 8, bottom: 28 },
    xAxis: {
      type: "category",
      data: years,
      axisLabel: { color: COLORS.text, fontSize: 10 },
      axisLine: { lineStyle: { color: COLORS.grid } },
    },
    yAxis: {
      type: "category",
      data: quarters,
      axisLabel: { color: COLORS.text, fontSize: 10 },
      axisLine: { lineStyle: { color: COLORS.grid } },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: COLORS.text },
      // Use stable explicit colors to avoid theme var parsing edge cases in ECharts.
      inRange: { color: buildDivergingScale("#ef4444", "#64748b", "#10b981") },
    },
    series: [
      {
        type: "heatmap",
        data: matrix.map((m) => ({
          value: m.value,
          itemStyle: m.__key === selectedKey ? { borderColor: COLORS.accent, borderWidth: 2 } : undefined,
          __key: m.__key,
        })),
        label: {
          show: true,
          color: "#e5e7eb",
          formatter: (p: {
            data?: { value?: [number, number, number] } | [number, number, number];
            value?: [number, number, number];
          }) => {
            const tuple = Array.isArray(p.value)
              ? p.value
              : Array.isArray(p.data)
                ? p.data
                : p.data?.value;
            if (!tuple || typeof tuple[2] !== "number") return "--";
            return safePct(tuple[2], 1);
          },
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.35)" } },
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      style={{ height: 220 }}
      onEvents={{
        click: (params: { data?: { __key?: string } }) => {
          const key = params?.data?.__key;
          if (key) onSelect(key);
        },
      }}
    />
  );
}

function earningsKey(
  e: { date?: string | null; fiscal_period_end?: string | null },
  idx: number,
): string {
  return `${e.date ?? "NA"}-${e.fiscal_period_end ?? "NA"}-${idx}`;
}
