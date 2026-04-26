import { useQuery } from "@tanstack/react-query";
import { Calendar, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api, endpoints } from "@/lib/api";
import type { EventsStreamResponse } from "@/lib/types";
import { fmtDay, fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

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
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const earningsFiltered = symbolFilter ? earnings.filter((e) => e.symbol === symbolFilter) : earnings;
  const insiderFiltered = symbolFilter ? insiderTrades.filter((i) => i.symbol === symbolFilter) : insiderTrades;
  const secFiltered = symbolFilter ? secFilings.filter((s) => s.symbol === symbolFilter) : secFilings;

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="全局事件叙事"
        description="先看财报超预期扩散，再看内部人交易方向，最后核验 SEC 披露密度，判断主题是加速还是退潮。"
      />

      <div className="card grid grid-cols-3 gap-3 p-3 text-center">
        <div>
          <div className="text-2xs text-text-tertiary">财报项</div>
          <div className="kpi-num">{earnings.length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">内部人项</div>
          <div className="kpi-num">{insiderTrades.length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">SEC 项</div>
          <div className="kpi-num">{secFilings.length}</div>
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">事件下钻筛选</div>
        <div className="flex flex-wrap items-center gap-2">
          {symbolFilter ? (
            <button
              type="button"
              onClick={() => setSymbolFilter("")}
              className="chip border-accent/40 bg-accent/10 text-accent"
            >
              当前标的：{symbolFilter}（清除）
            </button>
          ) : (
            <span className="chip">未选标的（展示全市场）</span>
          )}
          {[...earnings, ...insiderTrades, ...secFilings]
            .map((x) => x.symbol)
            .filter((s, i, arr) => !!s && arr.indexOf(s) === i)
            .slice(0, 12)
            .map((sym) => (
              <button key={sym} type="button" className="chip" onClick={() => setSymbolFilter(sym)}>
                {sym}
              </button>
            ))}
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
            <span>近期财报</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.earnings ? "收起" : "展开"}</span>
        </button>
        {!open.earnings ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">加载中…</div>
        ) : earningsFiltered.length === 0 ? (
          <EmptyDataState
            title="当前筛选下暂无财报数据"
            detail="可清除标的筛选，或到个股事件页查看更完整时间序列。"
            actions={
              <>
                <button type="button" className="chip" onClick={() => setSymbolFilter("")}>清除筛选</button>
                <Link to="/global/data-assets?table=earnings_calendar" className="chip">查看财报覆盖</Link>
              </>
            }
          />
        ) : (
          <table className="table-modern">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">代码</th>
                <th className="px-2 py-1.5">日期</th>
                <th className="px-2 py-1.5 text-right">EPS 预期</th>
                <th className="px-2 py-1.5 text-right">EPS 实际</th>
                <th className="px-2 py-1.5 text-right">超预期</th>
              </tr>
            </thead>
            <tbody>
              {earningsFiltered.map((e, i) => {
                const surprise = e.eps_estimated && e.eps_actual
                  ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
                  : null;
                return (
                  <tr
                    key={`${e.symbol}-${e.date}-${i}`}
                    className={cn("border-b border-border-soft/50 hover:bg-bg-2/60", i % 2 === 0 ? "bg-bg-2/30" : "")}
                  >
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
            <span>近期内部人交易</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.insider ? "收起" : "展开"}</span>
        </button>
        {!open.insider ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">加载中…</div>
        ) : insiderFiltered.length === 0 ? (
          <EmptyDataState
            title="当前筛选下暂无内部人数据"
            detail="可切换其它标的或查看全市场内部人交易。"
            actions={
              <>
                <button type="button" className="chip" onClick={() => setSymbolFilter("")}>清除筛选</button>
                <Link to="/global/data-assets?table=insider_trades" className="chip">查看内部人覆盖</Link>
              </>
            }
          />
        ) : (
          <table className="table-modern">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">代码</th>
                <th className="px-2 py-1.5">日期</th>
                <th className="px-2 py-1.5">主体</th>
                <th className="px-2 py-1.5">类型</th>
                <th className="px-2 py-1.5 text-right">股数</th>
              </tr>
            </thead>
            <tbody>
              {insiderFiltered.map((ins, i) => (
                <tr key={`${ins.symbol}-${ins.filing_date}-${i}`} className={cn("border-b border-border-soft/50 hover:bg-bg-2/60", i % 2 === 0 ? "bg-bg-2/30" : "")}>
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
            <span>近期 SEC 申报</span>
          </span>
          <span className="text-xs text-text-tertiary">{open.sec ? "收起" : "展开"}</span>
        </button>
        {!open.sec ? null : isLoading ? (
          <div className="py-4 text-center text-xs text-text-tertiary">加载中…</div>
        ) : secFiltered.length === 0 ? (
          <EmptyDataState
            title="当前筛选下暂无 SEC 数据"
            detail="可先清除筛选，或去 SEC 覆盖页确认数据同步状态。"
            actions={
              <>
                <button type="button" className="chip" onClick={() => setSymbolFilter("")}>清除筛选</button>
                <Link to="/global/data-assets?table=sec_files" className="chip">查看 SEC 覆盖</Link>
              </>
            }
          />
        ) : (
          <table className="table-modern">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">代码</th>
                <th className="px-2 py-1.5">表单</th>
                <th className="px-2 py-1.5">申报日期</th>
                <th className="px-2 py-1.5 text-right">财年</th>
              </tr>
            </thead>
            <tbody>
              {secFiltered.slice(0, 20).map((s, i) => (
                <tr
                  key={`${s.symbol}-${s.form_type}-${s.filing_date}-${i}`}
                  className={cn("border-b border-border-soft/50 hover:bg-bg-2/60", i % 2 === 0 ? "bg-bg-2/30" : "")}
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
