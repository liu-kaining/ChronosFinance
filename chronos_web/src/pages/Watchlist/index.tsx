/**
 * WatchlistPage - User's watchlist monitoring
 * Track favorite stocks with price alerts and event notifications
 */

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Search,
  X,
  Bell,
  BellOff,
  TrendingUp,
  TrendingDown,
  Trash2,
  Plus,
  ArrowUpRight,
  Calendar,
  RefreshCcw,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SymbolSnapshotResponse } from "@/lib/types";
import { COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useWatchlist } from "@/hooks/useWatchlist";

import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { Sparkline } from "@/components/ui/Sparkline";
import { Timeline, type TimelineEvent } from "@/components/ui/Timeline";

interface WatchlistItemData {
  symbol: string;
  snapshot?: SymbolSnapshotResponse;
  isLoading: boolean;
}

export function WatchlistPage() {
  const { watchlist, removeFromWatchlist, isLoaded } = useWatchlist();
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch data for all watchlist items
  const watchlistData = useWatchlistData(watchlist.map((i) => i.symbol), refreshKey);

  // Filter by search
  const filteredData = useMemo(() => {
    if (!searchQuery) return watchlistData;
    const query = searchQuery.toLowerCase();
    return watchlistData.filter(
      (item) =>
        item.symbol.toLowerCase().includes(query) ||
        item.snapshot?.universe?.company_name?.toLowerCase().includes(query)
    );
  }, [watchlistData, searchQuery]);

  // Calculate summary stats
  const summary = useMemo(() => {
    const validItems = filteredData.filter((i) => i.snapshot?.latest_price);
    const upCount = validItems.filter((i) => (i.snapshot?.latest_price?.change_pct || 0) > 0).length;
    const downCount = validItems.filter((i) => (i.snapshot?.latest_price?.change_pct || 0) < 0).length;
    const totalChange =
      validItems.reduce((sum, i) => sum + (i.snapshot?.latest_price?.change_pct || 0), 0) /
      (validItems.length || 1);

    return {
      total: watchlist.length,
      up: upCount,
      down: downCount,
      unchanged: validItems.length - upCount - downCount,
      avgChange: totalChange,
    };
  }, [filteredData, watchlist.length]);

  // Build upcoming events from watchlist
  const upcomingEvents: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];
    filteredData.forEach((item) => {
      const snap = item.snapshot;
      if (snap?.latest_earnings?.date) {
        const date = new Date(snap.latest_earnings.date);
        const daysDiff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= -7 && daysDiff <= 30) {
          events.push({
            id: `earnings-${item.symbol}`,
            date: snap.latest_earnings.date,
            type: "earnings",
            title: `${item.symbol} 财报`,
            description: daysDiff > 0 ? `${daysDiff}天前` : `${Math.abs(daysDiff)}天后`,
            symbol: item.symbol,
          });
        }
      }
    });
    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);
  }, [filteredData]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  if (!isLoaded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="py-8 text-center text-sm text-text-tertiary">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="我的自选"
        description={`追踪 ${watchlist.length} 只标的，监控价格异动与重要事件`}
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            className="chip flex items-center gap-1"
          >
            <RefreshCcw size={14} />
            刷新
          </button>
        }
      />

      {/* Summary Cards */}
      {watchlist.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="自选总数" value={String(summary.total)} color="text-text-primary" />
          <SummaryCard label="上涨" value={String(summary.up)} color="text-up" />
          <SummaryCard label="下跌" value={String(summary.down)} color="text-down" />
          <SummaryCard
            label="平均涨跌"
            value={fmtPctSigned(summary.avgChange, 2)}
            color={summary.avgChange > 0 ? "text-up" : summary.avgChange < 0 ? "text-down" : "text-text-primary"}
          />
        </div>
      )}

      {/* Search & Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索自选标的..."
            className="w-full rounded-md border border-border-soft bg-bg-2 py-2 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
          />
        </div>
        <Link
          to="/global/market-pulse"
          className="flex items-center gap-1 rounded-md border border-border-soft bg-bg-2 px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-3"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">添加自选</span>
        </Link>
      </div>

      {/* Watchlist Grid */}
      {filteredData.length === 0 ? (
        <EmptyDataState
          title={watchlist.length === 0 ? "自选列表为空" : "未找到匹配标的"}
          detail={
            watchlist.length === 0
              ? "从市场脉动页面添加标的到自选列表，开始追踪您的投资组合"
              : "尝试调整搜索关键词"
          }
          actions={
            watchlist.length === 0 && (
              <Link to="/global/market-pulse" className="chip flex items-center gap-1">
                <ArrowUpRight size={14} />
                去市场脉动
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredData.map((item) => (
            <WatchlistCard
              key={item.symbol}
              item={item}
              onRemove={() => removeFromWatchlist(item.symbol)}
            />
          ))}
        </div>
      )}

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            <Calendar size={14} />
            <span>近期事件</span>
          </div>
          <Timeline
            events={upcomingEvents}
            onEventClick={(event) => {
              if (event.symbol) {
                window.location.href = `/symbol/${event.symbol}/evidence`;
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function useWatchlistData(symbols: string[], refreshKey: number): WatchlistItemData[] {
  const results = useQuery({
    queryKey: ["watchlist-batch", symbols.join(","), refreshKey],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      // Fetch in parallel with a small delay to avoid overwhelming the API
      const batchSize = 5;
      const results: Array<{ symbol: string; snapshot?: SymbolSnapshotResponse }> = [];

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const snapshot = await api.get<SymbolSnapshotResponse>(endpoints.symbolSnapshot(symbol));
              return { symbol, snapshot };
            } catch {
              return { symbol };
            }
          })
        );
        results.push(...batchResults);
        // Small delay between batches
        if (i + batchSize < symbols.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      return results;
    },
    enabled: symbols.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000, // Auto refresh every minute
  });

  return (
    results.data?.map((r) => ({
      symbol: r.symbol,
      snapshot: r.snapshot,
      isLoading: false,
    })) ??
    symbols.map((s) => ({ symbol: s, isLoading: true }))
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="card p-3 text-center">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold", color)}>{value}</div>
    </div>
  );
}

function WatchlistCard({
  item,
  onRemove,
}: {
  item: WatchlistItemData;
  onRemove: () => void;
}) {
  const { symbol, snapshot, isLoading } = item;
  const price = snapshot?.latest_price;
  const change = price?.change_pct;
  const coverage =
    snapshot?.synced_flags_total && snapshot.synced_flags_total > 0
      ? snapshot.synced_flags_true / snapshot.synced_flags_total
      : null;

  return (
    <div className="card group relative p-3 transition-all hover:border-accent/30">
      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-down-soft hover:text-down group-hover:opacity-100"
        title="移除自选"
      >
        <Trash2 size={14} />
      </button>

      <div className="flex items-start justify-between">
        {/* Left: Symbol & Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/symbol/${symbol}/evidence`}
              className="ticker text-lg font-medium text-accent hover:underline"
            >
              {symbol}
            </Link>
            <Link
              to={`/symbol/${symbol}/evidence`}
              className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-accent/10 hover:text-accent"
            >
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="max-w-[200px] truncate text-xs text-text-secondary">
            {snapshot?.universe?.company_name || "—"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-2xs text-text-tertiary">
            <span>{snapshot?.universe?.sector || "—"}</span>
            <span>·</span>
            <span>{fmtCap(snapshot?.universe?.market_cap)}</span>
          </div>
        </div>

        {/* Right: Price */}
        <div className="text-right">
          {isLoading || !price ? (
            <div className="h-6 w-20 animate-pulse rounded bg-bg-3" />
          ) : (
            <>
              <div className="text-lg font-semibold text-text-primary">${fmtNum(price.close, 2)}</div>
              <div
                className={cn(
                  "flex items-center justify-end gap-1 text-sm",
                  change && change > 0 ? "text-up" : change && change < 0 ? "text-down" : "text-text-secondary"
                )}
              >
                {change && change > 0 ? <TrendingUp size={14} /> : change && change < 0 ? <TrendingDown size={14} /> : null}
                {fmtPctSigned(change, 2)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom: Sparkline & Stats */}
      <div className="mt-3 flex items-center gap-4">
        <div className="flex-1">
          {price && (
            <Sparkline
              data={[
                price.fifty_two_week_low || price.close * 0.8,
                price.close,
                price.fifty_two_week_high || price.close * 1.2,
              ]}
              width={200}
              height={30}
              color={change && change > 0 ? COLORS.up : change && change < 0 ? COLORS.down : COLORS.text1}
            />
          )}
        </div>
        <div className="flex gap-3 text-2xs text-text-tertiary">
          <div>
            <span className="text-text-secondary">PE:</span> {fmtNum(price?.pe_ratio, 1)}x
          </div>
          <div>
            <span className="text-text-secondary">量:</span> {fmtCap(price?.volume, 0)}
          </div>
        </div>
      </div>

      {/* Latest Earnings Badge */}
      {snapshot?.latest_earnings && (
        <div className="mt-2 flex items-center gap-2 border-t border-border-soft/50 pt-2">
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-2xs text-accent">财报</span>
          <span className="text-2xs text-text-secondary">
            {fmtDay(snapshot.latest_earnings.date)} · EPS {fmtNum(snapshot.latest_earnings.eps_actual, 2)}
          </span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-soft/50 pt-2 text-2xs">
        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-text-secondary">
          覆盖 {coverage == null ? "—" : `${Math.round(coverage * 100)}%`}
        </span>
        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-text-secondary">
          SEC {(snapshot?.sec_by_form ?? []).reduce((sum, row) => sum + row.rows, 0)}
        </span>
        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-text-secondary">
          内部人90天 {snapshot?.insider_rows_90d ?? 0}
        </span>
        <Link to={`/symbol/${symbol}/events`} className="ml-auto text-accent hover:underline">
          事件页
        </Link>
      </div>
    </div>
  );
}
