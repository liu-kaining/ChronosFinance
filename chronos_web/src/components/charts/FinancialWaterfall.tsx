/**
 * FinancialWaterfall - Income statement waterfall chart
 * Visualizes revenue → gross profit → operating income → net income
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase } from "@/lib/theme";
import { fmtCap } from "@/lib/format";

interface WaterfallItem {
  name: string;
  value: number;
  isSubtotal?: boolean;
}

interface Props {
   WaterfallItem[];
  title?: string;
  height?: number;
}

export function FinancialWaterfall({ data, title, height = 300 }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-text-tertiary">
        暂无财务数据
      </div>
    );
  }

  // Calculate cumulative values for waterfall effect
  let cumulative = 0;
  const plotData = data.map((item) => {
    if (item.isSubtotal) {
      const value = item.value;
      const result = { name: item.name, value: [cumulative, cumulative + value] };
      cumulative += value;
      return result;
    } else {
      const value = item.value;
      const result = { name: item.name, value: [cumulative, cumulative + value] };
      cumulative += value;
      return result;
    }
  });

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ name: string; value: [number, number] }>) => {
        const p = params[0];
        const value = p.value[1] - p.value[0];
        return `<b>${p.name}</b><br/>${fmtCap(value, 0)}`;
      },
    },
    grid: {
      left: 80,
      right: 24,
      top: 40,
      bottom: 60,
    },
    xAxis: {
      type: "category",
       data.map((d) => d.name),
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: {
        color: COLORS.text1,
        fontSize: 10,
        rotate: 30,
        interval: 0,
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
    series: [
      {
        type: "bar",
        stack: "Total",
        itemStyle: {
          borderColor: "transparent",
          color: "transparent",
        },
        emphasis: {
          itemStyle: {
            borderColor: "transparent",
            color: "transparent",
          },
        },
         plotData.map((d) => d.value[0]),
      },
      {
        type: "bar",
        stack: "Total",
         plotData.map((d, i) => {
          const value = d.value[1] - d.value[0];
          return {
            value: value,
            itemStyle: {
              color:
                value >= 0
                  ? data[i].isSubtotal
                    ? COLORS.accent
                    : COLORS.up
                  : COLORS.down,
            },
          };
        }),
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => fmtCap(p.value, 0),
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

/**
 * SimpleWaterfall - Simplified version with predefined steps
 */
interface SimpleWaterfallProps {
  revenue: number;
  costOfRevenue: number;
  operatingExpenses: number;
  tax: number;
  netIncome: number;
  height?: number;
}

export function SimpleWaterfall({
  revenue,
  costOfRevenue,
  operatingExpenses,
  tax,
  netIncome,
  height = 280,
}: SimpleWaterfallProps) {
  const waterfallData: WaterfallItem[] = [
    { name: "营业收入", value: revenue, isSubtotal: true },
    { name: "营业成本", value: -costOfRevenue },
    { name: "毛利润", value: revenue - costOfRevenue, isSubtotal: true },
    { name: "运营费用", value: -operatingExpenses },
    { name: "营业利润", value: revenue - costOfRevenue - operatingExpenses, isSubtotal: true },
    { name: "税费", value: -tax },
    { name: "净利润", value: netIncome, isSubtotal: true },
  ];

  return <FinancialWaterfall data={waterfallData} title="利润表瀑布" height={height} />;
}
