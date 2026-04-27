import { useQuery } from "@tanstack/react-query";
import { Calendar, Users, FileText, Filter, TrendingUp, DollarSign, Scissors, Building2 } from "lucide-react";
import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { api, endpoints } from "@/lib/api";
import type { EventsStreamResponse } from "@/lib/types";
import { fmtDay, fmtCap } from "@/lib/format";
import { cn } from "@/lib/cn";
import { COLORS } from "@/lib/theme";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { Timeline, type TimelineEvent } from "@/components/ui/Timeline";
import { CalendarHeatmap } from "@/components/charts/CalendarHeatmap";

type EventFilter = "all" | "earnings" | "insider" | "dividend" | "split" | "sec";

const EVENT_TYPES: Array<{ key: EventFilter; label: string; icon: ReactNode; color: string }> = [
  { key: "all", label: "全部", icon: <Filter size={14} />, color: "text-text-secondary" },
  { key: "earnings", label: "财报", icon: <TrendingUp size={14} />, color: "text-accent" },
  { key: "insider", label: "内部人", icon: <Users size={14} />, color: "text-pink" },
  { key: "dividend", label: "分红", icon: <DollarSign size={14} />, color: "text-up" },
  { key: "split", label: "拆股", icon: <Scissors size={14} />, color: "text-warn" },
  { key: "sec", label: "SEC", icon: <FileText size={14} />, color: "text-text-secondary" },
];

export function EventStreamPage() {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const {  data, isLoading } = useQuery({
    queryKey: ["events-stream"],
    queryFn: () => api.get<EventsStreamResponse>(endpoints.eventsStream(), { params: { limit: 100 } }),
    staleTime: 60_000,
  });

  const earnings = data?.earnings ?? [];
  const insiderTrades = data?.insider ?? [];
  const secFilings = data?.sec_filings ?? [];

  // Prepare calendar data
  const calendarData = useMemo(() => {
    const dateMap = new Map<string, number>();

    earnings.forEach((e) => {
      dateMap.set(e.date, (dateMap.get(e.date) || 0) + 1);
    });
    insiderTrades.forEach((i) => {
      const date = i.filing_date || i.transaction_date;
      if (date) {
        dateMap.set(date, (dateMap.get(date) || 0) + 1);
      }
    });
    secFilings.forEach((s) => {
      if (s.filing_date) {
        dateMap.set(s.filing_date, (dateMap.get(s.filing_date) || 0) + 1);
      }
    });

    return Array.from(dateMap.entries()).map(([date, value]) => ({ date, value }));
  }, [earnings, insiderTrades, secFilings]);

  // Filter events
  const filteredEarnings = useMemo(() => {
    if (filter !== "all" && filter !== "earnings") return [];
    if (!symbolFilter) return earnings;
    return earnings.filter((e) => e.symbol === symbolFilter);
  }, [earnings, filter, symbolFilter]);

  const filteredInsider = useMemo(() => {
    if (filter !== "all" && filter !== "insider") return [];
    if (!symbolFilter) return insiderTrades;
    return insiderTrades.filter((i) => i.symbol === symbolFilter);
  }, [insiderTrades, filter, symbolFilter]);

  const filteredSec = useMemo(() => {
    if (filter !== "all" && filter !== "sec") return [];
    if (!symbolFilter) return secFilings;
    return secFilings.filter((s) => s.symbol === symbolFilter);
  }, [secFilings, filter, symbolFilter]);

  // Convert to timeline events
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];

    filteredEarnings.forEach((e, i) => {
      const surprise =
        e.eps_estimated != null && e.eps_estimated !== 0 && e.eps_actual != null
          ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
          : null;

      events.push({
        id: `earnings-${e.symbol}-${i}`,
        date: e.date,
        type: "earnings",
        title: `${e.symbol} 财报`,
        description: e.company_name,
        symbol: e.symbol,
        value: e.eps_actual != null ? `EPS ${e.eps_actual.toFixed(2)}` : undefined,
        change: surprise ?? undefined,
      });
    });

    filteredInsider.forEach((ins, i) => {
      const isBuy = ins.transaction_type?.toLowerCase().includes("buy");
      events.push({
        id: `insider-${ins.symbol}-${i}`,
        date: ins.filing_date || ins.transaction_date || "",
        type: "insider",
        title: `${ins.symbol} 内部人${isBuy ? "买入" : "交易"}`,
        description: ins.reporting_name || undefined,
        symbol: ins.symbol,
        value: ins.securities_transacted ? `${fmtCap(ins.securities_transacted, 0)}股` : undefined,
      });
    });

    filteredSec.forEach((s, i) => {
      events.push({
        id: `sec-${s.symbol}-${i}`,
        date: s.filing_date || "",
        type: "sec",
        title: `${s.symbol} ${s.form_type}`,
        description: s.company_name,
        symbol: s.symbol,
        value: s.fiscal_year ? `FY${s.fiscal_year}` : undefined,
      });
    });

    // Filter by selected date
    if (selectedDate) {
      return events.filter((e) => e.date === selectedDate);
    }

    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredEarnings, filteredInsider, filteredSec, selectedDate]);

  // Stats
  const stats = {
    total: earnings.length + insiderTrades.length + secFilings.length,
    earnings: earnings.length,
    insider: insiderTrades.length,
    sec: secFilings.length,
  };

  const topSymbols = useMemo(() => {
    const counts = new Map<string, number>();
    [...earnings, ...insiderTrades, ...secFilings].forEach((event) => {
      if (!event.symbol) return;
      counts.set(event.symbol, (counts.get(event.symbol) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [earnings, insiderTrades, secFilings]);

  const recentRisk = timelineEvents.filter((event) => {
    const ts = new Date(event.date).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= Date.now() - 14 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="事件雷达"
        description={`按事件类型、日期和标的联动下钻。当前筛选下近 14 天有 ${recentRisk} 条事件，点击日历或时间线可以继续收窄范围。`}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="总事件" value={stats.total} color="text-text-primary" />
        <StatCard label="财报" value={stats.earnings} color="text-accent" />
        <StatCard label="内部人" value={stats.insider} color="text-pink" />
        <StatCard label="SEC申报" value={stats.sec} color="text-text-secondary" />
      </div>

      {/* Calendar Heatmap */}
      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            <Calendar size={14} />
            <span>事件日历</span>
          </div>
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="text-2xs text-accent hover:underline"
            >
              显示全部
            </button>
          )}
        </div>
        <CalendarHeatmap data={calendarData} height={160} onDateClick={setSelectedDate} />
        {selectedDate && (
          <div className="mt-2 text-center text-sm text-text-secondary">
            已选择: <span className="font-mono text-text-primary">{selectedDate}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-3 lg:col-span-2">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            近期风险密度
          </div>
          <div className="grid grid-cols-3 gap-2">
            <RiskBox label="当前筛选事件" value={timelineEvents.length} hint="受类型/日期/标的筛选影响" />
            <RiskBox label="近14天" value={recentRisk} hint="近期需要重点跟踪" />
            <RiskBox label="日历覆盖" value={calendarData.length} hint="有事件的交易日/自然日" />
          </div>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            重点标的
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topSymbols.length === 0 ? (
              <span className="text-xs text-text-tertiary">暂无可聚合标的</span>
            ) : (
              topSymbols.map(([sym, count]) => (
                <button
                  key={sym}
                  type="button"
                  className={cn(
                    "chip",
                    symbolFilter === sym ? "border-accent/40 bg-accent/10 text-accent" : "",
                  )}
                  onClick={() => setSymbolFilter(sym)}
                >
                  {sym} <span className="text-2xs text-text-tertiary">{count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          事件筛选
        </div>
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPES.map((type) => (
            <button
              key={type.key}
              type="button"
              onClick={() => setFilter(type.key)}
              className={cn(
                "chip flex items-center gap-1.5",
                filter === type.key ? "border-accent/40 bg-accent/10 text-accent" : ""
              )}
            >
              <span className={type.color}>{type.icon}</span>
              <span>{type.label}</span>
            </button>
          ))}
        </div>

        {/* Symbol Filter */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-2xs text-text-tertiary">标的筛选:</span>
          {symbolFilter ? (
            <button
              type="button"
              onClick={() => setSymbolFilter("")}
              className="chip border-accent/40 bg-accent/10 text-accent"
            >
              {symbolFilter} ✕
            </button>
          ) : (
            <>
              {Array.from(new Set([...earnings, ...insiderTrades, ...secFilings].map((x) => x.symbol)))
                .filter(Boolean)
                .slice(0, 10)
                .map((sym) => (
                  <button key={sym} type="button" className="chip" onClick={() => setSymbolFilter(sym)}>
                    {sym}
                  </button>
                ))}
            </>
          )}
        </div>
      </div>

      {/* Event Timeline */}
      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            事件时间轴
            {selectedDate && (
              <span className="ml-2 normal-case text-text-secondary">({selectedDate})</span>
            )}
          </div>
          <span className="text-2xs text-text-tertiary">{timelineEvents.length} 条事件</span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-text-tertiary">加载中...</div>
        ) : timelineEvents.length === 0 ? (
          <EmptyDataState
            title="当前筛选下无事件"
            detail="尝试切换筛选条件或清除标的筛选。"
            actions={
              <>
                <button type="button" className="chip" onClick={() => setFilter("all")}>
                  全部事件
                </button>
                <button type="button" className="chip" onClick={() => setSymbolFilter("")}>
                  清除标的
                </button>
              </>
            }
          />
        ) : (
          <Timeline
            events={timelineEvents.slice(0, 20)}
            onEventClick={(event) => {
              if (event.symbol) {
                setSymbolFilter(event.symbol);
              }
            }}
          />
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/global/data-assets?table=earnings_calendar" className="card card-hover p-3 text-center">
          <TrendingUp size={20} className="mx-auto mb-1 text-accent" />
          <div className="text-xs text-text-secondary">财报覆盖</div>
        </Link>
        <Link to="/global/data-assets?table=insider_trades" className="card card-hover p-3 text-center">
          <Users size={20} className="mx-auto mb-1 text-pink" />
          <div className="text-xs text-text-secondary">内部人覆盖</div>
        </Link>
        <Link to="/global/data-assets?table=dividend_calendar" className="card card-hover p-3 text-center">
          <DollarSign size={20} className="mx-auto mb-1 text-up" />
          <div className="text-xs text-text-secondary">分红数据</div>
        </Link>
        <Link to="/global/data-assets?table=sec_files" className="card card-hover p-3 text-center">
          <Building2 size={20} className="mx-auto mb-1 text-text-secondary" />
          <div className="text-xs text-text-secondary">SEC覆盖</div>
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold", color)}>{value}</div>
    </div>
  );
}

function RiskBox({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-2/50 p-2">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-1 font-mono text-lg text-text-primary">{value}</div>
      <div className="mt-1 text-2xs text-text-tertiary">{hint}</div>
    </div>
  );
}
