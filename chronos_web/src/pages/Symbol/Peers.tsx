import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SectorSnapshotResponse, SymbolSnapshotResponse } from "@/lib/types";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

export function SymbolPeers() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: snap, isLoading: snapshotLoading } = useQuery({
    queryKey: ["symbol-snapshot", sym],
    queryFn: () => api.get<SymbolSnapshotResponse>(endpoints.symbolSnapshot(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const sector = snap?.universe?.sector;
  const { data: sectorData, isLoading: sectorLoading } = useQuery({
    queryKey: ["peer-sector-snapshot", sector],
    queryFn: () => api.get<SectorSnapshotResponse>(endpoints.sectorSnapshot(sector ?? "")),
    enabled: !!sector,
    staleTime: 60_000,
  });
  const peers = (sectorData?.constituents ?? []).filter((row) => row.symbol !== sym);

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="同业叙事"
        description={sector ? `${sym} 属于 ${sector}，这里用同板块成分股横向比较规模、涨跌和流动性。` : "先识别所属板块，再横向比较估值、规模和价格表现。"}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricBox label="所属板块" value={sector ?? "—"} />
        <MetricBox label="板块成分股" value={fmtNum(sectorData?.constituents.length, 0)} />
        <MetricBox label="板块总市值" value={fmtCap(sectorData?.total_market_cap, 0)} />
      </div>

      <div className="card overflow-auto p-2">
        {snapshotLoading || sectorLoading ? (
          <div className="h-[180px] animate-pulse rounded bg-bg-3" />
        ) : !sector ? (
          <EmptyDataState
            title="暂无板块信息"
            detail="该标的缺少 sector 字段，暂时无法生成同业对比。"
          />
        ) : peers.length === 0 ? (
          <EmptyDataState title="暂无可比同业" detail="该板块当前没有其它成分股可用于对比。" />
        ) : (
          <table className="table-modern">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">标的</th>
                <th className="px-2 py-1.5">公司</th>
                <th className="px-2 py-1.5 text-right">最新价</th>
                <th className="px-2 py-1.5 text-right">涨跌</th>
                <th className="px-2 py-1.5 text-right">市值</th>
                <th className="px-2 py-1.5 text-right">成交量</th>
              </tr>
            </thead>
            <tbody>
              {[snap?.latest_price ? {
                symbol: sym,
                company_name: snap.universe?.company_name,
                close: snap.latest_price.close,
                change_pct: snap.latest_price.change_pct,
                market_cap: snap.universe?.market_cap,
                volume: snap.latest_price.volume,
              } : null, ...peers.slice(0, 30)].filter(Boolean).map((peer, i) => {
                const row = peer!;
                return (
                  <tr
                    key={row.symbol}
                    className={cn(
                      "border-b border-border-soft/50",
                      row.symbol === sym ? "bg-accent/10" : i % 2 === 0 ? "bg-bg-2/30" : "",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <Link to={`/symbol/${row.symbol}/overview`} className="ticker text-accent">
                        {row.symbol}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-text-secondary">
                      {row.company_name ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtNum(row.close, 2)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {fmtPctSigned(row.change_pct, 2)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(row.market_cap, 0)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(row.volume, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* External link */}
      <div className="card p-3">
        <a
          href={`https://finance.yahoo.com/quote/${sym}/analysis`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-accent hover:text-accent/80"
        >
          <ExternalLink size={14} />
          <span>在 Yahoo Finance 查看可比分析</span>
        </a>
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-1 truncate font-mono text-lg text-text-primary">{value}</div>
    </div>
  );
}
