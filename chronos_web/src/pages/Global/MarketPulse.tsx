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
    return rows.slice(0, 10);
  }, [market?.sectors, rotationSort]);

  return (
    <div className="flex flex-col gap-4">
      {/* Stats overview */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <StatCard
          label="Total Symbols"
          value={fmtNum(stats?.universe.total, 0)}
          sub={`${stats?.universe.active ?? 0} active`}
        />
        <StatCard
          label="Daily Prices"
          value={fmtCap(stats?.tables.daily_prices, 0)}
        />
        <StatCard
          label="Financials"
          value={fmtCap(stats?.tables.static_financials, 0)}
        />
        <StatCard
          label="Earnings"
          value={fmtCap(stats?.tables.earnings_calendar, 0)}
        />
      </div>

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Gainers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-up">
            <TrendingUp size={16} />
            <span>Top Gainers</span>
          </div>
          <MoversTable items={gainers} />
        </div>

        {/* Losers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-down">
            <TrendingDown size={16} />
            <span>Top Losers</span>
          </div>
          <MoversTable items={losers} />
        </div>

        <div className="card p-3">
          <div className="mb-3 text-sm font-medium text-text-primary">Most Active</div>
          <MoversTable items={active} />
        </div>
      </div>

      {/* Sector distribution */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <span>Sector Distribution {isLoading ? "" : `(as of ${market?.as_of_date ?? "—"})`}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1 rounded border border-border-soft px-2 py-1 normal-case tracking-normal text-text-secondary hover:bg-bg-2"
            title="Refresh market snapshot"
          >
            <RefreshCcw size={12} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        <SectorTreemap sectors={market?.sectors ?? []} />
        <div className="mt-3 overflow-auto">
          <div className="mb-2 flex items-center justify-end gap-1">
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
              Sort by Move
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
              Sort by Breadth
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">Sector</th>
                <th className="px-2 py-1.5 text-right">Symbols</th>
                <th className="px-2 py-1.5 text-right">Avg 1D</th>
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
    return <div className="py-4 text-center text-xs text-text-tertiary">No data</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border-soft text-left text-text-tertiary">
          <th className="px-2 py-1.5">Symbol</th>
          <th className="px-2 py-1.5 text-right">Price</th>
          <th className="px-2 py-1.5 text-right">Change</th>
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
}: {
  sectors: MarketSnapshotResponse["sectors"];
}) {
  const data = sectors
    .map((s) => ({ name: s.sector, value: s.symbols }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  if (data.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">No sector data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      formatter: (params: { name: string; value: number }) =>
        `<b>${params.name}</b><br/>${params.value} symbols`,
    },
    series: [
      {
        type: "treemap",
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: {
            color: COLORS.accent,
            borderColor: COLORS.grid,
            borderWidth: 1,
          },
        })),
        width: "100%",
        height: "100%",
        roam: false,
        nodeClick: "link",
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: "{b}",
          fontSize: 10,
          color: COLORS.text,
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
              color: "#111827",
              borderColor: COLORS.grid,
              borderWidth: 1,
            },
          },
        ],
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280 }} />;
}
