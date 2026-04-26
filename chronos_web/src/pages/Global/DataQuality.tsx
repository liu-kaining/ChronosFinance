import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Database, AlertTriangle, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";

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
        { label: "利润表", completed: syncProgress.active_with_income_synced, total: syncProgress.active_symbols },
        { label: "资产负债表", completed: syncProgress.active_with_balance_synced, total: syncProgress.active_symbols },
        { label: "现金流量表", completed: syncProgress.active_with_cashflow_synced, total: syncProgress.active_symbols },
        { label: "日线行情", completed: syncProgress.active_with_prices_synced, total: syncProgress.active_symbols },
        { label: "财报日历 / EPS", completed: syncProgress.active_with_earnings_synced, total: syncProgress.active_symbols },
        { label: "内部人交易", completed: syncProgress.active_with_insider_synced, total: syncProgress.active_symbols },
        { label: "分析师预期", completed: syncProgress.active_with_estimates_synced, total: syncProgress.active_symbols },
        { label: "SEC 申报", completed: syncProgress.active_with_filings_synced, total: syncProgress.active_symbols },
      ]
    : [];

  const gapItems = progressItems
    .map((p) => ({ ...p, missing: Math.max((p.total ?? 0) - (p.completed ?? 0), 0) }))
    .filter((p) => p.missing > 0)
    .sort((a, b) => b.missing - a.missing);

  return (
    <div className="flex flex-col gap-4">
      {/* Overview stats */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Database size={12} />
            <span>标的总数</span>
          </div>
          <div className="kpi-num">{fmtNum(stats?.universe.total, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <CheckCircle size={12} />
            <span>交易中</span>
          </div>
          <div className="kpi-num text-up">{fmtNum(stats?.universe.active, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <AlertTriangle size={12} />
            <span>未活跃</span>
          </div>
          <div className="kpi-num text-text-tertiary">{fmtNum(stats?.universe.inactive, 0)}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <ShieldCheck size={12} />
            <span>核心表行数（估）</span>
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
          活跃标的数据集覆盖
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

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          剩余缺口（按缺失数排序）
        </div>
        {gapItems.length === 0 ? (
          <div className="text-xs text-up">当前跟踪的数据集在活跃标的上已全部覆盖。</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">数据集</th>
                <th className="px-2 py-1.5 text-right">已覆盖</th>
                <th className="px-2 py-1.5 text-right">缺失</th>
              </tr>
            </thead>
            <tbody>
              {gapItems.map((g, idx) => (
                <tr key={g.label} className={idx % 2 === 0 ? "bg-bg-2/30" : ""}>
                  <td className="px-2 py-1.5 text-text-secondary">{g.label}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtNum(g.completed, 0)} / {fmtNum(g.total, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-down">{fmtNum(g.missing, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Table counts */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          主表行数（与 /stats/overview 一致）
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TableCount label="日线" count={stats?.tables.daily_prices} />
          <TableCount label="财务长表" count={stats?.tables.static_financials} />
          <TableCount label="财报/日历" count={stats?.tables.earnings_calendar} />
          <TableCount label="内部人" count={stats?.tables.insider_trades} />
          <TableCount label="分析师" count={stats?.tables.analyst_estimates} />
          <TableCount label="SEC" count={stats?.tables.sec_files} />
          <TableCount label="公司行为" count={stats?.tables.corporate_actions} />
          <TableCount label="宏观" count={stats?.tables.macro_economics} />
        </div>
        <div className="mt-3 text-2xs text-text-tertiary">
          需要看「全库物理表、空表原因、是否已做进界面」请打开{" "}
          <Link to="/global/data-assets" className="text-accent hover:underline">
            数据资产
          </Link>
          。
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
