/**
 * CashFlowChart - Cash flow trends visualization
 * Shows operating, investing, and financing cash flows over time
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase, SERIES_PALETTE } from "@/lib/theme";
import { fmtCap, fmtDay } from "@/lib/format";

interface CashFlowData {
  date: string;
  operating: number;
  investing: number;
  financing: number;
  freeCashFlow?: number;
}

interface Props {
   CashFlowData[];
  title?: string;
  height?: number;
  showFreeCashFlow?: boolean;
}

export function CashFlowChart({
  data,
  title,
  height = 280,
  showFreeCashFlow = true,
}: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-text-tertiary">
        暂无现金流数据
      </div>
    );
  }

  const dates = data.map((d) => fmtDay(d.date));
  const operatingData = data.map((d) => d.operating);
  const investingData = data.map((d) => d.investing);
  const financingData = data.map((d) => d.financing);
  const fcfData = showFreeCashFlow ? data.map((d) => d.freeCashFlow ?? d.operating + d.investing) : [];

  const series: Array<{
    type: string;
    name: string;
     number[];
    stack?: string;
    smooth?: boolean;
    lineStyle?: { width: number; type?: string };
    areaStyle?: { opacity: number };
    itemStyle?: { color?: string };
    symbol?: string;
  }> = [
    {
      type: "bar",
      name: "经营活动",
       operatingData,
      stack: "cashflow",
      itemStyle: { color: COLORS.up },
    },
    {
      type: "bar",
      name: "投资活动",
       investingData,
      stack: "cashflow",
      itemStyle: { color: COLORS.down },
    },
    {
      type: "bar",
      name: "筹资活动",
       financingData,
      stack: "cashflow",
      itemStyle: { color: COLORS.accent },
    },
  ];

  if (showFreeCashFlow) {
    series.push({
      type: "line",
      name: "自由现金流",
       fcfData,
      smooth: true,
      lineStyle: { width: 2, type: "dashed" },
      itemStyle: { color: COLORS.accent2 },
      symbol: "circle",
    });
  }

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: Array<{ seriesName: string; value: number; color: string }>) => {
        let html = `<b>${params[0]?.axisValue}</b><br/>`;
        params.forEach((p) => {
          const value = p.value ?? 0;
          html += `<span style="color:${p.color}">●</span> ${p.seriesName}: ${fmtCap(value, 0)}<br/>`;
        });
        return html;
      },
    },
    legend: {
      ...echartsBase.legend,
       showFreeCashFlow
        ? ["经营活动", "投资活动", "筹资活动", "自由现金流"]
        : ["经营活动", "投资活动", "筹资活动"],
      top: 0,
    },
    grid: {
      left: 60,
      right: 24,
      top: 40,
      bottom: 40,
    },
    xAxis: {
      type: "category",
       dates,
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        rotate: data.length > 8 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        formatter: (v: number) => fmtCap(v, 0),
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
     series,
  };

  return (
    <div>
      {title && <div className="mb-2 text-xs font-medium text-text-secondary">{title}</div>}
      <ReactECharts option={option} style={{ height }} />
    </div>
  );
}

/**
 * CashFlowSummary - Compact cash flow summary cards
 */
interface CashFlowSummaryProps {
  latestOperating: number;
  latestInvesting: number;
  latestFinancing: number;
  previousOperating?: number;
}

export function CashFlowSummary({
  latestOperating,
  latestInvesting,
  latestFinancing,
  previousOperating,
}: CashFlowSummaryProps) {
  const fcf = latestOperating + latestInvesting;
  const operatingChange = previousOperating
    ? ((latestOperating - previousOperating) / Math.abs(previousOperating)) * 100
    : null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <CashFlowCard
        label="经营现金流"
        value={latestOperating}
        change={operatingChange}
        color="up"
      />
      <CashFlowCard label="投资现金流" value={latestInvesting} color="down" />
      <CashFlowCard label="筹资现金流" value={latestFinancing} color="accent" />
      <CashFlowCard label="自由现金流" value={fcf} color={fcf >= 0 ? "up" : "down"} />
    </div>
  );
}

function CashFlowCard({
  label,
  value,
  change,
  color,
}: {
  label: string;
  value: number;
  change?: number | null;
  color: "up" | "down" | "accent";
}) {
  const colorMap = {
    up: "text-up",
    down: "text-down",
    accent: "text-accent",
  };

  return (
    <div className="rounded-md border border-border-soft bg-bg-2/50 p-2 text-center">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${colorMap[color]}`}>{fmtCap(value, 0)}</div>
      {change !== null && change !== undefined && (
        <div className={`text-2xs ${change >= 0 ? "text-up" : "text-down"}`}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}%
        </div>
      )}
    </div>
  );
}
