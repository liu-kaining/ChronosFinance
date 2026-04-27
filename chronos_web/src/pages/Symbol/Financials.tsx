import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { StaticCategoriesResponse, StaticSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  type FinancialMetricKey,
  getFinancialMetric,
  periodTag,
  rowIdentity,
  toFinancialStatementRows,
  type FinancialStatementRow,
} from "@/lib/financial-adapters";
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

type StatementKind = "income" | "balance" | "cashflow";

type MetricDefinition = {
  key: FinancialMetricKey;
  label: string;
  digits?: number;
  formatter?: "cap" | "num";
};

const STATEMENT_METRICS: Record<StatementKind, MetricDefinition[]> = {
  income: [
    { key: "revenue", label: "营收" },
    { key: "grossProfit", label: "毛利润" },
    { key: "operatingIncome", label: "营业利润" },
    { key: "netIncome", label: "净利润" },
    { key: "eps", label: "EPS", digits: 2, formatter: "num" },
  ],
  balance: [
    { key: "cashAndEquivalents", label: "现金及等价物" },
    { key: "currentAssets", label: "流动资产" },
    { key: "totalAssets", label: "总资产" },
    { key: "currentLiabilities", label: "流动负债" },
    { key: "totalLiabilities", label: "总负债" },
    { key: "totalEquity", label: "股东权益" },
  ],
  cashflow: [
    { key: "operatingCashFlow", label: "经营现金流" },
    { key: "capitalExpenditure", label: "资本开支" },
    { key: "freeCashFlow", label: "自由现金流" },
    { key: "dividendsPaid", label: "股息支付" },
    { key: "netIncome", label: "净利润" },
  ],
};

const METRIC_COLUMN_MAP: Record<string, FinancialMetricKey> = Object.fromEntries(
  Object.values(STATEMENT_METRICS)
    .flat()
    .map((metric) => [metric.label, metric.key]),
) as Record<string, FinancialMetricKey>;

export function SymbolFinancials() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [selected, setSelected] = useState(CATEGORIES[0]!);

  const { data: categoriesData } = useQuery({
    queryKey: ["static-categories", sym],
    queryFn: () => api.get<StaticCategoriesResponse>(endpoints.staticCategories(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const period = selected.key.includes("_quarter") ? "quarter" : "annual";
  const category = selected.key;
  const statementKind = getStatementKind(category);
  const metrics = STATEMENT_METRICS[statementKind];

  const categoryRowsMap = useMemo(() => {
    const map = new Map<string, number>();
    (categoriesData?.categories ?? []).forEach((c) => {
      map.set(c.data_category, c.rows ?? 0);
    });
    return map;
  }, [categoriesData?.categories]);

  const enrichedCategories = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const rows = categoryRowsMap.get(c.key) ?? 0;
        return { ...c, rows, available: rows > 0 };
      }),
    [categoryRowsMap],
  );

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

  const rows = useMemo(() => toFinancialStatementRows(data?.items ?? []), [data?.items]);
  const [selectedRowKey, setSelectedRowKey] = useState<string>("");
  const [focusedMetric, setFocusedMetric] = useState<FinancialMetricKey | "">("");

  useEffect(() => {
    setSelectedRowKey(rowKey(rows[0]));
    setFocusedMetric("");
  }, [category, period, sym, rows.length]);

  useEffect(() => {
    if (!selected) return;
    const selectedRows = categoryRowsMap.get(selected.key) ?? 0;
    if (selectedRows > 0) return;
    const fallback = CATEGORIES.find((c) => (categoryRowsMap.get(c.key) ?? 0) > 0);
    if (fallback) setSelected(fallback);
  }, [categoryRowsMap, selected]);

  const selectedRow = useMemo(() => {
    if (!rows.length) return undefined;
    return rows.find((r) => rowKey(r) === selectedRowKey) ?? rows[0];
  }, [rows, selectedRowKey]);

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="财务叙事"
        description={financialNarrative(statementKind, selected.label)}
      />
      {/* Category selector */}
      <div className="flex flex-wrap gap-2">
        {enrichedCategories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => c.available && setSelected(c)}
            disabled={!c.available}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              selected.key === c.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-soft bg-bg-2 text-text-secondary hover:bg-bg-3",
              !c.available ? "cursor-not-allowed opacity-50 hover:bg-bg-2" : "",
            )}
            title={c.available ? `${c.label}（${c.rows} 行）` : `${c.label}（暂无数据）`}
          >
            {c.label}
            <span className="ml-1 text-2xs text-text-tertiary">({c.rows})</span>
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
            {metrics.slice(0, 4).map((metric) => (
              <MetricCard
                key={metric.key}
                label={metric.label}
                value={extractValue(selectedRow, metric.key)}
                digits={metric.digits}
                formatter={metric.formatter}
                active={focusedMetric === metric.key}
                onClick={() => setFocusedMetric(metric.key)}
              />
            ))}
          </div>

          <FinancialQualitySummary rows={rows} statementKind={statementKind} />

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
          <StatementChart
            kind={statementKind}
            row={selectedRow}
            rows={rows}
            metrics={metrics}
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
                  {metrics.map((metric) => (
                    <th key={metric.key} className="px-2 py-1.5 text-right">
                      {metric.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={rowKey(r)}
                    className={cn(
                      "border-b border-border-soft/50",
                      i % 2 === 0 ? "bg-bg-2/30" : "",
                      rowKey(r) === rowKey(selectedRow) ? "bg-accent/5" : "",
                    )}
                    onClick={() => setSelectedRowKey(rowKey(r))}
                  >
                    <td className="px-2 py-1.5 font-mono text-text-primary">
                      {r.fiscalYear ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {r.fiscalQuarter ?? "—"}
                    </td>
                    {metrics.map((metric) => (
                      <td
                        key={metric.key}
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-text-secondary",
                          focusedMetric === metric.key ? "bg-accent/10 text-text-primary" : "",
                        )}
                      >
                        {formatMetricValue(extractValue(r, metric.key), metric)}
                      </td>
                    ))}
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

function extractValue(row: FinancialStatementRow | undefined, field: FinancialMetricKey): number | null {
  return getFinancialMetric(row, field);
}

function MetricCard({
  label,
  value,
  digits = 0,
  formatter = "cap",
  active = false,
  onClick,
}: {
  label: string;
  value: number | null;
  digits?: number;
  formatter?: "cap" | "num";
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
        {formatMetricValue(value, { digits, formatter })}
      </div>
    </button>
  );
}

function FinancialQualitySummary({
  rows,
  statementKind,
}: {
  rows: FinancialStatementRow[];
  statementKind: StatementKind;
}) {
  const latest = rows[0];
  const previous = rows[1];
  const revenueGrowth = growth(extractValue(latest, "revenue"), extractValue(previous, "revenue"));
  const netMargin = ratio(extractValue(latest, "netIncome"), extractValue(latest, "revenue"));
  const debtToAssets = ratio(extractValue(latest, "totalLiabilities"), extractValue(latest, "totalAssets"));
  const fcfQuality = ratio(extractValue(latest, "freeCashFlow"), extractValue(latest, "netIncome"));

  const items = [
    {
      label: "增长",
      value: revenueGrowth == null ? "—" : `${revenueGrowth >= 0 ? "+" : ""}${(revenueGrowth * 100).toFixed(1)}%`,
      hint: previous ? "相邻期间营收变化" : "需要至少两个期间",
    },
    {
      label: "利润率",
      value: netMargin == null ? "—" : `${(netMargin * 100).toFixed(1)}%`,
      hint: "净利润 / 营收",
    },
    {
      label: "杠杆",
      value: debtToAssets == null ? "—" : `${(debtToAssets * 100).toFixed(1)}%`,
      hint: "总负债 / 总资产",
    },
    {
      label: "现金流质量",
      value: fcfQuality == null ? "—" : `${(fcfQuality * 100).toFixed(1)}%`,
      hint: "自由现金流 / 净利润",
    },
  ];

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            财务质量摘要
          </div>
          <div className="text-2xs text-text-tertiary">
            {statementKind === "income"
              ? "当前利润表视角，重点看增长与利润转化。"
              : statementKind === "balance"
                ? "当前资产负债表视角，重点看杠杆与资产结构。"
                : "当前现金流视角，重点看利润是否转成现金。"}
          </div>
        </div>
        <Link to="../raw" relative="path" className="chip">
          原始数据
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border-soft bg-bg-2/40 p-2">
            <div className="text-2xs text-text-tertiary">{item.label}</div>
            <div className="mt-1 font-mono text-base text-text-primary">{item.value}</div>
            <div className="mt-1 text-2xs text-text-tertiary">{item.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementChart({
  kind,
  row,
  rows,
  metrics,
  onMetricClick,
}: {
  kind: StatementKind;
  row?: FinancialStatementRow;
  rows: FinancialStatementRow[];
  metrics: MetricDefinition[];
  onMetricClick?: (metricName: string) => void;
}) {
  if (!row?.rawPayload) return null;
  if (kind !== "income") {
    return <MetricTrendChart rows={rows} metrics={metrics.slice(0, 4)} onMetricClick={onMetricClick} />;
  }

  const revenue = extractValue(row, "revenue") ?? 0;
  const cogs = extractValue(row, "costOfRevenue") ?? 0;
  const grossProfit = extractValue(row, "grossProfit") ?? 0;
  const opExpenses = extractValue(row, "operatingExpenses") ?? 0;
  const opIncome = extractValue(row, "operatingIncome") ?? 0;
  const netIncome = extractValue(row, "netIncome") ?? 0;

  // Waterfall data: [name, value, isTotal]
  const waterfallData: [string, number, boolean?][] = [
    ["营收", revenue],
    ["营业成本", -cogs],
    ["毛利润", grossProfit, true],
    ["运营费用", -opExpenses],
    ["营业利润", opIncome, true],
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
        data: waterfallData.map(([, v, isTotal]) => ({
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

function MetricTrendChart({
  rows,
  metrics,
  onMetricClick,
}: {
  rows: FinancialStatementRow[];
  metrics: MetricDefinition[];
  onMetricClick?: (metricName: string) => void;
}) {
  const orderedRows = [...rows].reverse();
  const option = {
    ...echartsBase,
    title: {
      text: "关键指标趋势",
      textStyle: { color: COLORS.text1, fontSize: 13 },
      left: 8,
      top: 4,
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number | null }>) =>
        params.map((p) => `${p.seriesName}: ${fmtCap(p.value)}`).join("<br/>"),
    },
    legend: {
      data: metrics.map((m) => m.label),
      textStyle: { color: COLORS.text2, fontSize: 10 },
      top: 4,
      right: 8,
    },
    grid: { left: 80, right: 24, top: 54, bottom: 36 },
    xAxis: {
      type: "category",
      data: orderedRows.map(periodTag),
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: COLORS.text1, formatter: (v: number) => fmtCap(v, 0) },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: metrics.map((metric) => ({
      name: metric.label,
      type: "bar",
      data: orderedRows.map((r) => extractValue(r, metric.key)),
      emphasis: { focus: "series" },
    })),
  };

  return (
    <div className="card p-2">
      <ReactECharts
        option={option}
        style={{ height: 300 }}
        onEvents={{
          click: (params: { seriesName?: string }) => {
            if (params?.seriesName) onMetricClick?.(params.seriesName);
          },
        }}
      />
    </div>
  );
}

function getStatementKind(category: string): StatementKind {
  if (category.includes("balance_sheet")) return "balance";
  if (category.includes("cash_flow")) return "cashflow";
  return "income";
}

function financialNarrative(kind: StatementKind, label: string): string {
  if (kind === "balance") {
    return `${label} 用来判断资产结构、负债压力和权益缓冲，不能再用利润表字段硬套。`;
  }
  if (kind === "cashflow") {
    return `${label} 用来判断利润是否变成现金，重点看经营现金流、资本开支和自由现金流。`;
  }
  return `${label} 用同一期间看收入、毛利、营业利润、净利润和 EPS，判断增长质量是否可持续。`;
}

function formatMetricValue(value: number | null, metric: Pick<MetricDefinition, "digits" | "formatter">): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (metric.formatter === "num") return fmtNum(value, metric.digits ?? 2);
  return fmtCap(value, metric.digits ?? 2);
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function growth(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function rowKey(row: FinancialStatementRow | undefined): string {
  return rowIdentity(row);
}

function formatPeriodTag(row: FinancialStatementRow | undefined): string {
  return periodTag(row);
}
