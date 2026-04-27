import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
  Database,
  ArrowRight,
  Zap,
  BarChart3,
} from "lucide-react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type {
  MarketSnapshotResponse,
  SectorTrendsResponse,
  EventsStreamResponse,
  StatsOverview,
} from "@/lib/types";
import { zh } from "@/lib/i18n-zh";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { COLORS, echartsBase, signalColor } from "@/lib/theme";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { Timeline } from "@/components/ui/Timeline";
import type { TimelineEvent } from "@/components/ui/Timeline";
import { Sparkline } from "@/components/ui/Sparkline";

const NAV_TILES = [
  {
    to: "/global/market-pulse",
    title: zh.nav.marketPulse,
    desc: "板块结构、涨跌幅榜、行业强弱排序。",
    icon: <BarChart3 className="text-accent" size={20} />,
    color: "border-accent/20 bg-accent/5",
  },
  {
    to: "/global/macro",
    title: zh.nav.macro,
    desc: "宏观序列、利率与增长相关指标。",
    icon: <LineChart className="text-accent-2" size={20} />,
    color: "border-accent-2/20 bg-accent-2/5",
  },
  {
    to: "/global/events",
    title: zh.nav.events,
    desc: "全市场事件：财报、公司行为、内幕等。",
    icon: <CalendarClock className="text-purple" size={20} />,
    color: "border-purple/20 bg-purple/5",
  },
];

export function WelcomePage() {
  const { data: stats } = useQuery({
    queryKey: ["welcome-stats"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });

  const { data: market } = useQuery({
    queryKey: ["welcome-market"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 5 } }),
    staleTime: 30_000,
  });

  const { data: sectorTrends } = useQuery({
    queryKey: ["welcome-sector-trends"],
    queryFn: () => api.get<SectorTrendsResponse>(endpoints.sectorTrends()),
    staleTime: 60_000,
  });

  const { data: events } = useQuery({
    queryKey: ["welcome-events"],
    queryFn: () => api.get<EventsStreamResponse>(endpoints.eventsStream(), { params: { limit: 20 } }),
    staleTime: 60_000,
  });

  const gainers = market?.top_gainers ?? [];
  const losers = market?.top_losers ?? [];
  const sectors = market?.sectors ?? [];
  const trends = sectorTrends?.trends ?? [];

  // Market sentiment calculation
  const positiveSectors = trends.filter((t) => (t.change_1d ?? 0) > 0).length;
  const totalSectors = Math.max(trends.length, 1);
  const sentimentRatio = positiveSectors / totalSectors;
  const sentiment =
    sentimentRatio >= 0.6 ? "风险偏好扩张" : sentimentRatio <= 0.4 ? "防御偏好抬升" : "震荡分化";
  const sentimentColor =
    sentimentRatio >= 0.6 ? "text-up" : sentimentRatio <= 0.4 ? "text-down" : "text-warn";

  // Convert events to timeline format
  const timelineEvents: TimelineEvent[] = [
    ...(events?.earnings?.slice(0, 5).map((e, i) => ({
      id: `earnings-${e.symbol}-${i}`,
      date: e.date,
      type: "earnings" as const,
      title: `${e.symbol} 财报`,
      description: e.company_name || undefined,
      symbol: e.symbol,
      value: e.eps_actual != null ? `EPS ${e.eps_actual.toFixed(2)}` : undefined,
      change:
        e.eps_estimated != null && e.eps_estimated !== 0 && e.eps_actual != null
          ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
          : undefined,
    })) ?? []),
    ...(events?.insider?.slice(0, 5).map((ins, i) => ({
      id: `insider-${ins.symbol}-${i}`,
      date: ins.filing_date || ins.transaction_date || "",
      type: "insider" as const,
      title: `${ins.symbol} 内部人${ins.transaction_type?.toLowerCase().includes("buy") ? "买入" : "交易"}`,
      description: ins.reporting_name || undefined,
      symbol: ins.symbol,
      value: ins.securities_transacted
        ? `${fmtCap(ins.securities_transacted, 0)}股`
        : undefined,
    })) ?? []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="mx-auto max-w-6xl py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-text-secondary">
          <Sparkles size={14} className="text-accent-2" />
          <span className="text-xs uppercase tracking-wider">Chronos Finance</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-text-primary">今日市场概览</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          先看全局，再下钻个股。按 <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">⌘K</kbd>{" "}
          搜索标的，按 <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">⌘J</kbd> 让 AI 辅助解释数据。
        </p>
      </div>

      {/* Market Status Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MarketStatusCard
          icon={<Activity size={16} className="text-accent" />}
          label="活跃标的"
          value={fmtNum(stats?.universe.active, 0)}
          sub={`总计 ${fmtNum(stats?.universe.total, 0)}`}
          to="/global/quality"
        />
        <MarketStatusCard
          icon={<Zap size={16} className={sentimentColor} />}
          label="市场情绪"
          value={sentiment}
          sub={`${positiveSectors}/${totalSectors} 板块上涨`}
        />
        <MarketStatusCard
          icon={<TrendingUp size={16} className="text-up" />}
          label="最强标的"
          value={gainers[0]?.symbol ?? "—"}
          sub={gainers[0]?.change_pct ? fmtPctSigned(gainers[0].change_pct, 2) : undefined}
          to={gainers[0]?.symbol ? `/symbol/${gainers[0].symbol}/overview` : undefined}
        />
        <MarketStatusCard
          icon={<TrendingDown size={16} className="text-down" />}
          label="最弱标的"
          value={losers[0]?.symbol ?? "—"}
          sub={losers[0]?.change_pct ? fmtPctSigned(losers[0].change_pct, 2) : undefined}
          to={losers[0]?.symbol ? `/symbol/${losers[0].symbol}/overview` : undefined}
        />
      </div>

      {/* Main Content Grid */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Sector Treemap */}
        <div className="card p-3 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              板块热力图
            </div>
            <Link to="/global/market-pulse" className="flex items-center gap-1 text-2xs text-accent hover:underline">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>
          <SectorTreemap sectors={sectors} />
        </div>

        {/* Event Timeline */}
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              今日事件
            </div>
            <Link to="/global/events" className="flex items-center gap-1 text-2xs text-accent hover:underline">
              查看全部 <ArrowRight size={12} />
            </Link>
          </div>
          <Timeline events={timelineEvents.slice(0, 6)} />
        </div>
      </div>

      {/* Movers & Navigation */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Gainers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-up">
            <TrendingUp size={16} />
            <span>涨幅榜</span>
          </div>
          <MoversList items={gainers.slice(0, 5)} />
        </div>

        {/* Losers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-down">
            <TrendingDown size={16} />
            <span>跌幅榜</span>
          </div>
          <MoversList items={losers.slice(0, 5)} />
        </div>

        {/* Quick Navigation */}
        <div className="space-y-3">
          {NAV_TILES.map((tile) => (
            <Link
              key={tile.to}
              to={tile.to}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-md",
                tile.color
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-2">
                {tile.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1 font-medium text-text-primary">
                  {tile.title}
                  <ArrowRight size={14} className="text-text-tertiary" />
                </div>
                <div className="mt-0.5 text-xs text-text-secondary">{tile.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* User Journey Guide */}
      <PageNarrative
        title="投资决策动线"
        description="按以下顺序使用系统，从全局到个股建立完整判断。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/global/market-pulse" className="chip border-accent/40 bg-accent/10 text-accent">
              ① 看板块强弱
            </Link>
            <Link to="/global/macro" className="chip border-accent-2/40 bg-accent-2/10 text-accent-2">
              ② 确认宏观环境
            </Link>
            <Link to="/global/events" className="chip border-purple/40 bg-purple/10 text-purple">
              ③ 发现事件驱动
            </Link>
            <span className="chip">④ 进入个股证据链</span>
          </div>
        }
      />
    </div>
  );
}

function MarketStatusCard({
  icon,
  label,
  value,
  sub,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  to?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-2">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xs text-text-tertiary">{label}</div>
        <div className="truncate text-sm font-medium text-text-primary">{value}</div>
        {sub && <div className="text-2xs text-text-secondary">{sub}</div>}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="card card-hover block p-3">
        {content}
      </Link>
    );
  }

  return <div className="card p-3">{content}</div>;
}

function MoversList({ items }: { items: MarketSnapshotResponse["top_gainers"] }) {
  if (items.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">暂无数据</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link
          key={item.symbol}
          to={`/symbol/${item.symbol}/overview`}
          className="flex items-center justify-between rounded-md border border-border-soft bg-bg-2/50 px-3 py-2 transition-colors hover:bg-bg-3"
        >
          <div>
            <span className="ticker text-sm text-text-primary">{item.symbol}</span>
            <div className="text-2xs text-text-secondary">{item.company_name}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm" style={{ color: signalColor(item.change_pct ?? null) }}>
              {fmtPctSigned(item.change_pct, 2)}
            </div>
            <div className="font-mono text-2xs text-text-tertiary">{fmtNum(item.close, 2)}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function SectorTreemap({
  sectors,
}: {
  sectors: MarketSnapshotResponse["sectors"];
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

  return <ReactECharts option={option} style={{ height: 200 }} />;
}
