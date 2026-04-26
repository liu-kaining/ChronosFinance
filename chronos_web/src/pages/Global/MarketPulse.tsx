import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, RefreshCcw, ArrowRight, BarChart3, PieChart } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type {
  MarketSnapshotResponse,
  SectorTrendsResponse,
  SectorSnapshotResponse,
  UniverseItem,
  UniversePage,
} from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { HeatmapMatrix } from "@/components/charts/HeatmapMatrix";
import { Sparkline } from "@/components/ui/Sparkline";

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

export function MarketPulsePage() {
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [viewMode, setViewMode] = useState<"matrix" | "treemap">("matrix");

  const {  market, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 10 } }),
    staleTime: 30_000,
  });

  const {  sectorTrends } = useQuery({
    queryKey: ["sector-trends"],
    queryFn: () => api.get<SectorTrendsResponse>(endpoints.sectorTrends()),
    staleTime: 60_000,
  });

  const {  sectorSnapshot } = useQuery({
    queryKey: ["sector-snapshot", selectedSector],
    queryFn: () => api.get<SectorSnapshotResponse>(endpoints.sectorSnapshot(selectedSector)),
    enabled: !!selectedSector,
    staleTime: 60_000,
  });

  const {  universeRows } = useQuery({
    queryKey: ["universe-all-active"],
    queryFn: fetchAllActiveUniverse,
    staleTime: 10 * 60_000,
  });

  const gainers = market?.top_gainers ?? [];
  const losers = market?.top_losers ?? [];
  const active = market?.most_active ?? [];
  const sectors = market?.sectors ?? [];
  const trends = sectorTrends?.trends ?? [];

  // Prepare heatmap data
  const heatmapData: HeatmapData[] = useMemo(() => {
    return trends.map((t) => ({
      sector: t.sector,
      periods: {
        d1: t.change_1d,
        w1: t.change_1w,
        m1: t.change_1m,
        m3: null, // TODO: add to API
        y1: null, // TODO: add to API
      },
    }));
  }, [trends]);

  // Market sentiment
  const positiveSectors = trends.filter((t) => (t.change_1d ?? 0) > 0).length;
  const totalSectors = Math.max(trends.length, 1);
  const sentimentRatio = positiveSectors / totalSectors;
  const marketTone =
    sentimentRatio >= 0.6 ? "风险偏好扩张" : sentimentRatio <= 0.4 ? "防御偏好抬升" : "震荡分化";

  // Top sector
  const topSector = trends[0];

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="市场脉动"
        description={`当前风格：${marketTone}。${topSector ? `最强板块为 ${topSector.sector}（${fmtPctSigned(topSector.change_1d, 2)}）` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setViewMode("matrix")}
              className={cn(
                "chip flex items-center gap-1",
                viewMode === "matrix" ? "border-accent/40 bg-accent/10 text-accent" : ""
              )}
            >
              <BarChart3 size={14} />
              矩阵视图
            </button>
            <button
              type="button"
              onClick={() => setViewMode("treemap")}
              className={cn(
                "chip flex items-center gap-1",
                viewMode === "treemap" ? "border-accent/40 bg-accent/10 text-accent" : ""
              )}
            >
              <PieChart size={14} />
              热力图
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              className="chip flex items-center gap-1"
              disabled={isFetching}
            >
              <RefreshCcw size={14} className={isFetching ? "animate-spin" : ""} />
              刷新
            </button>
          </div>
        }
      />

      {/* Sector Performance Visualization */}
      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            板块表现 {viewMode === "matrix" ? "矩阵" : "热力图"}
          </div>
          {selectedSector && (
            <button
              type="button"
              onClick={() => setSelectedSector("")}
              className="text-2xs text-accent hover:underline"
            >
              清除选择
            </button>
          )}
        </div>

        {viewMode === "matrix" ? (
          <HeatmapMatrix
            data={heatmapData}
            onSectorClick={(sector) => setSelectedSector(sector)}
          />
        ) : (
          <SectorTreemap
            sectors={sectors}
            onSectorClick={(sector) => setSelectedSector(sector)}
          />
        )}

        {/* Sector Quick Stats */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
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
                  {fmtPctSigned(t.change_1d, 1)}
                </span>
                {t.avg_pe && (
                  <span className="font-mono text-2xs text-text-tertiary">PE {t.avg_pe.toFixed(1)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MoverCard
          title="涨幅榜"
          icon={<TrendingUp size={16} className="text-up" />}
          items={gainers}
          colorClass="text-up"
        />
        <MoverCard
          title="跌幅榜"
          icon={<TrendingDown size={16} className="text-down" />}
          items={losers}
          colorClass="text-down"
        />
        <MoverCard
          title="成交活跃"
          icon={<BarChart3 size={16} className="text-accent" />}
          items={active}
          showVolume
        />
      </div>

      {/* Sector Detail */}
      {selectedSector && (
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedSector}</div>
              <div className="text-2xs text-text-tertiary">
                {sectorSnapshot ? `${sectorSnapshot.constituents.length} 只成分股` : "加载中..."}
              </div>
            </div>
            <Link
              to={`/sector/${encodeURIComponent(selectedSector)}`}
              className="flex items-center gap-1 text-2xs text-accent hover:underline"
            >
              查看详情 <ArrowRight size={12} />
            </Link>
          </div>

          {sectorSnapshot ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatBox label="平均涨跌" value={fmtPctSigned(sectorSnapshot.avg_change_1d, 2)} />
                <StatBox label="平均PE" value={sectorSnapshot.avg_pe?.toFixed(2) ?? "—"} />
                <StatBox label="总市值" value={fmtCap(sectorSnapshot.total_market_cap, 0)} />
                <StatBox label="1月涨跌" value={fmtPctSigned(sectorSnapshot.avg_change_1m, 2)} />
              </div>

              <div className="mt-3">
                <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-tertiary">
                  成分股（按市值）
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sectorSnapshot.constituents.slice(0, 9).map((c) => (
                    <Link
                      key={c.symbol}
                      to={`/symbol/${c.symbol}/overview`}
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
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-text-tertiary">加载板块数据中...</div>
          )}
        </div>
      )}
    </div>
  );
}

function MoverCard({
  title,
  icon,
  items,
  colorClass,
  showVolume,
}: {
  title: string;
  icon: React.ReactNode;
  items: MarketSnapshotResponse["top_gainers"];
  colorClass?: string;
  showVolume?: boolean;
}) {
  return (
    <div className="card p-3">
      <div className={cn("mb-3 flex items-center gap-2 text-sm font-medium", colorClass || "text-text-primary")}>
        {icon}
        <span>{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="py-4 text-center text-xs text-text-tertiary">暂无数据</div>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((item) => (
            <Link
              key={item.symbol}
              to={`/symbol/${item.symbol}/overview`}
              className="flex items-center justify-between rounded-md border border-border-soft bg-bg-2/30 px-3 py-2 transition-colors hover:bg-bg-2"
            >
              <div>
                <span className="ticker text-sm text-text-primary">{item.symbol}</span>
                {item.company_name && (
                  <div className="max-w-[120px] truncate text-2xs text-text-secondary">{item.company_name}</div>
                )}
              </div>
              <div className="text-right">
                <div
                  className={cn(
                    "font-mono text-sm",
                    colorClass || ((item.change_pct ?? 0) > 0 ? "text-up" : "text-down")
                  )}
                >
                  {fmtPctSigned(item.change_pct, 2)}
                </div>
                {showVolume ? (
                  <div className="font-mono text-2xs text-text-tertiary">{fmtCap(item.volume, 0)}</div>
                ) : (
                  <div className="font-mono text-2xs text-text-tertiary">{fmtNum(item.close, 2)}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
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
    return <div className="h-[200px] flex items-center justify-center text-xs text-text-tertiary">暂无板块数据</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      formatter: (params: { name: string; value: number }) => {
        const row = sectors.find((s) => s.sector === params.name);
        return `<b>${params.name}</b><br/>标的数：${params.value}<br/>平均涨跌：${fmtPctSigned(row?.avg_change_pct, 2)}`;
      },
    },
    series: [
      {
        type: "treemap",
        data: data.map((d) => {
          const move = d.move ?? 0;
          const alpha = Math.min(Math.abs(move) * 0.1 + 0.15, 0.4);
          const color =
            move > 0 ? `rgba(38,166,154,${alpha})` : move < 0 ? `rgba(239,83,80,${alpha})` : `rgba(41,98,255,0.15)`;
          return {
            name: d.name,
            value: d.value,
            itemStyle: {
              color,
              borderColor: COLORS.borderSoft,
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
          formatter: (p: { name: string; data: { value: number } }) => `${p.name}\n${p.data.value}只`,
          fontSize: 10,
          color: COLORS.text0,
        },
        itemStyle: {
          borderColor: COLORS.borderSoft,
          borderWidth: 1,
          gapWidth: 2,
        },
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

async function fetchAllActiveUniverse(): Promise<UniverseItem[]> {
  const first = await api.get<UniversePage>(endpoints.universe(), { params: { active_only: true, limit: 500, offset: 0 } });
  const total = first.total_matching ?? first.items.length;
  const pages = Math.ceil(total / 500);
  if (pages <= 1) return first.items ?? [];
  const reqs: Promise<UniversePage>[] = [];
  for (let p = 1; p < pages; p += 1) {
    reqs.push(
      api.get<UniversePage>(endpoints.universe(), {
        params: { active_only: true, limit: 500, offset: p * 500 },
      })
    );
  }
  const rest = await Promise.all(reqs);
  return [first, ...rest].flatMap((x) => x.items ?? []);
}
