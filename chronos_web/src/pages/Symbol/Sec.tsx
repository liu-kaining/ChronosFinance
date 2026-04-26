import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { SecFilingsListResponse } from "@/lib/types";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

export function SymbolSec() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ["sec", sym],
    queryFn: () => api.get<SecFilingsListResponse>(endpoints.secFilings(sym)),
    enabled: !!sym,
    staleTime: 10 * 60_000,
  });

  const items = data?.items ?? [];
  const [formFilter, setFormFilter] = useState<string>("ALL");
  const [yearFilter, setYearFilter] = useState<number | "ALL">("ALL");

  // Group by fiscal year
  const byYear = items.reduce<Record<number, typeof items>>((acc, item) => {
    const year = item.fiscal_year ?? 0;
    if (!acc[year]) acc[year] = [];
    acc[year].push(item);
    return acc;
  }, {});

  const years = Object.keys(byYear)
    .map(Number)
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  const formCounts = items.reduce<Record<string, number>>((acc, f) => {
    acc[f.form_type] = (acc[f.form_type] ?? 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(formCounts).map(([name, value]) => ({ name, value }));
  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      const byForm = formFilter === "ALL" || i.form_type === formFilter;
      const byYear = yearFilter === "ALL" || (i.fiscal_year ?? 0) === yearFilter;
      return byForm && byYear;
    });
  }, [formFilter, items, yearFilter]);
  const byYearFiltered = filteredItems.reduce<Record<number, typeof filteredItems>>((acc, item) => {
    const year = item.fiscal_year ?? 0;
    if (!acc[year]) acc[year] = [];
    acc[year].push(item);
    return acc;
  }, {});
  const yearsFiltered = Object.keys(byYearFiltered)
    .map(Number)
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="公告叙事"
        description="用 10-K / 10-Q 看经营主线，用 8-K 看突发事件，把业绩变化和信息披露节奏放在同一时间轴观察。"
      />
      {isLoading ? (
        <div className="card flex h-[300px] items-center justify-center">
          <div className="text-sm text-text-tertiary">加载公告数据中…</div>
        </div>
      ) : items.length === 0 ? (
        <div className="card p-4">
          <EmptyDataState
            title="暂无 SEC 申报数据"
            detail="可能是该标的数据覆盖不足，或供应商当前无可用返回。"
            actions={
              <>
                <Link to="/global/data-assets?table=sec_files" className="chip">
                  查看 SEC 覆盖
                </Link>
                <Link to={`/symbol/${sym}/raw`} className="chip">
                  查看原始 JSON
                </Link>
              </>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-3 lg:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                申报结构分布
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFormFilter("ALL")}
                  className={cn(
                    "chip",
                    formFilter === "ALL" ? "border-accent text-accent" : "",
                  )}
                >
                  全部 ({items.length})
                </button>
                {Object.entries(formCounts).map(([form, n]) => (
                  <button
                    key={form}
                    type="button"
                    onClick={() => setFormFilter(form)}
                    className={cn("chip", formFilter === form ? "border-accent text-accent" : "")}
                  >
                    <span className="font-mono text-text-primary">{form}</span>
                    <span>{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card p-2">
              <ReactECharts
                option={{
                  tooltip: { trigger: "item" },
                  series: [
                    {
                      type: "pie",
                      radius: ["45%", "72%"],
                      label: { color: "#9ca3af", fontSize: 10 },
                      data: donutData,
                    },
                  ],
                }}
                style={{ height: 180 }}
                onEvents={{
                  click: (params: { name?: string }) => {
                    if (!params?.name) return;
                    setFormFilter(params.name);
                  },
                }}
              />
            </div>
          </div>

          <div className="card p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">财年下钻</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setYearFilter("ALL")}
                className={cn("chip", yearFilter === "ALL" ? "border-accent text-accent" : "")}
              >
                全部年份
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYearFilter(y)}
                  className={cn("chip", yearFilter === y ? "border-accent text-accent" : "")}
                >
                  财年 {y}
                </button>
              ))}
            </div>
          </div>

          {/* Timeline by year */}
          {yearsFiltered.map((year) => (
            <div key={year} className="card p-3">
              <div className="mb-2 text-sm font-semibold text-text-primary">
                财年 {year}
              </div>
              <div className="flex flex-wrap gap-2">
                {byYearFiltered[year]?.map((f) => (
                  <a
                    key={f.id}
                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=${f.form_type}&dateb=${f.filing_date ?? ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-2.5 py-1.5 text-xs transition-colors hover:border-border hover:bg-bg-3"
                  >
                    <FormTypeBadge type={f.form_type} />
                    <span className="font-mono text-text-secondary">
                      {fmtDay(f.filing_date)}
                    </span>
                    {f.fiscal_period && (
                      <span className="text-text-tertiary">{f.fiscal_period}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Full table */}
          <div className="card overflow-auto p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              全部申报（{filteredItems.length}） {formFilter !== "ALL" ? `· ${formFilter}` : ""}
            </div>
            <table className="table-modern">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">表单</th>
                  <th className="px-2 py-1.5">申报日期</th>
                  <th className="px-2 py-1.5">财年</th>
                  <th className="px-2 py-1.5">期间</th>
                  <th className="px-2 py-1.5 text-right">字段估计</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.slice(0, 50).map((f, i) => (
                  <tr
                    key={f.id}
                    className={cn(
                      "border-b border-border-soft/50",
                      i % 2 === 0 ? "bg-bg-2/30" : "",
                      formFilter !== "ALL" && f.form_type === formFilter ? "bg-accent/5" : "",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <FormTypeBadge type={f.form_type} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-text-secondary">
                      {fmtDay(f.filing_date)}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {f.fiscal_year ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {f.fiscal_period ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-tertiary">
                      {f.content_keys_estimate ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function FormTypeBadge({ type }: { type: string }) {
  const color =
    type === "10-K"
      ? "bg-accent/15 text-accent"
      : type === "10-Q"
        ? "bg-purple/15 text-purple"
        : type === "8-K"
          ? "bg-warn/15 text-warn"
          : type === "DEF 14A"
            ? "bg-cyan/15 text-cyan"
            : "bg-bg-3 text-text-secondary";

  return (
    <span className={cn("rounded px-1.5 py-0.5 font-mono font-medium", color)}>
      {type}
    </span>
  );
}
