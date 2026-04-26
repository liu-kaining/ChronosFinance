/**
 * BalanceTree - Balance sheet structure treemap
 * Visualizes assets vs liabilities breakdown
 */

import ReactECharts from "echarts-for-react";
import { COLORS, echartsBase } from "@/lib/theme";
import { fmtCap } from "@/lib/format";

interface BalanceItem {
  name: string;
  value: number;
  children?: BalanceItem[];
}

interface Props {
  assets: BalanceItem[];
  liabilities: BalanceItem[];
  equity: number;
  title?: string;
  height?: number;
}

export function BalanceTree({
  assets,
  liabilities,
  equity,
  title,
  height = 300,
}: Props) {
  const totalAssets = assets.reduce((sum, item) => sum + item.value, 0);
  const totalLiabilities = liabilities.reduce((sum, item) => sum + item.value, 0);

  const treeData = [
    {
      name: "总资产",
      value: totalAssets,
      itemStyle: { color: COLORS.up },
      children: assets.map((item) => ({
        name: item.name,
        value: item.value,
        itemStyle: { color: COLORS.upSoft },
      })),
    },
    {
      name: "总负债",
      value: totalLiabilities,
      itemStyle: { color: COLORS.down },
      children: liabilities.map((item) => ({
        name: item.name,
        value: item.value,
        itemStyle: { color: "rgba(239,83,80,0.3)" },
      })),
    },
    {
      name: "股东权益",
      value: equity,
      itemStyle: { color: COLORS.accent },
    },
  ];

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      formatter: (params: { name: string; value: number; treePathInfo: Array<{ value: number }> }) => {
        const pct = params.treePathInfo[0]?.value
          ? ((params.value / params.treePathInfo[0].value) * 100).toFixed(1)
          : "0";
        return `<b>${params.name}</b><br/>金额：${fmtCap(params.value, 0)}<br/>占比：${pct}%`;
      },
    },
    series: [
      {
        type: "treemap",
         treeData,
        width: "100%",
        height: "100%",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: (p: { name: string; value: number }) => `${p.name}\n${fmtCap(p.value, 0)}`,
          fontSize: 11,
          color: COLORS.text0,
        },
        itemStyle: {
          borderColor: COLORS.border,
          borderWidth: 1,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              borderColor: COLORS.border,
              borderWidth: 2,
              gapWidth: 2,
            },
          },
          {
            itemStyle: {
              borderColor: COLORS.border,
              borderWidth: 1,
              gapWidth: 1,
            },
          },
        ],
      },
    ],
  };

  return (
    <div>
      {title && <div className="mb-2 text-xs font-medium text-text-secondary">{title}</div>}
      <ReactECharts option={option} style={{ height }} />
      <div className="mt-2 flex justify-between text-2xs text-text-tertiary">
        <span>总资产: {fmtCap(totalAssets, 0)}</span>
        <span>负债率: {((totalLiabilities / totalAssets) * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

/**
 * SimpleBalance - Simplified balance sheet with standard categories
 */
interface SimpleBalanceProps {
  currentAssets: number;
  nonCurrentAssets: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  equity: number;
  height?: number;
}

export function SimpleBalance({
  currentAssets,
  nonCurrentAssets,
  currentLiabilities,
  nonCurrentLiabilities,
  equity,
  height = 280,
}: SimpleBalanceProps) {
  return (
    <BalanceTree
      assets={[
        { name: "流动资产", value: currentAssets },
        { name: "非流动资产", value: nonCurrentAssets },
      ]}
      liabilities={[
        { name: "流动负债", value: currentLiabilities },
        { name: "非流动负债", value: nonCurrentLiabilities },
      ]}
      equity={equity}
      title="资产负债结构"
      height={height}
    />
  );
}
