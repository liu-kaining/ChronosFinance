import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, RefreshCcw } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { MarketSnapshotResponse, StatsOverview } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";

export function MarketPulsePage() {
  const [rotationSort, setRotationSort] = useState<"move" | "breadth">("move");
  const [selectedSector, setSelectedSector] = useState<string>("");
  const { data: stats } = useQuery({
    queryKey: ["stats-overview"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });

  const { data: market, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 10 } }),
    staleTime: 30_000,
  });

  const gainers = market?.top_gainers ?? [];
  const losers = market?.top_losers ?? [];
  const active = market?.most_active ?? [];
  const rotationRows = useMemo(() => {
    const rows = [...(market?.sectors ?? [])];
    rows.sort((a, b) => {
      if (rotationSort === "breadth") return (b.symbols ?? 0) - (a.symbols ?? 0);
      return (b.avg_change_pct ?? 0) - (a.avg_change_pct ?? 0);
    });
    return selectedSector ? rows.filter((r) => r.sector === selectedSector) : rows.slice(0, 10);
  }, [market?.sectors, rotationSort, selectedSector]);

  return (
    <div className="flex flex-col gap-4">
      {/* Stats overview */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <StatCard
          label="标的总数"
          value={fmtNum(stats?.universe.total, 0)}
          sub={`活跃 ${stats?.universe.active ?? 0}`}
        />
        <StatCard
          label="日线数据"
          value={fmtCap(stats?.tables.daily_prices, 0)}
        />
        <StatCard
          label="财务数据"
          value={fmtCap(stats?.tables.static_financials, 0)}
        />
        <StatCard
          label="财报事件"
          value={fmtCap(stats?.tables.earnings_calendar, 0)}
        />
      </div>

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Gainers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-up">
            <TrendingUp size={16} />
            <span>涨幅榜</span>
          </div>
          <MoversTable items={gainers} />
        </div>

        {/* Losers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-down">
            <TrendingDown size={16} />
            <span>跌幅榜</span>
          </div>
          <MoversTable items={losers} />
        </div>

        <div className="card p-3">
          <div className="mb-3 text-sm font-medium text-text-primary">成交活跃</div>
          <MoversTable items={active} />
        </div>
      </div>

      {/* Sector distribution */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <span>行业分布 {isLoading ? "" : `（截至 ${market?.as_of_date ?? "—"}）`}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1 rounded border border-border-soft px-2 py-1 normal-case tracking-normal text-text-secondary hover:bg-bg-2"
            title="刷新市场快照"
          >
            <RefreshCcw size={12} className={isFetching ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
        <SectorTreemap
          sectors={market?.sectors ?? []}
          onSectorClick={(sector) => {
            setSelectedSector(sector);
          }}
        />
        <div className="mt-3 overflow-auto">
          <div className="mb-2 flex items-center justify-end gap-1">
            {selectedSector ? (
              <button
                type="button"
                onClick={() => setSelectedSector("")}
                className="mr-2 rounded border border-border-soft bg-bg-2 px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-3"
                title="清除行业筛选"
              >
                行业：{selectedSector} · 清除
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setRotationSort("move")}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs",
                rotationSort === "move"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border-soft text-text-tertiary",
              )}
            >
              按涨跌排序
            </button>
            <button
              type="button"
              onClick={() => setRotationSort("breadth")}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs",
                rotationSort === "breadth"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border-soft text-text-tertiary",
              )}
            >
              按广度排序
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">行业</th>
                <th className="px-2 py-1.5 text-right">标的数</th>
                <th className="px-2 py-1.5 text-right">平均 1D</th>
              </tr>
            </thead>
            <tbody>
              {rotationRows.map((s, i) => (
                <tr key={s.sector} className={i % 2 === 0 ? "bg-bg-2/30" : ""}>
                  <td className="px-2 py-1.5 text-text-secondary">{s.sector}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">{fmtNum(s.symbols, 0)}</td>
                  <td
                    className="px-2 py-1.5 text-right font-mono"
                    style={{ color: signalColor(s.avg_change_pct ?? null) }}
                  >
                    {(s.avg_change_pct ?? 0) >= 0 ? "↑ " : "↓ "}
                    {fmtPctSigned(s.avg_change_pct, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="kpi-num">{value}</div>
      {sub && <div className="text-2xs text-text-secondary">{sub}</div>}
    </div>
  );
}

function MoversTable({ items }: { items: MarketSnapshotResponse["top_gainers"] }) {
  if (items.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">暂无数据</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border-soft text-left text-text-tertiary">
          <th className="px-2 py-1.5">代码</th>
          <th className="px-2 py-1.5 text-right">价格</th>
          <th className="px-2 py-1.5 text-right">涨跌</th>
        </tr>
      </thead>
      <tbody>
        {items.map((m, i) => (
          <tr key={m.symbol} className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}>
            <td className="px-2 py-1.5">
              <a
                href={`/symbol/${m.symbol}/overview`}
                className="ticker text-text-primary hover:text-accent"
              >
                {m.symbol}
              </a>
            </td>
            <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
              {fmtNum(m.close, 2)}
            </td>
            <td
              className="px-2 py-1.5 text-right font-mono"
              style={{ color: signalColor(m.change_pct ?? null) }}
            >
              {fmtPctSigned(m.change_pct, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectorTreemap({
  sectors,
  onSectorClick,
}: {
  sectors: MarketSnapshotResponse["sectors"];
  onSectorClick: (sector: string) => void;
}) {
  const data = sectors
    .map((s) => ({ name: s.sector, value: s.symbols, move: s.avg_change_pct ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  if (data.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">No sector data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      formatter: (params: { name: string; value: number }) => {
        const row = sectors.find((s) => s.sector === params.name);
        return `<b>${params.name}</b><br/>标的数：${params.value}<br/>平均 1D：${fmtPctSigned(row?.avg_change_pct, 2)}`;
      },
    },
    series: [
      {
        type: "treemap",
        data: data.map((d) => {
          const move = d.move ?? 0;
          const color =
            move > 0
              ? "rgba(16,185,129,0.35)"
              : move < 0
                ? "rgba(239,68,68,0.35)"
                : "rgba(59,130,246,0.25)";
          return {
            name: d.name,
            value: d.value,
            itemStyle: {
              color,
              borderColor: COLORS.grid,
              borderWidth: 1,
            },
          };
        }),
        width: "100%",
        height: "100%",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: "{b}",
          fontSize: 10,
          color: COLORS.textStrong,
        },
        upperLabel: { show: false },
        itemStyle: {
          borderColor: COLORS.grid,
          borderWidth: 1,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              color: COLORS.borderSoft,
              borderColor: COLORS.grid,
              borderWidth: 1,
            },
          },
        ],
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 280 }}
      onEvents={{
        click: (params: { name?: string }) => {
          if (params?.name) onSectorClick(params.name);
        },
      }}
    />
  );
}
