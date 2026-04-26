/**
 * PeBand - PE valuation band chart
 * Shows PE ratio over time with percentile bands (10th, 25th, 50th, 75th, 90th)
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase } from "@/lib/theme";
import { fmtNum, fmtDay } from "@/lib/format";

interface PeDataPoint {
  date: string;
  pe: number | null;
  price?: number | null;
}

interface PeBandData {
  date: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  actual?: number | null;
}

interface Props {
  data: PeDataPoint[];
  title?: string;
  height?: number;
  showPrice?: boolean;
}

export function PeBand({ data, title, height = 280, showPrice = false }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-text-tertiary">
        暂无PE数据
      </div>
    );
  }

  // Calculate percentile bands if not provided
  const validPe = data.filter((d) => d.pe != null).map((d) => d.pe!);
  const sortedPe = [...validPe].sort((a, b) => a - b);

  const p10 = sortedPe[Math.floor(sortedPe.length * 0.1)] ?? sortedPe[0];
  const p25 = sortedPe[Math.floor(sortedPe.length * 0.25)] ?? sortedPe[0];
  const p50 = sortedPe[Math.floor(sortedPe.length * 0.5)] ?? sortedPe[0];
  const p75 = sortedPe[Math.floor(sortedPe.length * 0.75)] ?? sortedPe[sortedPe.length - 1];
  const p90 = sortedPe[Math.floor(sortedPe.length * 0.9)] ?? sortedPe[sortedPe.length - 1];

  const latestPe = data[data.length - 1]?.pe;
  const currentPercentile = latestPe
    ? (sortedPe.filter((pe) => pe <= latestPe).length / sortedPe.length) * 100
    : null;

  const dates = data.map((d) => fmtDay(d.date));

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; color: string }>) => {
        let html = `<b>${params[0]?.axisValue}</b><br/>`;
        params.forEach((p) => {
          if (p.value != null) {
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: ${fmtNum(p.value, 1)}x<br/>`;
          }
        });
        return html;
      },
    },
    legend: {
      ...echartsBase.legend,
      data: showPrice ? ["PE", "股价", "P90", "P75", "P50", "P25", "P10"] : ["PE", "P90", "P75", "P50", "P25", "P10"],
      top: 0,
      textStyle: { fontSize: 10 },
    },
    grid: {
      left: 48,
      right: showPrice ? 48 : 24,
      top: 40,
      bottom: 40,
    },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        rotate: data.length > 12 ? 30 : 0,
      },
    },
    yAxis: [
      {
        type: "value",
        name: "PE",
        nameTextStyle: { color: COLORS.text1, fontSize: 10 },
        axisLabel: {
          color: COLORS.text1,
          fontSize: 10,
          formatter: (v: number) => `${v}x`,
        },
        splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
      },
      showPrice && {
        type: "value",
        name: "股价",
        nameTextStyle: { color: COLORS.text1, fontSize: 10 },
        axisLabel: {
          color: COLORS.text1,
          fontSize: 10,
          formatter: (v: number) => `$${v}`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      // Percentile bands (filled areas)
      {
        type: "line",
        name: "P90",
        data: Array(data.length).fill(p90),
        smooth: true,
        lineStyle: { width: 0 },
        areaStyle: { color: `rgba(41,98,255,0.05)` },
        symbol: "none",
        silent: true,
      },
      {
        type: "line",
        name: "P75",
        data: Array(data.length).fill(p75),
        smooth: true,
        lineStyle: { width: 0 },
        areaStyle: { color: `rgba(41,98,255,0.1)` },
        symbol: "none",
        silent: true,
      },
      {
        type: "line",
        name: "P50",
        data: Array(data.length).fill(p50),
        smooth: true,
        lineStyle: { width: 1, color: COLORS.text2, type: "dashed" },
        symbol: "none",
        silent: true,
      },
      {
        type: "line",
        name: "P25",
        data: Array(data.length).fill(p25),
        smooth: true,
        lineStyle: { width: 0 },
        symbol: "none",
        silent: true,
      },
      {
        type: "line",
        name: "P10",
        data: Array(data.length).fill(p10),
        smooth: true,
        lineStyle: { width: 0 },
        areaStyle: { color: "transparent" },
        symbol: "none",
        silent: true,
      },
      // Actual PE line
      {
        type: "line",
        name: "PE",
        data: data.map((d) => d.pe),
        smooth: true,
        lineStyle: { width: 2, color: COLORS.accent },
        itemStyle: { color: COLORS.accent },
        symbol: "circle",
        symbolSize: 4,
      },
      // Price line (optional)
      showPrice && {
        type: "line",
        name: "股价",
        yAxisIndex: 1,
        data: data.map((d) => d.price),
        smooth: true,
        lineStyle: { width: 2, color: COLORS.accent2, type: "dashed" },
        itemStyle: { color: COLORS.accent2 },
        symbol: "none",
      },
    ].filter(Boolean),
  };

  return (
    <div>
      {title && <div className="mb-2 text-xs font-medium text-text-secondary">{title}</div>}
      <ReactECharts option={option} style={{ height }} />
      {currentPercentile !== null && (
        <div className="mt-2 flex items-center justify-between text-2xs">
          <span className="text-text-tertiary">
            当前PE: <span className="font-mono text-text-primary">{fmtNum(latestPe, 1)}x</span>
          </span>
          <span className="text-text-tertiary">
            历史分位: <span className={currentPercentile < 30 ? "text-up" : currentPercentile > 70 ? "text-down" : "text-text-primary"}>
              {currentPercentile.toFixed(0)}%
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * PeComparison - Cross-sectional PE comparison bar chart
 */
interface PeComparisonItem {
  name: string;
  pe: number | null;
  isCurrent?: boolean;
}

interface PeComparisonProps {
  items: PeComparisonItem[];
  title?: string;
  height?: number;
}

export function PeComparison({ items, title, height = 200 }: PeComparisonProps) {
  const validItems = items.filter((i) => i.pe != null);

  if (validItems.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-text-tertiary">
        暂无PE比较数据
      </div>
    );
  }

  const sorted = [...validItems].sort((a, b) => (b.pe ?? 0) - (a.pe ?? 0));

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ name: string; value: number }>) => {
        const p = params[0];
        return `<b>${p.name}</b><br/>PE: ${fmtNum(p.value, 1)}x`;
      },
    },
    grid: {
      left: 80,
      right: 24,
      top: 16,
      bottom: 24,
    },
    xAxis: {
      type: "value",
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        formatter: (v: number) => `${v}x`,
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((d) => d.name),
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
      },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((d) => ({
          value: d.pe,
          itemStyle: {
            color: d.isCurrent ? COLORS.accent : COLORS.bg3,
          },
        })),
        label: {
          show: true,
          position: "right",
          formatter: (p: { value: number }) => `${fmtNum(p.value, 1)}x`,
          fontSize: 9,
          color: COLORS.text0,
        },
      },
    ],
  };

  return (
    <div>
      {title && <div className="mb-2 text-xs font-medium text-text-secondary">{title}</div>}
      <ReactECharts option={option} style={{ height }} />
    </div>
  );
}
