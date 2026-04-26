import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { StaticSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

const CATEGORIES = [
  { key: "income_statement_annual", label: "利润表（年）" },
  { key: "income_statement_quarter", label: "利润表（季）" },
  { key: "balance_sheet_annual", label: "资产负债表（年）" },
  { key: "balance_sheet_quarter", label: "资产负债表（季）" },
  { key: "cash_flow_annual", label: "现金流量表（年）" },
  { key: "cash_flow_quarter", label: "现金流量表（季）" },
];

type FinancialRow = {
  fiscal_year: number | null;
  fiscal_quarter: number | null;
  raw_payload: Record<string, unknown>;
};

const METRIC_COLUMN_MAP: Record<string, keyof MetricValues> = {
  营收: "revenue",
  毛利润: "grossProfit",
  营业利润: "operatingIncome",
  净利润: "netIncome",
  每股收益: "eps",
};

type MetricValues = {
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
};

export function SymbolFinancials() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [selected, setSelected] = useState(CATEGORIES[0]!);

  const period = selected.key.includes("_quarter") ? "quarter" : "annual";
  const category = selected.key;

  const { data, isLoading } = useQuery({
    queryKey: ["static", sym, category, period],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category, period, limit: 8 },
      }),
    enabled: !!sym && !!category,
    staleTime: 5 * 60_000,
    refetchOnMount: "always",
  });

  const rows = (data?.items ?? []) as FinancialRow[];
  const [selectedRowKey, setSelectedRowKey] = useState<string>("");
  const [focusedMetric, setFocusedMetric] = useState<keyof MetricValues | "">("");

  useEffect(() => {
    setSelectedRowKey(rowKey(rows[0]));
    setFocusedMetric("");
  }, [category, period, sym, rows.length]);

  const selectedRow = useMemo(() => {
    if (!rows.length) return undefined;
    return rows.find((r) => rowKey(r) === selectedRowKey) ?? rows[0];
  }, [rows, selectedRowKey]);

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="财务叙事"
        description="用同一期间看收入-利润-现金流，判断增长质量是否可持续，而不是只看单个 EPS。"
      />
      {/* Category selector */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setSelected(c)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              selected.key === c.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-soft bg-bg-2 text-text-secondary hover:bg-bg-3",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card flex h-[400px] items-center justify-center">
          <div className="text-sm text-text-tertiary">加载财务数据中…</div>
        </div>
      ) : !rows.length ? (
        <div className="card p-4">
          <EmptyDataState
            title="该财务分类暂无数据"
            detail="可切换到其它财务分类，或去原始数据页核对接口返回。"
            actions={
              <>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setSelected(CATEGORIES[0]!)}
                >
                  切回利润表（年）
                </button>
                <Link to={`/symbol/${sym}/raw`} className="chip">
                  查看原始 JSON
                </Link>
              </>
            }
          />
        </div>
      ) : (
        <>
          {/* Key metrics cards */}
          <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <MetricCard
              label="营收"
              value={extractValue(selectedRow, "revenue")}
              active={focusedMetric === "revenue"}
              onClick={() => setFocusedMetric("revenue")}
            />
            <MetricCard
              label="净利润"
              value={extractValue(selectedRow, "netIncome")}
              active={focusedMetric === "netIncome"}
              onClick={() => setFocusedMetric("netIncome")}
            />
            <MetricCard
              label="每股收益"
              value={extractValue(selectedRow, "eps")}
              digits={2}
              active={focusedMetric === "eps"}
              onClick={() => setFocusedMetric("eps")}
            />
            <MetricCard
              label="营业利润"
              value={extractValue(selectedRow, "operatingIncome")}
              active={focusedMetric === "operatingIncome"}
              onClick={() => setFocusedMetric("operatingIncome")}
            />
          </div>

          <div className="card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-2xs text-text-tertiary">
                当前分析期间：{formatPeriodTag(selectedRow)}
              </div>
              <div className="flex flex-wrap gap-1">
                {rows.map((r) => {
                  const key = rowKey(r);
                  const isActive = key === rowKey(selectedRow);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedRowKey(key)}
                      className={cn(
                        "rounded border px-2 py-0.5 text-2xs",
                        isActive
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-border-soft text-text-tertiary hover:bg-bg-2",
                      )}
                      title="点击切换图表/指标到该期"
                    >
                      {formatPeriodTag(r)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="text-2xs text-text-tertiary">点击图中指标可高亮下方表格对应列。</div>
          </div>

          {/* Waterfall chart for selected period */}
          <RevenueWaterfall
            row={selectedRow}
            onMetricClick={(metricName) => {
              const key = METRIC_COLUMN_MAP[metricName];
              if (key) setFocusedMetric(key);
            }}
          />

          {/* Time series table */}
          <div className="card overflow-auto p-2">
            <table className="table-modern">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">财年</th>
                  <th className="px-2 py-1.5">Q</th>
                  <th className="px-2 py-1.5 text-right">营收</th>
                  <th className="px-2 py-1.5 text-right">毛利</th>
                  <th className="px-2 py-1.5 text-right">营业利润</th>
                  <th className="px-2 py-1.5 text-right">净利润</th>
                  <th className="px-2 py-1.5 text-right">EPS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.fiscal_year}-${r.fiscal_quarter}`}
                    className={cn(
                      "border-b border-border-soft/50",
                      i % 2 === 0 ? "bg-bg-2/30" : "",
                      rowKey(r) === rowKey(selectedRow) ? "bg-accent/5" : "",
                    )}
                    onClick={() => setSelectedRowKey(rowKey(r))}
                  >
                    <td className="px-2 py-1.5 font-mono text-text-primary">
                      {r.fiscal_year ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {r.fiscal_quarter ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-text-secondary",
                        focusedMetric === "revenue" ? "bg-accent/10 text-text-primary" : "",
                      )}
                    >
                      {fmtCap(extractValue(r, "revenue"))}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-text-secondary",
                        focusedMetric === "grossProfit" ? "bg-accent/10 text-text-primary" : "",
                      )}
                    >
                      {fmtCap(extractValue(r, "grossProfit"))}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-text-secondary",
                        focusedMetric === "operatingIncome" ? "bg-accent/10 text-text-primary" : "",
                      )}
                    >
                      {fmtCap(extractValue(r, "operatingIncome"))}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-text-secondary",
                        focusedMetric === "netIncome" ? "bg-accent/10 text-text-primary" : "",
                      )}
                    >
                      {fmtCap(extractValue(r, "netIncome"))}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-mono text-text-secondary",
                        focusedMetric === "eps" ? "bg-accent/10 text-text-primary" : "",
                      )}
                    >
                      {fmtNum(extractValue(r, "eps"), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function extractValue(row: FinancialRow | undefined, field: string): number | null {
  if (!row?.raw_payload) return null;
  const v = (row.raw_payload as Record<string, unknown>)[field];
  if (typeof v === "number") return v;
  return null;
}

function MetricCard({
  label,
  value,
  digits = 0,
  active = false,
  onClick,
}: {
  label: string;
  value: number | null;
  digits?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-md px-1 py-1 text-left transition-colors",
        active ? "bg-accent/10" : "hover:bg-bg-2",
      )}
    >
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="kpi-num">
        {value === null ? "—" : digits === 0 ? fmtCap(value) : fmtNum(value, digits)}
      </div>
    </button>
  );
}

function RevenueWaterfall({
  row,
  onMetricClick,
}: {
  row?: FinancialRow;
  onMetricClick?: (metricName: string) => void;
}) {
  if (!row?.raw_payload) return null;

  const payload = row.raw_payload as Record<string, unknown>;
  const revenue = typeof payload.revenue === "number" ? payload.revenue : 0;
  const cogs = typeof payload.costOfGoodsSold === "number" ? payload.costOfGoodsSold : 0;
  const grossProfit = typeof payload.grossProfit === "number" ? payload.grossProfit : 0;
  const opExpenses =
    typeof payload.operatingExpenses === "number" ? payload.operatingExpenses : 0;
  const opIncome =
    typeof payload.operatingIncome === "number" ? payload.operatingIncome : 0;
  const interestExp =
    typeof payload.interestExpense === "number" ? payload.interestExpense : 0;
  const taxExp = typeof payload.incomeTaxExpense === "number" ? payload.incomeTaxExpense : 0;
  const netIncome = typeof payload.netIncome === "number" ? payload.netIncome : 0;

  // Waterfall data: [name, value, isTotal]
  const waterfallData: [string, number, boolean?][] = [
    ["营收", revenue],
    ["营业成本", -cogs],
    ["毛利润", grossProfit, true],
    ["运营费用", -opExpenses],
    ["营业利润", opIncome, true],
    ["利息", -Math.abs(interestExp)],
    ["税费", -Math.abs(taxExp)],
    ["净利润", netIncome, true],
  ];

  // Build echarts waterfall
  const xData = waterfallData.map((d) => d[0]);
  const yData: number[] = [];
  let base = 0;
  for (const [, v, isTotal] of waterfallData) {
    if (isTotal) {
      yData.push(v);
      base = v;
    } else {
      yData.push(v);
      base += v;
    }
  }

  const option = {
    ...echartsBase,
    title: {
      text: "利润表瀑布图",
      textStyle: { color: COLORS.text1, fontSize: 13 },
      left: 8,
      top: 4,
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0];
        if (!p) return "";
        const v = p.value;
        return `<b>${p.name}</b><br/>${fmtCap(v)}`;
      },
    },
    grid: { left: 80, right: 24, top: 48, bottom: 36 },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: {
        color: COLORS.text1,
        formatter: (v: number) => fmtCap(v, 0),
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: waterfallData.map(([name, v, isTotal], i) => ({
          value: v,
          itemStyle: {
            color: isTotal
              ? COLORS.accent
              : v >= 0
                ? COLORS.up
                : COLORS.down,
          },
        })),
        barWidth: "60%",
      },
    ],
  };

  return (
    <div className="card p-2">
      <ReactECharts
        option={option}
        style={{ height: 280 }}
        onEvents={{
          click: (params: { name?: string }) => {
            if (params?.name) onMetricClick?.(params.name);
          },
        }}
      />
    </div>
  );
}

function rowKey(row: FinancialRow | undefined): string {
  if (!row) return "";
  return `${row.fiscal_year ?? "NA"}-${row.fiscal_quarter ?? "NA"}`;
}

function formatPeriodTag(row: FinancialRow | undefined): string {
  if (!row) return "—";
  return row.fiscal_quarter ? `${row.fiscal_year ?? "—"}Q${row.fiscal_quarter}` : `${row.fiscal_year ?? "—"}年`;
}
