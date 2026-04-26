/**
 * SectorDetail - Sector depth analysis page
 * Shows sector valuation, constituents, and events
 */

import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Building2,
  DollarSign,
  BarChart3,
  ArrowUpRight,
  Filter,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type {
  SectorSnapshotResponse,
  SectorTrendsResponse,
  SectorPerformanceResponse,
} from "@/lib/types";
import { COLORS } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";

import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { Sparkline } from "@/components/ui/Sparkline";
import { PeBand } from "@/components/charts/PeBand";
import { Timeline, type TimelineEvent } from "@/components/ui/Timeline";

type SortField = "market_cap" | "change_1d" | "change_1m" | "pe_ratio" | "symbol";
type SortOrder = "asc" | "desc";

export function SectorDetailPage() {
  const { sector } = useParams<{ sector: string }>();
  const decodedSector = decodeURIComponent(sector || "");

  const [sortField, setSortField] = useState<SortField>("market_cap");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ["sector-snapshot", decodedSector],
    queryFn: () => api.get<SectorSnapshotResponse>(endpoints.sectorSnapshot(decodedSector)),
    enabled: !!decodedSector,
    staleTime: 60_000,
  });

  const { data: trends } = useQuery({
    queryKey: ["sector-trends"],
    queryFn: () => api.get<SectorTrendsResponse>(endpoints.sectorTrends()),
    staleTime: 60_000,
  });

  const { data: performance } = useQuery({
    queryKey: ["sector-performance", decodedSector],
    queryFn: () =>
      api.get<SectorPerformanceResponse>(endpoints.sectorPerformance(decodedSector)),
    enabled: !!decodedSector,
    staleTime: 5 * 60_000,
  });

  const sectorTrend = trends?.trends?.find((t) => t.sector === decodedSector);

  // Sort constituents
  const sortedConstituents = useMemo(() => {
    const constituents = snapshot?.constituents ?? [];
    return [...constituents].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const multiplier = sortOrder === "asc" ? 1 : -1;
      return (aVal < bVal ? -1 : 1) * multiplier;
    });
  }, [snapshot?.constituents, sortField, sortOrder]);

  // Build timeline events from constituents
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];
    // This would be populated with actual sector-level events
    // For now, showing a placeholder
    return events;
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  if (!decodedSector) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyDataState title="未指定板块" detail="请从市场脉动页面选择一个板块查看详情" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Back navigation */}
      <Link
        to="/global/market-pulse"
        className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft size={16} />
        返回市场脉动
      </Link>

      {/* Header */}
      <PageNarrative
        title={decodedSector}
        description={`${snapshot?.constituents?.length || 0} 只成分股 · 平均PE: ${fmtNum(sectorTrend?.avg_pe, 1)}x · 1日涨跌: ${fmtPctSigned(sectorTrend?.change_1d, 2)}`}
      />

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="总市值"
          value={fmtCap(snapshot?.total_market_cap, 0)}
          icon={<Building2 size={14} />}
          loading={snapshotLoading}
        />
        <MetricCard
          label="平均PE"
          value={fmtNum(sectorTrend?.avg_pe, 1)}
          suffix="x"
          icon={<BarChart3 size={14} />}
        />
        <MetricCard
          label="1日涨跌"
          value={fmtPctSigned(sectorTrend?.change_1d, 2)}
          positive={sectorTrend?.change_1d ? sectorTrend.change_1d > 0 : undefined}
          icon={sectorTrend?.change_1d && sectorTrend.change_1d > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        />
        <MetricCard
          label="1月涨跌"
          value={fmtPctSigned(sectorTrend?.change_1m, 2)}
          positive={sectorTrend?.change_1m ? sectorTrend.change_1m > 0 : undefined}
          icon={sectorTrend?.change_1m && sectorTrend.change_1m > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        />
      </div>

      {/* PE Band Chart */}
      <div className="card p-3">
        <PeBand
          data={performance?.items
            ?.filter((p) => p.metric === "pe_ratio")
            .map((p) => ({
              date: p.date,
              pe: p.value,
            })) || []}
          title={`${decodedSector} PE估值带`}
          height={260}
        />
      </div>

      {/* Constituents Table */}
      <div className="card overflow-hidden p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            <Filter size={14} />
            <span>成分股排名</span>
          </div>
          <div className="text-2xs text-text-tertiary">
            点击表头排序 · 共 {snapshot?.constituents?.length || 0} 只
          </div>
        </div>

        {snapshotLoading ? (
          <div className="py-8 text-center text-sm text-text-tertiary">加载中...</div>
        ) : sortedConstituents.length === 0 ? (
          <EmptyDataState title="暂无成分股数据" detail="该板块成分股数据暂不可用" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-modern w-full">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <SortHeader label="代码" field="symbol" current={sortField} order={sortOrder} onSort={handleSort} />
                  <th className="px-2 py-2">公司名称</th>
                  <SortHeader
                    label="市值"
                    field="market_cap"
                    current={sortField}
                    order={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="1日涨跌"
                    field="change_1d"
                    current={sortField}
                    order={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="1月涨跌"
                    field="change_1m"
                    current={sortField}
                    order={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="PE"
                    field="pe_ratio"
                    current={sortField}
                    order={sortOrder}
                    onSort={handleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedConstituents.map((c, i) => (
                  <tr
                    key={c.symbol}
                    className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                  >
                    <td className="px-2 py-2">
                      <Link
                        to={`/symbol/${c.symbol}/evidence`}
                        className="ticker font-mono text-sm text-accent hover:underline"
                      >
                        {c.symbol}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2 text-xs text-text-secondary">
                      {c.company_name}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-text-secondary">
                      {fmtCap(c.market_cap, 0)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono text-xs",
                        (c.change_pct ?? 0) > 0 ? "text-up" : (c.change_pct ?? 0) < 0 ? "text-down" : "text-text-secondary"
                      )}
                    >
                      {fmtPctSigned(c.change_pct, 2)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono text-xs",
                        (c.change_1m ?? 0) > 0 ? "text-up" : (c.change_1m ?? 0) < 0 ? "text-down" : "text-text-secondary"
                      )}
                    >
                      {fmtPctSigned(c.change_1m, 2)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-text-secondary">
                      {fmtNum(c.pe_ratio, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sector Stats */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            板块统计
          </div>
          <div className="space-y-2">
            <StatRow label="平均市值" value={fmtCap((snapshot?.total_market_cap || 0) / (snapshot?.constituents?.length || 1), 0)} />
            <StatRow label="平均1日涨跌" value={fmtPctSigned(snapshot?.avg_change_1d, 2)} />
            <StatRow label="平均1月涨跌" value={fmtPctSigned(snapshot?.avg_change_1m, 2)} />
            <StatRow label="上涨家数" value={`${snapshot?.constituents?.filter((c) => (c.change_pct || 0) > 0).length || 0} / ${snapshot?.constituents?.length || 0}`} />
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            市值分布
          </div>
          {snapshot?.constituents && snapshot.constituents.length > 0 && (
            <MarketCapDistribution constituents={snapshot.constituents} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function MetricCard({
  label,
  value,
  suffix,
  icon,
  positive,
  loading,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon?: React.ReactNode;
  positive?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="card p-3">
        <div className="h-4 w-16 animate-pulse rounded bg-bg-3" />
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-bg-3" />
      </div>
    );
  }

  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-2xs text-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold",
          positive === true ? "text-up" : positive === false ? "text-down" : "text-text-primary"
        )}
      >
        {value}
        {suffix && <span className="ml-0.5 text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  field,
  current,
  order,
  onSort,
  align = "left",
}: {
  label: string;
  field: SortField;
  current: SortField;
  order: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}) {
  const isActive = current === field;

  return (
    <th
      className={cn(
        "cursor-pointer px-2 py-2 transition-colors hover:bg-bg-2",
        align === "right" ? "text-right" : "text-left"
      )}
      onClick={() => onSort(field)}
    >
      <span className="flex items-center gap-1" style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        {label}
        {isActive && (
          <span className="text-accent">{order === "asc" ? "↑" : "↓"}</span>
        )}
      </span>
    </th>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-soft/50 py-1.5 last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="font-mono text-xs text-text-primary">{value}</span>
    </div>
  );
}

function MarketCapDistribution({
  constituents,
}: {
  constituents: Array<{ market_cap: number; symbol: string }>;
}) {
  const sorted = [...constituents].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
  const total = sorted.reduce((sum, c) => sum + (c.market_cap || 0), 0);

  // Top 5 + others
  const top5 = sorted.slice(0, 5);
  const others = sorted.slice(5);
  const othersValue = others.reduce((sum, c) => sum + (c.market_cap || 0), 0);

  const data = [
    ...top5.map((c) => ({
      name: c.symbol,
      value: c.market_cap,
      pct: ((c.market_cap / total) * 100).toFixed(1),
    })),
    ...(others.length > 0
      ? [{ name: `其他(${others.length})`, value: othersValue, pct: ((othersValue / total) * 100).toFixed(1) }]
      : []),
  ];

  const colors = [COLORS.accent, COLORS.up, COLORS.accent2, COLORS.purple, COLORS.cyan, COLORS.text2];

  return (
    <div className="space-y-1.5">
      {data.map((item, i) => (
        <div key={item.name} className="flex items-center gap-2">
          <div
            className="h-2 rounded-sm"
            style={{ width: `${Math.max(parseFloat(item.pct), 5)}%`, backgroundColor: colors[i % colors.length] }}
          />
          <span className="text-2xs text-text-secondary">{item.name}</span>
          <span className="ml-auto font-mono text-2xs text-text-tertiary">{item.pct}%</span>
        </div>
      ))}
    </div>
  );
}
