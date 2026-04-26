import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Filter, BookOpen } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { TableInventoryResponse } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

const TABLE_DRILLDOWN_ROUTE: Record<string, string> = {
  daily_prices: "/global/market-pulse",
  static_financials: "/symbol/TMC/financials",
  earnings_calendar: "/global/events",
  insider_trades: "/global/events",
  analyst_estimates: "/symbol/TMC/analyst",
  sec_files: "/symbol/TMC/sec",
  corporate_actions: "/global/events",
  macro_economics: "/global/macro",
  stock_universe: "/",
};

export function DataAssetsPage() {
  const [searchParams] = useSearchParams();
  const { data, isLoading } = useQuery({
    queryKey: ["table-inventory"],
    queryFn: () => api.get<TableInventoryResponse>(endpoints.tableInventory()),
    staleTime: 120_000,
  });

  const presetTable = searchParams.get("table") ?? "";
  const [group, setGroup] = useState<string>(searchParams.get("group") ?? "");
  const [emptyOnly, setEmptyOnly] = useState(searchParams.get("empty") === "1");
  const [unexposedOnly, setUnexposedOnly] = useState(searchParams.get("unexposed") === "1");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of data?.items ?? []) s.add(it.group_zh);
    return Array.from(s).sort();
  }, [data?.items]);

  const rows = useMemo(() => {
    let r = data?.items ?? [];
    if (presetTable) r = r.filter((x) => x.table === presetTable);
    if (group) r = r.filter((x) => x.group_zh === group);
    if (emptyOnly) r = r.filter((x) => x.est_rows === 0);
    if (unexposedOnly) r = r.filter((x) => !x.exposed_in_ui);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      r = r.filter((x) => x.table.toLowerCase().includes(q) || x.name_zh.toLowerCase().includes(q));
    }
    return r.sort((a, b) => b.est_rows - a.est_rows);
  }, [data?.items, presetTable, group, emptyOnly, unexposedOnly, query]);

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="产品叙事 · 使用动线"
        description="先看全局环境，再定标的，按价格-财务-事件-预期公告下钻证据，最后回到本页核对表覆盖与空表原因。"
        actions={
          <>
            <span className="chip"><BookOpen size={12} /> 全库表资产台账</span>
            <Link to="/global/quality" className="chip">去同步覆盖</Link>
          </>
        }
      />
      <div className="card p-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>
            <b className="text-text-primary">看全局</b>：在「总览 / 市场脉动 / 宏观」了解指数、板块与数据新鲜度，回答「
            现在市场处在什么环境」。
          </li>
          <li>
            <b className="text-text-primary">定标的</b>：⌘K 搜代码进入个股「概览」，核对行情、行业、数据覆盖与最近业绩。
          </li>
          <li>
            <b className="text-text-primary">下钻证据</b>：按「价格 → 财务 → 业绩与事件 → 预期/公告」顺序，用同一标的串起时间线，避免
            孤立指标。
          </li>
          <li>
            <b className="text-text-primary">排雷与补数</b>：本页与「同步覆盖」对照：哪些表已有行数、是否已做界面；空表先查是否未跑
            ingest，而非当「没有业务」。
          </li>
        </ol>
      </div>

      {data?.diagnostics_zh && (
        <div className="card border-l-2 border-warn/60 bg-warn/5 p-3 text-sm text-text-secondary">
          <div className="mb-1 font-medium text-text-primary">空表 / 少数据 · 常见原因</div>
          <p className="whitespace-pre-wrap leading-relaxed">{data.diagnostics_zh}</p>
        </div>
      )}

      <div className="card border-l-2 border-accent/50 bg-accent/5 p-3 text-sm text-text-secondary">
        <div className="mb-1 font-medium text-text-primary">供应商能力提示（当前环境）</div>
        <p className="leading-relaxed">
          我们已验证部分端点在当前 FMP 路径下不可用（典型是个股新闻）。系统会将此类任务标记为
          <span className="mx-1 font-mono text-text-primary">skipped</span>
          或使用本地兜底，避免无限重试导致“卡住”。这类数据会在表格备注中明确标注为“数据源暂不支持”。
        </p>
      </div>

      <div className="card p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <Database size={14} />
          <span>物理表清单（行数为 PostgreSQL 估算值）</span>
          <Link to="/global/quality" className="ml-auto text-accent hover:underline">
            去「同步覆盖」
          </Link>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索表名/含义"
            className="w-full rounded border border-border-soft bg-bg-2 px-2 py-1 text-xs sm:w-48"
          />
          <div className="flex items-center gap-1">
            <Filter size={12} />
            <span className="text-2xs text-text-tertiary">分类</span>
            <select
              className="rounded border border-border-soft bg-bg-2 px-2 py-1 text-xs"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">全部分类</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-text-secondary">
            <input type="checkbox" checked={emptyOnly} onChange={(e) => setEmptyOnly(e.target.checked)} />
            仅空表
          </label>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={unexposedOnly}
              onChange={(e) => setUnexposedOnly(e.target.checked)}
            />
            未做界面
          </label>
          {presetTable ? (
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-2xs text-accent">
              仅查看：{presetTable}
            </span>
          ) : null}
          {(group || emptyOnly || unexposedOnly || query) ? (
            <button
              type="button"
              className="rounded border border-border-soft px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-3"
              onClick={() => {
                setGroup("");
                setEmptyOnly(false);
                setUnexposedOnly(false);
                setQuery("");
              }}
            >
              清空筛选
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="h-[240px] animate-pulse rounded bg-bg-3" />
        ) : (
          rows.length === 0 ? (
            <EmptyDataState
              title="当前筛选条件下没有匹配表"
              detail="可放宽筛选条件，或前往同步覆盖页面看缺口优先级。"
              actions={
                <>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setGroup("");
                      setEmptyOnly(false);
                      setUnexposedOnly(false);
                      setQuery("");
                    }}
                  >
                    重置筛选
                  </button>
                  <Link to="/global/quality" className="chip">
                    去看同步覆盖
                  </Link>
                </>
              }
            />
          ) : (
          <div className="overflow-auto">
            <table className="table-modern min-w-[720px]">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">分类</th>
                  <th className="px-2 py-1.5">表（物理名）</th>
                  <th className="px-2 py-1.5">含义</th>
                  <th className="px-2 py-1.5 text-right">约行数</th>
                  <th className="px-2 py-1.5">界面</th>
                  <th className="px-2 py-1.5">备注</th>
                  <th className="px-2 py-1.5 text-right">下钻</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it, i) => (
                  <tr key={it.table} className={cn("border-b border-border-soft/40", i % 2 === 0 ? "bg-bg-2/20" : "")}>
                    <td className="px-2 py-1.5 text-text-secondary">{it.group_zh}</td>
                    <td className="px-2 py-1.5 font-mono text-text-tertiary">{it.table}</td>
                    <td className="px-2 py-1.5 text-text-primary">{it.name_zh}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtNum(it.est_rows, 0)}
                    </td>
                    <td className="px-2 py-1.5">
                      {it.exposed_in_ui ? (
                        <span className="text-up">已展示</span>
                      ) : (
                        <span className="text-warn">待整合</span>
                      )}
                    </td>
                    <td className="max-w-[280px] px-2 py-1.5 text-text-tertiary">
                      {it.note ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {TABLE_DRILLDOWN_ROUTE[it.table] ? (
                        <Link
                          to={TABLE_DRILLDOWN_ROUTE[it.table]}
                          className="rounded border border-border-soft px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-3"
                        >
                          去页面
                        </Link>
                      ) : (
                        <span className="text-2xs text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )
        )}
      </div>
    </div>
  );
}
