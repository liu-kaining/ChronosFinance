/**
 * HeatmapMatrix - Sector × Time Period Performance Matrix
 * Displays sector performance across different time periods (1D/1W/1M/3M/1Y)
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase } from "@/lib/theme";
import { fmtPctSigned } from "@/lib/format";

interface HeatmapData {
  sector: string;
  periods: {
    d1: number | null;
    w1: number | null;
    m1: number | null;
    m3: number | null;
    y1: number | null;
  };
}

interface Props {
   HeatmapData[];
  onSectorClick?: (sector: string) => void;
}

const PERIOD_LABELS: Record<string, string> = {
  d1: "1D",
  w1: "1W",
  m1: "1M",
  m3: "3M",
  y1: "1Y",
};

export function HeatmapMatrix({ data, onSectorClick }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-text-tertiary">
        暂无板块数据
      </div>
    );
  }

  const periods = ["d1", "w1", "m1", "m3", "y1"];
  const sectors = data.map((d) => d.sector);

  // Build heatmap data [xIndex, yIndex, value]
  const heatmapData: [number, number, number][] = [];
  data.forEach((row, yIndex) => {
    periods.forEach((period, xIndex) => {
      const value = row.periods[period as keyof typeof row.periods];
      if (value !== null) {
        heatmapData.push([xIndex, yIndex, value]);
      }
    });
  });

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      position: "top",
      formatter: (params: {  [number, number, number] }) => {
        const [xIndex, yIndex, value] = params.data;
        const sector = sectors[yIndex];
        const period = periods[xIndex];
        return `<b>${sector}</b><br/>${PERIOD_LABELS[period]}: ${fmtPctSigned(value, 2)}`;
      },
    },
    grid: {
      left: 120,
      right: 40,
      top: 20,
      bottom: 40,
    },
    xAxis: {
      type: "category",
       periods.map((p) => PERIOD_LABELS[p]),
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 11 },
      splitArea: { show: true, areaStyle: { color: ["transparent", "rgba(255,255,255,0.02)"] } },
    },
    yAxis: {
      type: "category",
       sectors,
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 11, width: 110, overflow: "truncate" },
      splitArea: { show: true, areaStyle: { color: ["transparent", "rgba(255,255,255,0.02)"] } },
    },
    visualMap: {
      min: -10,
      max: 10,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 12,
      itemHeight: 100,
      text: ["+", "-"],
      textStyle: { color: COLORS.text1, fontSize: 10 },
      inRange: {
        color: [COLORS.down, "#1e222d", COLORS.up],
      },
    },
    series: [
      {
        type: "heatmap",
         heatmapData,
        label: {
          show: true,
          formatter: (params: { data: [number, number, number] }) => {
            const value = params.data[2];
            return fmtPctSigned(value, 0);
          },
          fontSize: 10,
          color: COLORS.text0,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: Math.max(300, data.length * 32 + 80) }}
      onEvents={{
        click: (params: {  [number, number, number] }) => {
          const yIndex = params.data[1];
          const sector = sectors[yIndex];
          if (sector && onSectorClick) {
            onSectorClick(sector);
          }
        },
      }}
    />
  );
}
