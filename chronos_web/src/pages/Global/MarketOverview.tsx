import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCcw } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { MarketSnapshotResponse, SectorTrendsResponse, SectorSnapshotResponse } from "@/lib/types";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { MoversTable } from "@/components/shared/MoversTable";
import { SectorTreemap } from "@/components/shared/SectorTreemap";

export function MarketOverviewPage() {
  const [selectedSector, setSelectedSector] = useState<string>("");

  const { data: market, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 10 } }),
    staleTime: 30_000,
  });

  const { data: sectorTrends } = useQuery({
    queryKey: ["sector-trends"],
    queryFn: () => api.get<SectorTrendsResponse>(endpoints.sectorTrends()),
    staleTime: 60_000,
  });

  const { data: sectorSnapshot } = useQuery({
    queryKey: ["sector-snapshot", selectedSector],
    queryFn: () => api.get<SectorSnapshotResponse>(endpoints.sectorSnapshot(selectedSector)),
    enabled: !!selectedSector,
    staleTime: 60_000,
  });

  const sectors = market?.sectors ?? [];
  const trends = sectorTrends?.trends ?? [];

  // Market sentiment
  const positiveSectors = trends.filter((t) => (t.change_1d ?? 0) > 0).length;
  const totalSectors = Math.max(trends.length, 1);
  const sentimentRatio = positiveSectors / totalSectors;
  const marketTone =
    sentimentRatio >= 0.6 ? "风险偏好扩张" : sentimentRatio <= 0.4 ? "防御偏好抬升" : "震荡分化";

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="市场概览"
        description={`当前风格：${marketTone}。${positiveSectors}/${totalSectors} 板块上涨。`}
        actions={
          <button
            type="button"
            onClick={() => void refetch()}
            className="chip flex items-center gap-1"
            disabled={isFetching}
          >
            <RefreshCcw size={14} className={isFetching ? "animate-spin" : ""} />
            刷新
          </button>
        }
      />

      {/* Sector Treemap */}
      <div className="card p-4">
        <SectionHeader title="板块热力图" subtitle="按市值加权涨跌" />
        <SectorTreemap sectors={sectors} />
      </div>

      {/* Sector Quick Stats */}
      <div className="card p-4">
        <SectionHeader title="板块涨跌" subtitle="1日/1周/1月" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {trends.slice(0, 12).map((t) => (
            <button
              key={t.sector}
              type="button"
              onClick={() => setSelectedSector(t.sector)}
              className={cn(
                "rounded-lg border p-2 text-left transition-all",
                selectedSector === t.sector
                  ? "border-accent bg-accent/10"
                  : "border-border-soft bg-bg-2/50 hover:bg-bg-2"
              )}
            >
              <div className="truncate text-xs font-medium text-text-primary">{t.sector}</div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-sm",
                    (t.change_1d ?? 0) > 0 ? "text-up" : (t.change_1d ?? 0) < 0 ? "text-down" : "text-text-secondary"
                  )}
                >
                  {fmtPctSigned(t.change_1d ? t.change_1d / 100 : null, 1)}
                </span>
                {t.avg_pe && (
                  <span className="font-mono text-2xs text-text-tertiary">PE {t.avg_pe.toFixed(1)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Sector Detail */}
      {selectedSector && sectorSnapshot && (
        <div className="card p-4">
          <SectionHeader
            title={selectedSector}
            subtitle={`${sectorSnapshot.constituents.length} 只成分股`}
            action={
              <Link
                to={`/sector/${encodeURIComponent(selectedSector)}`}
                className="text-xs text-accent hover:underline"
              >
                查看详情 →
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-4">
            <StatBox label="平均涨跌" value={fmtPctSigned(sectorSnapshot.avg_change_1d, 2)} />
            <StatBox label="平均PE" value={sectorSnapshot.avg_pe?.toFixed(2) ?? "—"} />
            <StatBox label="总市值" value={fmtCap(sectorSnapshot.total_market_cap, 0)} />
            <StatBox label="1月涨跌" value={fmtPctSigned(sectorSnapshot.avg_change_1m, 2)} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sectorSnapshot.constituents.slice(0, 9).map((c) => (
              <Link
                key={c.symbol}
                to={`/symbol/${c.symbol}/price`}
                className="flex items-center justify-between rounded-md border border-border-soft bg-bg-2/50 px-3 py-2 transition-colors hover:bg-bg-3"
              >
                <div>
                  <span className="ticker text-sm text-text-primary">{c.symbol}</span>
                  <div className="text-2xs text-text-secondary">{c.company_name}</div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "font-mono text-sm",
                      (c.change_pct ?? 0) > 0 ? "text-up" : (c.change_pct ?? 0) < 0 ? "text-down" : "text-text-secondary"
                    )}
                  >
                    {fmtPctSigned(c.change_pct, 2)}
                  </div>
                  <div className="font-mono text-2xs text-text-tertiary">{fmtCap(c.market_cap, 0)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MoversTable title="涨幅榜" rows={market?.top_gainers ?? []} maxRows={5} />
        <MoversTable title="跌幅榜" rows={market?.top_losers ?? []} maxRows={5} />
        <MoversTable title="成交活跃" rows={market?.most_active ?? []} maxRows={5} />
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-soft bg-bg-2/50 p-2 text-center">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text-primary">{value}</div>
    </div>
  );
}
