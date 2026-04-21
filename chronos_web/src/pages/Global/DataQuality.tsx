import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Database, AlertTriangle, CheckCircle } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SyncProgressResponse, StatsOverview } from "@/lib/types";
import { fmtNum, fmtCap } from "@/lib/format";

export function DataQualityPage() {
  const { data: stats } = useQuery({
    queryKey: ["stats-overview"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });

  const { data: syncProgress, isLoading } = useQuery({
    queryKey: ["sync-progress"],
    queryFn: () => api.get<SyncProgressResponse>(endpoints.syncProgress()),
    staleTime: 60_000,
  });

  const progressItems = syncProgress
    ? [
        { label: "Income Statement", completed: syncProgress.active_with_income_synced, total: syncProgress.active_symbols },
        { label: "Balance Sheet", completed: syncProgress.active_with_balance_synced, total: syncProgress.active_symbols },
        { label: "Cash Flow", completed: syncProgress.active_with_cashflow_synced, total: syncProgress.active_symbols },
        { label: "Prices", completed: syncProgress.active_with_prices_synced, total: syncProgress.active_symbols },
        { label: "Earnings", completed: syncProgress.active_with_earnings_synced, total: syncProgress.active_symbols },
        { label: "Insider", completed: syncProgress.active_with_insider_synced, total: syncProgress.active_symbols },
        { label: "Estimates", completed: syncProgress.active_with_estimates_synced, total: syncProgress.active_symbols },
        { label: "SEC Filings", completed: syncProgress.active_with_filings_synced, total: syncProgress.active_symbols },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Overview stats */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Database size={12} />
            <span>Total Symbols</span>
          </div>
          <div className="kpi-num">{fmtNum(stats?.universe.total, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <CheckCircle size={12} />
            <span>Active</span>
          </div>
          <div className="kpi-num text-up">{fmtNum(stats?.universe.active, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <AlertTriangle size={12} />
            <span>Inactive</span>
          </div>
          <div className="kpi-num text-text-tertiary">{fmtNum(stats?.universe.inactive, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <ShieldCheck size={12} />
            <span>Data Rows</span>
          </div>
          <div className="kpi-num">
            {fmtCap(
              (stats?.tables.daily_prices ?? 0) +
              (stats?.tables.static_financials ?? 0) +
              (stats?.tables.earnings_calendar ?? 0),
              0
            )}
          </div>
        </div>
      </div>

      {/* Sync progress */}
      <div className="card p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Data Coverage (Active Symbols)
        </div>
        {isLoading ? (
          <div className="h-[200px] animate-pulse rounded bg-bg-3" />
        ) : (
          <div className="flex flex-col gap-3">
            {progressItems.map((item) => (
              <ProgressBar key={item.label} {...item} />
            ))}
          </div>
        )}
      </div>

      {/* Table counts */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Table Row Counts
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TableCount label="Daily Prices" count={stats?.tables.daily_prices} />
          <TableCount label="Financials" count={stats?.tables.static_financials} />
          <TableCount label="Earnings" count={stats?.tables.earnings_calendar} />
          <TableCount label="Insider" count={stats?.tables.insider_trades} />
          <TableCount label="Analyst" count={stats?.tables.analyst_estimates} />
          <TableCount label="SEC Files" count={stats?.tables.sec_files} />
          <TableCount label="Corp Actions" count={stats?.tables.corporate_actions} />
          <TableCount label="Macro" count={stats?.tables.macro_economics} />
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ label, completed, total }: { label: string; completed: number; total: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const pctFormatted = pct.toFixed(1);

  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs text-text-secondary">{label}</div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-3">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
      <div className="w-20 shrink-0 text-right font-mono text-2xs text-text-secondary">
        {fmtNum(completed, 0)} / {fmtNum(total, 0)}
      </div>
      <div className="w-12 shrink-0 text-right font-mono text-2xs text-text-tertiary">
        {pctFormatted}%
      </div>
    </div>
  );
}

function TableCount({ label, count }: { label: string; count?: number }) {
  return (
    <div className="rounded-md border border-border-soft bg-bg-2 px-3 py-2">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="font-mono text-sm text-text-primary">
        {count !== undefined ? fmtCap(count, 0) : "—"}
      </div>
    </div>
  );
}
