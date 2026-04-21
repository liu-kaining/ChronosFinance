import { Outlet, useParams, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  LineChart,
  Receipt,
  CalendarClock,
  Users,
  FileText,
  Code2,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SymbolInventory } from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmtCap } from "@/lib/format";

const TABS = [
  { to: "overview", label: "Overview", icon: <LayoutDashboard size={14} /> },
  { to: "chart", label: "Chart", icon: <LineChart size={14} /> },
  { to: "financials", label: "Financials", icon: <Receipt size={14} /> },
  { to: "events", label: "Events", icon: <CalendarClock size={14} /> },
  { to: "analyst", label: "Analyst", icon: <Users size={14} /> },
  { to: "peers", label: "Peers", icon: <Users size={14} /> },
  { to: "sec", label: "SEC", icon: <FileText size={14} /> },
  { to: "raw", label: "Raw", icon: <Code2 size={14} /> },
];

export function SymbolLayout() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: inv, isLoading } = useQuery({
    queryKey: ["inventory", sym],
    queryFn: () => api.get<SymbolInventory>(endpoints.symbolInventory(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Hero header */}
      <header className="card flex items-center gap-4 px-4 py-3">
        <div className="flex flex-col">
          <div className="ticker text-xl text-text-primary">{sym}</div>
          {isLoading ? (
            <div className="h-4 w-32 animate-pulse rounded bg-bg-3" />
          ) : (
            <div className="text-sm text-text-secondary">
              {inv?.company_name ?? "—"}
            </div>
          )}
        </div>
        <div className="flex flex-col text-right">
          <div className="text-xs text-text-tertiary">Sector</div>
          <div className="text-sm text-text-secondary">
            {inv?.sector ?? "—"}
          </div>
        </div>
        <div className="flex flex-col text-right">
          <div className="text-xs text-text-tertiary">Market Cap</div>
          <div className="font-mono text-sm text-text-secondary">
            {fmtCap(inv?.market_cap)}
          </div>
        </div>
        <div className="flex flex-col text-right">
          <div className="text-xs text-text-tertiary">Exchange</div>
          <div className="text-sm text-text-secondary">
            {inv?.exchange ?? "—"}
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 border-b border-border-soft px-2">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={`/symbol/${sym}/${t.to}`}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
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
