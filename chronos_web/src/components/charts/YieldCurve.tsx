/**
 * YieldCurve - Treasury yield curve visualization
 * Shows current yield curve vs historical comparisons
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase, toRgba } from "@/lib/theme";
import { fmtNum } from "@/lib/format";

interface YieldPoint {
  tenor: string; // "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"
  yield: number;
}

interface Props {
  current: YieldPoint[];
  comparison1?: { data: YieldPoint[]; label: string };
  comparison2?: { data: YieldPoint[]; label: string };
  height?: number;
}

const TENOR_ORDER = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

export function YieldCurve({ current, comparison1, comparison2, height = 280 }: Props) {
  // Sort data by tenor order
  const sortByTenor = (data: YieldPoint[]) => {
    return [...data].sort((a, b) => {
      const idxA = TENOR_ORDER.indexOf(a.tenor);
      const idxB = TENOR_ORDER.indexOf(b.tenor);
      return idxA - idxB;
    });
  };

  const sortedCurrent = sortByTenor(current);
  const tenors = sortedCurrent.map((d) => d.tenor);

  const series: Array<{
    type: string;
    name: string;
    data: number[];
    smooth?: boolean;
    lineStyle?: { width: number; type?: string };
    symbol?: string;
    symbolSize?: number;
    itemStyle?: { color: string };
  }> = [
    {
      type: "line",
      name: "当前",
      data: sortedCurrent.map((d) => d.yield),
      smooth: true,
      lineStyle: { width: 2 },
      symbol: "circle",
      symbolSize: 6,
      itemStyle: { color: COLORS.accent },
    },
  ];

  if (comparison1) {
    series.push({
      type: "line",
      name: comparison1.label,
      data: sortByTenor(comparison1.data).map((d) => d.yield),
      smooth: true,
      lineStyle: { width: 2, type: "dashed" },
      symbol: "none",
      itemStyle: { color: COLORS.text2 },
    });
  }

  if (comparison2) {
    series.push({
      type: "line",
      name: comparison2.label,
      data: sortByTenor(comparison2.data).map((d) => d.yield),
      smooth: true,
      lineStyle: { width: 2, type: "dotted" },
      symbol: "none",
      itemStyle: { color: COLORS.text1 },
    });
  }

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; color: string }>) => {
        let html = `<b>${params[0]?.axisValue}</b><br/>`;
        params.forEach((p) => {
          html += `<span style="color:${p.color}">●</span> ${p.seriesName}: ${fmtNum(p.value, 2)}%<br/>`;
        });
        return html;
      },
    },
    legend: {
      ...echartsBase.legend,
      data: ["当前", comparison1?.label, comparison2?.label].filter(Boolean),
      top: 0,
    },
    grid: {
      left: 48,
      right: 24,
      top: 40,
      bottom: 40,
    },
    xAxis: {
      type: "category",
      data: tenors,
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
      },
    },
    yAxis: {
      type: "value",
      name: "收益率 (%)",
      nameTextStyle: { color: COLORS.text1, fontSize: 10 },
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series,
  };

  return <ReactECharts option={option} style={{ height }} />;
}

/**
 * YieldSpread - Shows yield spread (e.g., 10Y-2Y) over time
 */
interface SpreadPoint {
  date: string;
  spread: number;
}

interface YieldSpreadProps {
  data: SpreadPoint[];
  height?: number;
  recessionPeriods?: Array<{ start: string; end: string }>;
}

export function YieldSpread({ data, height = 180, recessionPeriods }: YieldSpreadProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-text-tertiary">
        暂无利差数据
      </div>
    );
  }

  const dates = data.map((d) => d.date);
  const values = data.map((d) => d.spread);

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      formatter: (params: Array<{ axisValue: string; value: number }>) => {
        const p = params[0];
        return `<b>${p.axisValue}</b><br/>利差: ${fmtNum(p.value, 2)}%`;
      },
    },
    grid: {
      left: 48,
      right: 24,
      top: 16,
      bottom: 32,
    },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        lineStyle: { width: 1.5, color: COLORS.accent },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: toRgba(COLORS.accent, 0.2) },
              { offset: 1, color: toRgba(COLORS.accent, 0.02) },
            ],
          },
        },
        symbol: "none",
        markLine: {
          silent: true,
          data: [
            {
              yAxis: 0,
              lineStyle: { color: COLORS.text2, type: "dashed" },
              label: { show: false },
            },
          ],
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height }} />;
}
