import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { StatsOverview, UniversePage, PricesSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Mover {
  symbol: string;
  change: number;
  close: number;
  volume: number;
}

export function MarketPulsePage() {
  const { data: stats } = useQuery({
    queryKey: ["stats-overview"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });

  const { data: universe } = useQuery({
    queryKey: ["universe-top100"],
    queryFn: () =>
      api.get<UniversePage>(endpoints.universe(), {
        params: { limit: 100, active_only: true },
      }),
    staleTime: 60_000,
  });

  // Fetch prices for top symbols to compute movers
  const symbols = (universe?.items ?? []).slice(0, 50).map((u) => u.symbol);
  const { data: movers } = useQuery({
    queryKey: ["movers", symbols.join(",")],
    queryFn: async () => {
      const results: Mover[] = [];
      for (const sym of symbols.slice(0, 30)) {
        try {
          const prices = await api.get<PricesSeriesResponse>(endpoints.prices(sym), {
            params: { limit: 2, order: "desc" },
          });
          if (prices.items?.length >= 2) {
            const latest = prices.items[0]!;
            const prev = prices.items[1]!;
            if (latest.close && prev.close) {
              results.push({
                symbol: sym,
                change: (latest.close - prev.close) / prev.close,
                close: latest.close,
                volume: latest.volume ?? 0,
              });
            }
          }
        } catch {
          // skip
        }
      }
      return results;
    },
    enabled: symbols.length > 0,
    staleTime: 30_000,
  });

  const gainers = (movers ?? []).filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 10);
  const losers = (movers ?? []).filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 10);

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Gainers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-up">
            <TrendingUp size={16} />
            <span>Top Gainers</span>
          </div>
          <MoversTable items={gainers} type="gainer" />
        </div>

        {/* Losers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-down">
            <TrendingDown size={16} />
            <span>Top Losers</span>
          </div>
          <MoversTable items={losers} type="loser" />
        </div>
      </div>

      {/* Sector distribution (placeholder - would need sector aggregation) */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Sector Distribution
        </div>
        <SectorTreemap universe={universe?.items ?? []} />
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

function MoversTable({ items, type }: { items: Mover[]; type: "gainer" | "loser" }) {
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
              style={{ color: signalColor(m.change) }}
            >
              {fmtPctSigned(m.change, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectorTreemap({ universe }: { universe: Array<{ sector: string | null }> }) {
  // Aggregate by sector
  const sectorCounts: Record<string, number> = {};
  for (const u of universe) {
    const sector = u.sector || "Unknown";
    sectorCounts[sector] = (sectorCounts[sector] ?? 0) + 1;
  }

  const data = Object.entries(sectorCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  if (data.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">No sector data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
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
            borderColor: COLORS.borderSoft,
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
          color: COLORS.text0,
        },
        upperLabel: { show: false },
        itemStyle: {
          borderColor: COLORS.borderSoft,
          borderWidth: 1,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              color: COLORS.bg2,
              borderColor: COLORS.borderSoft,
              borderWidth: 1,
            },
          },
        ],
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280 }} />;
}
