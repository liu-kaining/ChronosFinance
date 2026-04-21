import { useQuery } from "@tanstack/react-query";
import { Calendar, Users } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { EarningsSeriesResponse, InsiderSeriesResponse, UniversePage } from "@/lib/types";
import { fmtDay, fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export function EventStreamPage() {
  const { data: universe } = useQuery({
    queryKey: ["universe-events"],
    queryFn: () =>
      api.get<UniversePage>(endpoints.universe(), {
        params: { limit: 50, active_only: true },
      }),
    staleTime: 60_000,
  });

  // Fetch recent events for first few symbols
  const symbols = (universe?.items ?? []).slice(0, 20).map((u) => u.symbol);

  const earningsQueries = useQuery({
    queryKey: ["earnings-stream", symbols.join(",")],
    queryFn: async () => {
      const allEarnings: Array<{ symbol: string; date: string; eps_actual: number | null; eps_estimated: number | null }> = [];
      for (const sym of symbols.slice(0, 10)) {
        try {
          const data = await api.get<EarningsSeriesResponse>(endpoints.earnings(sym), { params: { limit: 5 } });
          for (const e of data.items ?? []) {
            allEarnings.push({
              symbol: sym,
              date: e.date,
              eps_actual: e.eps_actual,
              eps_estimated: e.eps_estimated,
            });
          }
        } catch {
          // skip
        }
      }
      return allEarnings.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    },
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
  });

  const insiderQueries = useQuery({
    queryKey: ["insider-stream", symbols.join(",")],
    queryFn: async () => {
      const allInsider: Array<{ symbol: string; filing_date: string | null; reporting_name: string | null; transaction_type: string | null; securities_transacted: number | null }> = [];
      for (const sym of symbols.slice(0, 10)) {
        try {
          const data = await api.get<InsiderSeriesResponse>(endpoints.insider(sym), { params: { limit: 5 } });
          for (const ins of data.items ?? []) {
            allInsider.push({
              symbol: sym,
              filing_date: ins.filing_date,
              reporting_name: ins.reporting_name,
              transaction_type: ins.transaction_type,
              securities_transacted: ins.securities_transacted,
            });
          }
        } catch {
          // skip
        }
      }
      return allInsider.sort((a, b) => (b.filing_date ?? "").localeCompare(a.filing_date ?? "")).slice(0, 20);
    },
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
  });

  const earnings = earningsQueries.data ?? [];
  const insiderTrades = insiderQueries.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Recent earnings */}
      <div className="card p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
          <Calendar size={16} />
          <span>Recent Earnings</span>
        </div>
        {earnings.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-tertiary">No earnings data</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">Symbol</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5 text-right">EPS Est</th>
                <th className="px-2 py-1.5 text-right">EPS Actual</th>
                <th className="px-2 py-1.5 text-right">Surprise</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((e, i) => {
                const surprise = e.eps_estimated && e.eps_actual
                  ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
                  : null;
                return (
                  <tr key={`${e.symbol}-${e.date}-${i}`} className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}>
                    <td className="px-2 py-1.5">
                      <a href={`/symbol/${e.symbol}/events`} className="ticker text-text-primary hover:text-accent">
                        {e.symbol}
                      </a>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-text-secondary">{fmtDay(e.date)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">{fmtNum(e.eps_estimated, 2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-primary">{fmtNum(e.eps_actual, 2)}</td>
                    <td className={cn("px-2 py-1.5 text-right font-mono", surprise !== null && surprise >= 0 ? "text-up" : "text-down")}>
                      {surprise !== null ? `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent insider trades */}
      <div className="card p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
          <Users size={16} />
          <span>Recent Insider Trades</span>
        </div>
        {insiderTrades.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-tertiary">No insider data</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">Symbol</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Insider</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5 text-right">Shares</th>
              </tr>
            </thead>
            <tbody>
              {insiderTrades.map((ins, i) => (
                <tr key={`${ins.symbol}-${ins.filing_date}-${i}`} className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}>
                  <td className="px-2 py-1.5">
                    <a href={`/symbol/${ins.symbol}/events`} className="ticker text-text-primary hover:text-accent">
                      {ins.symbol}
                    </a>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-text-secondary">{fmtDay(ins.filing_date)}</td>
                  <td className="max-w-[150px] truncate px-2 py-1.5 text-text-secondary">
                    {ins.reporting_name ?? "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn(
                      "rounded px-1 py-0.5 text-2xs",
                      ins.transaction_type?.toLowerCase().includes("buy") ? "bg-up-soft text-up" :
                      ins.transaction_type?.toLowerCase().includes("sell") ? "bg-down-soft text-down" :
                      "bg-bg-3 text-text-secondary"
                    )}>
                      {ins.transaction_type ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtCap(ins.securities_transacted, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
