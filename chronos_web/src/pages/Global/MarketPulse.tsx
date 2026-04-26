import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import { TrendingUp, TrendingDown, RefreshCcw, ArrowRight } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { MarketSnapshotResponse, StatsOverview, UniverseItem, UniversePage } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";

export function MarketPulsePage() {
  const [rotationSort, setRotationSort] = useState<"move" | "breadth">("move");
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [sectorCompanyQuery, setSectorCompanyQuery] = useState("");
  const [sectorCompanyPage, setSectorCompanyPage] = useState(1);
  const [sectorCompanySort, setSectorCompanySort] = useState<"cap" | "symbol">("cap");
  const { data: stats } = useQuery({
    queryKey: ["stats-overview"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });

  const { data: market, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 10 } }),
    staleTime: 30_000,
  });
  const { data: universeRows } = useQuery({
    queryKey: ["universe-all-active"],
    queryFn: fetchAllActiveUniverse,
    staleTime: 10 * 60_000,
  });

  const gainers = market?.top_gainers ?? [];
  const losers = market?.top_losers ?? [];
  const active = market?.most_active ?? [];
  const fallbackSymbols = useMemo(() => {
    const merged = [...gainers, ...losers, ...active];
    const seen = new Set<string>();
    return merged.filter((m) => {
      if (!m.symbol || seen.has(m.symbol)) return false;
      seen.add(m.symbol);
      return true;
    });
  }, [gainers, losers, active]);
  const rotationRows = useMemo(() => {
    const rows = [...(market?.sectors ?? [])];
    rows.sort((a, b) => {
      if (rotationSort === "breadth") return (b.symbols ?? 0) - (a.symbols ?? 0);
      return (b.avg_change_pct ?? 0) - (a.avg_change_pct ?? 0);
    });
    return selectedSector ? rows.filter((r) => r.sector === selectedSector) : rows.slice(0, 10);
  }, [market?.sectors, rotationSort, selectedSector]);
  const selectedSectorCompanies = useMemo(() => {
    if (!selectedSector || !universeRows) return [];
    const rows = universeRows
      .filter((u) => (u.sector ?? "").toLowerCase() === selectedSector.toLowerCase())
      .slice(0, 120);
    rows.sort((a, b) => {
      if (sectorCompanySort === "symbol") return (a.symbol ?? "").localeCompare(b.symbol ?? "");
      return (b.market_cap ?? 0) - (a.market_cap ?? 0);
    });
    return rows;
  }, [selectedSector, universeRows, sectorCompanySort]);
  const sectorCompaniesFiltered = useMemo(() => {
    const q = sectorCompanyQuery.trim().toLowerCase();
    if (!q) return selectedSectorCompanies;
    return selectedSectorCompanies.filter(
      (u) =>
        (u.symbol ?? "").toLowerCase().includes(q) ||
        (u.company_name ?? "").toLowerCase().includes(q),
    );
  }, [selectedSectorCompanies, sectorCompanyQuery]);
  const sectorCompanyPageSize = 12;
  const sectorCompanyTotalPages = Math.max(1, Math.ceil(sectorCompaniesFiltered.length / sectorCompanyPageSize));
  const sectorCompaniesPageItems = sectorCompaniesFiltered.slice(
    (sectorCompanyPage - 1) * sectorCompanyPageSize,
    sectorCompanyPage * sectorCompanyPageSize,
  );

  useEffect(() => {
    setSectorCompanyQuery("");
    setSectorCompanyPage(1);
  }, [selectedSector]);
  useEffect(() => {
    if (sectorCompanyPage > sectorCompanyTotalPages) {
      setSectorCompanyPage(sectorCompanyTotalPages);
    }
  }, [sectorCompanyPage, sectorCompanyTotalPages]);
  const topSector = (market?.sectors ?? [])[0];
  const breadthPositive = (market?.sectors ?? []).filter((s) => (s.avg_change_pct ?? 0) > 0).length;
  const breadthTotal = (market?.sectors ?? []).length;
  const marketTone =
    breadthTotal > 0 && breadthPositive / breadthTotal >= 0.6
      ? "风险偏好扩张"
      : breadthTotal > 0 && breadthPositive / breadthTotal <= 0.4
        ? "防御偏好抬升"
        : "震荡分化";

  return (
    <div className="flex flex-col gap-4">
      {/* Stats overview */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <StatCard
          label="标的总数"
          value={fmtNum(stats?.universe.total, 0)}
          sub={`活跃 ${stats?.universe.active ?? 0}`}
          to="/global/quality"
        />
        <StatCard
          label="日线数据"
          value={fmtCap(stats?.tables.daily_prices, 0)}
          to="/global/data-assets?table=daily_prices"
        />
        <StatCard
          label="财务数据"
          value={fmtCap(stats?.tables.static_financials, 0)}
          to="/global/data-assets?table=static_financials"
        />
        <StatCard
          label="财报事件"
          value={fmtCap(stats?.tables.earnings_calendar, 0)}
          to="/global/events"
        />
      </div>

      <PageNarrative
        title="市场主线判断"
        description={`当前风格：${marketTone}，行业强度第一为 ${topSector?.sector ?? "—"}（平均 1D ${fmtPctSigned(
          topSector?.avg_change_pct,
          2,
        )}）。`}
        actions={
          <>
            <button type="button" onClick={() => topSector?.sector && setSelectedSector(topSector.sector)} className="chip">
              ① 先看最强行业
            </button>
            <Link to="/global/events" className="chip">
              ② 再看事件驱动
            </Link>
            <span className="chip">③ 进入个股证据链</span>
          </>
        }
      />

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Gainers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-up">
            <TrendingUp size={16} />
            <span>涨幅榜</span>
          </div>
          <MoversTable items={gainers} />
        </div>

        {/* Losers */}
        <div className="card p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-down">
            <TrendingDown size={16} />
            <span>跌幅榜</span>
          </div>
          <MoversTable items={losers} />
        </div>

        <div className="card p-3">
          <div className="mb-3 text-sm font-medium text-text-primary">成交活跃</div>
          <MoversTable items={active} />
        </div>
      </div>

      {/* Sector distribution */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <span>行业分布 {isLoading ? "" : `（截至 ${market?.as_of_date ?? "—"}）`}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1 rounded border border-border-soft px-2 py-1 normal-case tracking-normal text-text-secondary hover:bg-bg-2"
            title="刷新市场快照"
          >
            <RefreshCcw size={12} className={isFetching ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
        <SectorTreemap
          sectors={market?.sectors ?? []}
          onSectorClick={(sector) => {
            setSelectedSector(sector);
          }}
        />
        <div className="mt-3 overflow-auto">
          <div className="mb-2 flex items-center justify-end gap-1">
            {selectedSector ? (
              <button
                type="button"
                onClick={() => setSelectedSector("")}
                className="mr-2 rounded border border-border-soft bg-bg-2 px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-3"
                title="清除行业筛选"
              >
                行业：{selectedSector} · 清除
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setRotationSort("move")}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs",
                rotationSort === "move"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border-soft text-text-tertiary",
              )}
            >
              按涨跌排序
            </button>
            <button
              type="button"
              onClick={() => setRotationSort("breadth")}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs",
                rotationSort === "breadth"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border-soft text-text-tertiary",
              )}
            >
              按广度排序
            </button>
          </div>
          <table className="table-modern">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">行业</th>
                <th className="px-2 py-1.5 text-right">标的数</th>
                <th className="px-2 py-1.5 text-right">平均 1D</th>
              </tr>
            </thead>
            <tbody>
              {rotationRows.map((s, i) => (
                <tr
                  key={s.sector}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-bg-2/60",
                    i % 2 === 0 ? "bg-bg-2/30" : "",
                    selectedSector === s.sector ? "bg-accent/10" : "",
                  )}
                  onClick={() => setSelectedSector(s.sector)}
                >
                  <td className="px-2 py-1.5 text-text-secondary">{s.sector}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">{fmtNum(s.symbols, 0)}</td>
                  <td
                    className="px-2 py-1.5 text-right font-mono"
                    style={{ color: signalColor(s.avg_change_pct ?? null) }}
                  >
                    {(s.avg_change_pct ?? 0) >= 0 ? "↑ " : "↓ "}
                    {fmtPctSigned(s.avg_change_pct, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSector ? (
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              行业下钻：{selectedSector}（{fmtNum(selectedSectorCompanies.length, 0)}）
            </div>
            <div className="text-2xs text-text-tertiary">逻辑：点击行业，展开公司列表，再点代码进个股证据链</div>
          </div>
          {selectedSectorCompanies.length === 0 ? (
            <div className="space-y-3 py-2">
              <div className="text-center text-xs text-text-tertiary">
                当前股票池里该行业公司元数据缺失。你可以先从市场强弱榜进入个股，再回到该行业继续下钻。
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {fallbackSymbols.slice(0, 10).map((m) => (
                  <Link
                    key={m.symbol}
                    to={`/symbol/${m.symbol}/overview`}
                    className="rounded-md border border-border-soft px-2 py-1 text-xs text-text-secondary hover:bg-bg-2"
                  >
                    {m.symbol}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <input
                  value={sectorCompanyQuery}
                  onChange={(e) => setSectorCompanyQuery(e.target.value)}
                  placeholder="搜索代码或公司名"
                  className="w-full rounded-md border border-border-soft bg-bg-2 px-3 py-1.5 text-xs text-text-secondary outline-none focus:border-accent/40 sm:w-64"
                />
                <div className="text-2xs text-text-tertiary">
                  结果 {fmtNum(sectorCompaniesFiltered.length, 0)} / {fmtNum(selectedSectorCompanies.length, 0)}
                </div>
              </div>
              <div className="mb-3 flex items-center justify-end gap-1 text-2xs">
                <button
                  type="button"
                  className={cn(
                    "rounded border px-2 py-0.5",
                    sectorCompanySort === "cap" ? "border-accent/40 bg-accent/10 text-accent" : "border-border-soft text-text-tertiary",
                  )}
                  onClick={() => setSectorCompanySort("cap")}
                >
                  按市值
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded border px-2 py-0.5",
                    sectorCompanySort === "symbol" ? "border-accent/40 bg-accent/10 text-accent" : "border-border-soft text-text-tertiary",
                  )}
                  onClick={() => setSectorCompanySort("symbol")}
                >
                  按代码
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sectorCompaniesPageItems.map((u) => (
                  <Link
                    key={u.symbol}
                    to={`/symbol/${u.symbol}/overview`}
                    className="rounded-lg border border-border-soft bg-bg-2/70 px-3 py-2 transition hover:border-accent/30 hover:bg-bg-3/80"
                  >
                    <div className="flex items-center justify-between">
                      <span className="ticker text-text-primary">{u.symbol}</span>
                      <ArrowRight size={12} className="text-text-tertiary" />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-secondary">{u.company_name ?? "—"}</div>
                    <div className="mt-1 text-2xs text-text-tertiary">
                      市值 {fmtCap(u.market_cap, 0)} · {u.exchange ?? "—"}
                    </div>
                  </Link>
                ))}
              </div>
              {sectorCompaniesFiltered.length === 0 ? (
                <div className="mt-3 text-center text-xs text-text-tertiary">当前关键词无匹配公司，请换一个关键词。</div>
              ) : null}
              {sectorCompanyTotalPages > 1 ? (
                <div className="mt-3 flex items-center justify-end gap-2 text-2xs">
                  <button
                    type="button"
                    className="rounded border border-border-soft px-2 py-0.5 text-text-secondary disabled:opacity-50"
                    disabled={sectorCompanyPage <= 1}
                    onClick={() => setSectorCompanyPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span className="text-text-tertiary">
                    第 {sectorCompanyPage} / {sectorCompanyTotalPages} 页
                  </span>
                  <button
                    type="button"
                    className="rounded border border-border-soft px-2 py-0.5 text-text-secondary disabled:opacity-50"
                    disabled={sectorCompanyPage >= sectorCompanyTotalPages}
                    onClick={() => setSectorCompanyPage((p) => Math.min(sectorCompanyTotalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

async function fetchAllActiveUniverse(): Promise<UniverseItem[]> {
  const first = await api.get<UniversePage>(endpoints.universe(), { params: { active_only: true, limit: 500, offset: 0 } });
  const total = first.total_matching ?? first.items.length;
  const pages = Math.ceil(total / 500);
  if (pages <= 1) return first.items ?? [];
  const reqs: Promise<UniversePage>[] = [];
  for (let p = 1; p < pages; p += 1) {
    reqs.push(
      api.get<UniversePage>(endpoints.universe(), {
        params: { active_only: true, limit: 500, offset: p * 500 },
      }),
    );
  }
  const rest = await Promise.all(reqs);
  return [first, ...rest].flatMap((x) => x.items ?? []);
}

function StatCard({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="kpi-num">{value}</div>
      {sub && <div className="text-2xs text-text-secondary">{sub}</div>}
    </div>
  );

  if (!to) return body;
  return (
    <Link to={to} className="rounded-md px-1 py-0.5 transition-colors hover:bg-bg-2" title="点击下钻">
      {body}
    </Link>
  );
}

function MoversTable({ items }: { items: MarketSnapshotResponse["top_gainers"] }) {
  if (items.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">暂无数据</div>;
  }

  return (
    <table className="table-modern">
      <thead>
        <tr className="border-b border-border-soft text-left text-text-tertiary">
          <th className="px-2 py-1.5">代码</th>
          <th className="px-2 py-1.5 text-right">价格</th>
          <th className="px-2 py-1.5 text-right">涨跌</th>
        </tr>
      </thead>
      <tbody>
        {items.map((m, i) => (
          <tr key={m.symbol} className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}>
            <td className="px-2 py-1.5">
              <a
                href={`/symbol/${m.symbol}/overview`}
                className="ticker text-text-primary hover:text-accent"
              >
                {m.symbol}
              </a>
            </td>
            <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
              {fmtNum(m.close, 2)}
            </td>
            <td
              className="px-2 py-1.5 text-right font-mono"
              style={{ color: signalColor(m.change_pct ?? null) }}
            >
              {fmtPctSigned(m.change_pct, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectorTreemap({
  sectors,
  onSectorClick,
}: {
  sectors: MarketSnapshotResponse["sectors"];
  onSectorClick: (sector: string) => void;
}) {
  const data = sectors
    .map((s) => ({ name: s.sector, value: s.symbols, move: s.avg_change_pct ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  if (data.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">暂无行业数据</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      formatter: (params: { name: string; value: number }) => {
        const row = sectors.find((s) => s.sector === params.name);
        return `<b>${params.name}</b><br/>标的数：${params.value}<br/>平均 1D：${fmtPctSigned(row?.avg_change_pct, 2)}`;
      },
    },
    series: [
      {
        type: "treemap",
        data: data.map((d) => {
          const move = d.move ?? 0;
          const color =
            move > 0
              ? toRgba(COLORS.up, 0.28)
              : move < 0
                ? toRgba(COLORS.down, 0.24)
                : toRgba(COLORS.accent, 0.2);
          return {
            name: d.name,
            value: d.value,
            itemStyle: {
              color,
              borderColor: COLORS.grid,
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
          formatter: "{b}",
          fontSize: 10,
          color: COLORS.textStrong,
        },
        upperLabel: { show: false },
        itemStyle: {
          borderColor: COLORS.grid,
          borderWidth: 1,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              color: COLORS.borderSoft,
              borderColor: COLORS.grid,
              borderWidth: 1,
            },
          },
        ],
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 280 }}
      onEvents={{
        click: (params: { name?: string }) => {
          if (params?.name) onSectorClick(params.name);
        },
      }}
    />
  );
}

function toRgba(color: string, alpha: number): string {
  const nums = color.match(/\d+(\.\d+)?/g);
  if (!nums || nums.length < 3) return color;
  const [r, g, b] = nums;
  return `rgba(${r},${g},${b},${alpha})`;
}
