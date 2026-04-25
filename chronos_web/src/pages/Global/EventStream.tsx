import { useQuery } from "@tanstack/react-query";
import { Calendar, Users } from "lucide-react";
import { useState } from "react";

import { api, endpoints } from "@/lib/api";
import type { EventsStreamResponse } from "@/lib/types";
import { fmtDay, fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export function EventStreamPage() {
  const [open, setOpen] = useState({
    earnings: true,
    insider: true,
    sec: true,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["events-stream"],
    queryFn: () => api.get<EventsStreamResponse>(endpoints.eventsStream(), { params: { limit: 40 } }),
    staleTime: 60_000,
  });

  const earnings = data?.earnings ?? [];
  const insiderTrades = data?.insider ?? [];
  const secFilings = data?.sec_filings ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="card grid grid-cols-3 gap-3 p-3 text-center">
        <div>
          <div className="text-2xs text-text-tertiary">Earnings Items</div>
          <div className="kpi-num">{earnings.length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">Insider Items</div>
          <div className="kpi-num">{insiderTrades.length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">SEC Items</div>
          <div className="kpi-num">{secFilings.length}</div>
        </div>
      </div>

      {/* Recent earnings */}
      <div className="card p-3">
        <button
          type="button"
          className="mb-3 flex w-full items-center justify-between text-sm font-medium text-text-primary"
          onClick={() => setOpen((s) => ({ ...s, earnings: !s.earnings }))}
        >
          <span className="flex items-center gap-2">
            <Calendar size={16} />
            <span>Recent Earnings</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.earnings ? "Hide" : "Show"}</span>
        </button>
        {!open.earnings ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">Loading...</div>
        ) : earnings.length === 0 ? (
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
        <button
          type="button"
          className="mb-3 flex w-full items-center justify-between text-sm font-medium text-text-primary"
          onClick={() => setOpen((s) => ({ ...s, insider: !s.insider }))}
        >
          <span className="flex items-center gap-2">
            <Users size={16} />
            <span>Recent Insider Trades</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.insider ? "Hide" : "Show"}</span>
        </button>
        {!open.insider ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">Loading...</div>
        ) : insiderTrades.length === 0 ? (
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

      <div className="card p-3">
        <button
          type="button"
          className="mb-3 flex w-full items-center justify-between text-sm font-medium text-text-primary"
          onClick={() => setOpen((s) => ({ ...s, sec: !s.sec }))}
        >
          <span className="flex items-center gap-2">
            <Calendar size={16} />
            <span>Recent SEC Filings</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.sec ? "Hide" : "Show"}</span>
        </button>
        {!open.sec ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">Loading...</div>
        ) : secFilings.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-tertiary">No SEC data</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">Symbol</th>
                <th className="px-2 py-1.5">Form</th>
                <th className="px-2 py-1.5">Filing Date</th>
                <th className="px-2 py-1.5 text-right">FY</th>
              </tr>
            </thead>
            <tbody>
              {secFilings.slice(0, 20).map((s, i) => (
                <tr
                  key={`${s.symbol}-${s.form_type}-${s.filing_date}-${i}`}
                  className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                >
                  <td className="px-2 py-1.5">
                    <a href={`/symbol/${s.symbol}/sec`} className="ticker text-text-primary hover:text-accent">
                      {s.symbol}
                    </a>
                  </td>
                  <td className="px-2 py-1.5 text-text-secondary">{s.form_type}</td>
                  <td className="px-2 py-1.5 font-mono text-text-secondary">{fmtDay(s.filing_date)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">{s.fiscal_year ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
