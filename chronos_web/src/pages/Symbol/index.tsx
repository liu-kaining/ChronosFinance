import { Outlet, useParams, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Receipt,
  CalendarClock,
  DollarSign,
  Users,
  FileText,
  Code2,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SymbolSnapshotResponse } from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { zh } from "@/lib/i18n-zh";

const TABS = [
  { to: "price", label: zh.symbolTabs.price, icon: <LineChart size={14} /> },
  { to: "financials", label: zh.symbolTabs.financials, icon: <Receipt size={14} /> },
  { to: "events", label: zh.symbolTabs.events, icon: <CalendarClock size={14} /> },
  { to: "valuation", label: zh.symbolTabs.valuation, icon: <DollarSign size={14} /> },
  { to: "peers", label: zh.symbolTabs.peers, icon: <Users size={14} /> },
  { to: "sec", label: zh.symbolTabs.sec, icon: <FileText size={14} /> },
  { to: "raw", label: zh.symbolTabs.raw, icon: <Code2 size={14} /> },
];

export function SymbolLayout() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ["symbolSnapshot", sym],
    queryFn: () => api.get<SymbolSnapshotResponse>(endpoints.symbolSnapshot(sym)),
    enabled: !!sym,
    staleTime: 30_000,
  });

  const universe = snapshot?.universe;
  const latestPrice = snapshot?.latest_price;
  const changePct = latestPrice?.change_pct;
  const isPositive = (changePct ?? 0) >= 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Enhanced Hero Header */}
      <header className="card px-4 py-3">
        <div className="flex items-center gap-6">
          {/* Left: Ticker + Company + Sector */}
          <div className="flex flex-col min-w-[160px]">
            <div className="ticker text-2xl text-text-primary">{sym}</div>
            {isLoading ? (
              <div className="h-4 w-32 animate-pulse rounded bg-bg-3" />
            ) : (
              <div className="text-sm text-text-secondary">
                {universe?.company_name ?? "—"}
              </div>
            )}
            {universe?.sector && (
              <span className="mt-1 inline-flex items-center rounded-full bg-bg-2 px-2 py-0.5 text-2xs text-text-secondary w-fit">
                {universe.sector}
              </span>
            )}
          </div>

          {/* Center: Price + Change */}
          <div className="flex flex-col items-center flex-1">
            {latestPrice?.close != null ? (
              <>
                <div className="font-mono text-2xl font-semibold text-text-primary">
                  {fmtNum(latestPrice.close, 2)}
                </div>
                <div className={cn(
                  "font-mono text-sm font-medium",
                  isPositive ? "text-up" : "text-down"
                )}>
                  {fmtPctSigned(changePct, 2)}
                </div>
                {latestPrice.date && (
                  <div className="text-2xs text-text-tertiary mt-0.5">{latestPrice.date}</div>
                )}
              </>
            ) : (
              <div className="text-sm text-text-tertiary">暂无价格数据</div>
            )}
          </div>

          {/* Right: Key Metrics */}
          <div className="flex gap-6">
            <MetricItem label={zh.field.marketCap} value={fmtCap(universe?.market_cap)} />
            <MetricItem label={zh.field.exchange} value={universe?.exchange ?? "—"} />
            {snapshot?.synced_flags_total != null && (
              <MetricItem
                label="数据覆盖"
                value={`${snapshot.synced_flags_true}/${snapshot.synced_flags_total}`}
              />
            )}
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 border-b border-border-soft px-2 overflow-x-auto">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={`/symbol/${sym}/${t.to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors whitespace-nowrap",
                isActive
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-secondary hover:border-border hover:text-text-primary",
              )
            }
          >
            {t.icon}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col text-right">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="font-mono text-sm text-text-secondary">{value}</div>
    </div>
  );
}
