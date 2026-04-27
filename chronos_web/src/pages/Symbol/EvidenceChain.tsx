/**
 * EvidenceChain - Integrated single-page stock analysis
 * Consolidates all symbol data into a scrollable evidence chain
 *
 * Layout sections:
 * 1. Investment Summary (sticky)
 * 2. Price Action (K-line + volume + market cap)
 * 3. Financial Overview (waterfall + balance + cash flow)
 * 4. Event Timeline (earnings + dividends + splits + insider)
 * 5. Valuation Analysis (PE band + DCF + peer comparison)
 * 6. Insider & Analyst (trades + targets)
 * 7. Recent News
 */

import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Users,
  FileText,
  Newspaper,
  BarChart3,
  PieChart,
  Activity,
  Bookmark,
  BookmarkCheck,
  ArrowUpRight,
  ChevronUp,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type {
  SymbolInventory,
  SymbolSnapshotResponse,
  PricesSeriesResponse,
  StaticSeriesResponse,
  EarningsSeriesResponse,
  CorporateActionsResponse,
  InsiderSeriesResponse,
  DividendHistoryResponse,
  SplitHistoryResponse,
  ValuationResponse,
  MarketCapHistoryResponse,
} from "@/lib/types";
import { tvChartOptions, candleStyle, volumeStyle, maColors } from "@/lib/tv-theme";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtDay, fmtPctSigned } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useWatchlist } from "@/hooks/useWatchlist";

import { PageNarrative } from "@/components/ui/PageNarrative";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { Timeline, type TimelineEvent } from "@/components/ui/Timeline";
import { Sparkline } from "@/components/ui/Sparkline";
import { FinancialWaterfall } from "@/components/charts/FinancialWaterfall";
import { BalanceTree } from "@/components/charts/BalanceTree";
import { CashFlowChart } from "@/components/charts/CashFlowChart";
import { PeBand, PeComparison } from "@/components/charts/PeBand";

const SECTIONS = [
  { id: "summary", label: "摘要", icon: <Activity size={14} /> },
  { id: "price", label: "价格", icon: <TrendingUp size={14} /> },
  { id: "financials", label: "财务", icon: <BarChart3 size={14} /> },
  { id: "events", label: "事件", icon: <Calendar size={14} /> },
  { id: "valuation", label: "估值", icon: <DollarSign size={14} /> },
  { id: "insider", label: "内部人", icon: <Users size={14} /> },
];

export function EvidenceChainPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [activeSection, setActiveSection] = useState("summary");
  const [showBackToTop, setShowBackToTop] = useState(false);

  const { isInWatchlist, addToWatchlist, removeFromWatchlist } = useWatchlist();
  const inWatchlist = isInWatchlist(sym);

  // Fetch all data
  const { data: inv, isLoading: invLoading } = useQuery({
    queryKey: ["inventory", sym],
    queryFn: () => api.get<SymbolInventory>(endpoints.symbolInventory(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const { data: snap, isLoading: snapLoading } = useQuery({
    queryKey: ["symbol-snapshot", sym],
    queryFn: () => api.get<SymbolSnapshotResponse>(endpoints.symbolSnapshot(sym)),
    enabled: !!sym,
    staleTime: 30_000,
  });

  const { data: prices } = useQuery({
    queryKey: ["prices", sym],
    queryFn: () => api.get<PricesSeriesResponse>(endpoints.prices(sym), { params: { limit: 500 } }),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const { data: financials } = useQuery({
    queryKey: ["static", sym, "income_statement_annual"],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category: "income_statement_annual", period: "annual", limit: 5 },
      }),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: earnings } = useQuery({
    queryKey: ["earnings", sym],
    queryFn: () => api.get<EarningsSeriesResponse>(endpoints.earnings(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: actions } = useQuery({
    queryKey: ["corp-actions", sym],
    queryFn: () => api.get<CorporateActionsResponse>(endpoints.corpActions(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: insider } = useQuery({
    queryKey: ["insider", sym],
    queryFn: () => api.get<InsiderSeriesResponse>(endpoints.insider(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: dividends } = useQuery({
    queryKey: ["dividends", sym],
    queryFn: () => api.get<DividendHistoryResponse>(endpoints.dividends(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: splits } = useQuery({
    queryKey: ["splits", sym],
    queryFn: () => api.get<SplitHistoryResponse>(endpoints.splits(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: valuation } = useQuery({
    queryKey: ["valuation", sym],
    queryFn: () => api.get<ValuationResponse>(endpoints.valuation(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: marketCapHistory } = useQuery({
    queryKey: ["market-cap-history", sym],
    queryFn: () => api.get<MarketCapHistoryResponse>(endpoints.marketCapHistory(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  // Scroll spy for active section
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500);

      const sectionElements = SECTIONS.map((s) => ({
        id: s.id,
        element: document.getElementById(s.id),
      }));

      const scrollPos = window.scrollY + 150;
      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const section = sectionElements[i];
        if (section.element && section.element.offsetTop <= scrollPos) {
          setActiveSection(section.id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Build timeline events
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];

    earnings?.items?.forEach((e, i) => {
      const surprise =
        e.eps_estimated != null && e.eps_estimated !== 0 && e.eps_actual != null
          ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
          : null;
      events.push({
        id: `earnings-${i}`,
        date: e.date,
        type: "earnings",
        title: "财报发布",
        description: `EPS: ${fmtNum(e.eps_actual, 2)} ${surprise !== null ? `(${surprise > 0 ? "+" : ""}${surprise.toFixed(1)}%)` : ""}`,
        symbol: sym,
        change: surprise ?? undefined,
      });
    });

    dividends?.items?.forEach((d, i) => {
      events.push({
        id: `dividend-${i}`,
        date: d.date,
        type: "dividend",
        title: `分红 $${d.dividend}`,
        symbol: sym,
      });
    });

    splits?.items?.forEach((s, i) => {
      events.push({
        id: `split-${i}`,
        date: s.date,
        type: "split",
        title: `拆股 ${s.ratio_str}`,
        symbol: sym,
      });
    });

    insider?.items?.slice(0, 20).forEach((ins, i) => {
      const isBuy = ins.transaction_type?.toLowerCase().includes("buy");
      events.push({
        id: `insider-${i}`,
        date: ins.filing_date || ins.transaction_date || "",
        type: "insider",
        title: `内部人${isBuy ? "买入" : "交易"}`,
        description: ins.reporting_name || undefined,
        symbol: sym,
        value: ins.securities_transacted ? `${fmtCap(ins.securities_transacted, 0)}股` : undefined,
      });
    });

    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [earnings, dividends, splits, insider, sym]);

  // Prepare financial data
  const latestFinancials = financials?.items?.[0]?.raw_payload as Record<string, number> | undefined;

  const priceChange = prices?.items?.length
    ? ((prices.items[prices.items.length - 1]!.close! - prices.items[0]!.close!) / prices.items[0]!.close!) * 100
    : null;

  const dcfUpside = valuation?.upside_pct;

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky Navigation */}
      <nav className="sticky top-0 z-50 -mx-4 border-b border-border-soft bg-bg-1/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                activeSection === section.id
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-bg-2 hover:text-text-primary"
              )}
            >
              {section.icon}
              <span>{section.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Section 1: Investment Summary */}
      <section id="summary" className="scroll-mt-24">
        <PageNarrative
          title={`${sym} 投资摘要`}
          description={inv?.universe?.company_name || "综合估值、趋势、事件的投资决策参考"}
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => (inWatchlist ? removeFromWatchlist(sym) : addToWatchlist(sym))}
                className={cn(
                  "chip flex items-center gap-1",
                  inWatchlist ? "border-accent/40 bg-accent/10 text-accent" : ""
                )}
              >
                {inWatchlist ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                {inWatchlist ? "已加入自选" : "加入自选"}
              </button>
              <Link to={`/symbol/${sym}/raw`} className="chip flex items-center gap-1">
                <FileText size={14} />
                原始数据
              </Link>
            </div>
          }
        />

        {/* Summary Cards Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Price Card */}
          <SummaryCard
            label="最新价格"
            value={snap?.latest_price?.close ? `$${fmtNum(snap.latest_price.close, 2)}` : "—"}
            change={snap?.latest_price?.change_pct}
            sparkline={prices?.items?.slice(-30).map((p) => p.close!)}
            loading={snapLoading}
          />

          {/* Market Cap Card */}
          <SummaryCard
            label="市值"
            value={fmtCap(snap?.universe?.market_cap)}
            sub={inv?.universe?.sector}
            loading={invLoading}
          />

          {/* Valuation Signal */}
          <SummaryCard
            label="DCF估值"
            value={dcfUpside !== undefined ? `${dcfUpside > 0 ? "+" : ""}${dcfUpside.toFixed(1)}%` : "—"}
            sub={dcfUpside !== undefined ? (dcfUpside > 0 ? "低估" : dcfUpside < 0 ? "高估" : "合理") : undefined}
            positive={dcfUpside !== undefined ? dcfUpside > 0 : undefined}
            loading={snapLoading}
          />

          {/* Trend Signal */}
          <SummaryCard
            label="价格趋势"
            value={priceChange !== null ? `${priceChange > 0 ? "+" : ""}${priceChange.toFixed(1)}%` : "—"}
            sub="30日"
            positive={priceChange !== null ? priceChange > 0 : undefined}
            sparkline={prices?.items?.slice(-30).map((p) => p.close!)}
          />
        </div>

        {/* Quick Stats Row */}
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <QuickStat label="PE(TTM)" value={fmtNum(snap?.latest_price?.pe_ratio, 1)} suffix="x" />
          <QuickStat label="PB" value={fmtNum(snap?.latest_price?.pb_ratio, 1)} suffix="x" />
          <QuickStat label="52周高" value={snap?.latest_price?.fifty_two_week_high ? `$${fmtNum(snap.latest_price.fifty_two_week_high, 0)}` : "—"} />
          <QuickStat label="52周低" value={snap?.latest_price?.fifty_two_week_low ? `$${fmtNum(snap.latest_price.fifty_two_week_low, 0)}` : "—"} />
          <QuickStat label="平均成交量" value={fmtCap(snap?.latest_price?.avg_volume, 0)} />
          <QuickStat label="Beta" value={fmtNum(snap?.latest_price?.beta, 2)} />
        </div>
      </section>

      {/* Section 2: Price Action */}
      <section id="price" className="scroll-mt-24">
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              <TrendingUp size={14} />
              <span>价格行为</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: maColors.ma20 }} />
                MA20
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: maColors.ma50 }} />
                MA50
              </span>
            </div>
          </div>
          <PriceChart symbol={sym} data={prices} />
        </div>

        {/* Market Cap History */}
        {marketCapHistory?.items && marketCapHistory.items.length > 0 && (
          <div className="card mt-3 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              市值变化趋势
            </div>
            <Sparkline
              data={marketCapHistory.items.map((d) => d.market_cap)}
              width={800}
              height={60}
              variant="area"
              color={COLORS.accent}
            />
          </div>
        )}
      </section>

      {/* Section 3: Financial Overview */}
      <section id="financials" className="scroll-mt-24">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <BarChart3 size={14} className="mr-1 inline" />
          财务全景
        </div>

        {/* Financial Waterfall */}
        {latestFinancials && (
          <div className="card p-3">
            <FinancialWaterfall
              data={[
                { name: "营业收入", value: latestFinancials.revenue || 0, isSubtotal: true },
                { name: "营业成本", value: -(latestFinancials.costOfGoodsSold || 0) },
                { name: "毛利润", value: latestFinancials.grossProfit || 0, isSubtotal: true },
                { name: "运营费用", value: -(latestFinancials.operatingExpenses || 0) },
                { name: "营业利润", value: latestFinancials.operatingIncome || 0, isSubtotal: true },
                { name: "税费", value: -(latestFinancials.incomeTaxExpense || 0) },
                { name: "净利润", value: latestFinancials.netIncome || 0, isSubtotal: true },
              ]}
              title={`利润表瀑布 (${financials?.items?.[0]?.fiscal_year}年)`}
              height={260}
            />
          </div>
        )}

        {/* Balance Sheet & Cash Flow Grid */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="card p-3">
            {latestFinancials ? (
              <BalanceTree
                assets={[
                  { name: "流动资产", value: latestFinancials.totalCurrentAssets || 0 },
                  { name: "非流动资产", value: (latestFinancials.totalAssets || 0) - (latestFinancials.totalCurrentAssets || 0) },
                ]}
                liabilities={[
                  { name: "流动负债", value: latestFinancials.totalCurrentLiabilities || 0 },
                  { name: "非流动负债", value: (latestFinancials.totalLiabilities || 0) - (latestFinancials.totalCurrentLiabilities || 0) },
                ]}
                equity={latestFinancials.totalStockholdersEquity || 0}
                title="资产负债结构"
                height={240}
              />
            ) : (
              <EmptyDataState title="暂无资产负债表数据" detail="该标的资产负债表数据暂不可用" />
            )}
          </div>

          <div className="card p-3">
            {financials?.items && financials.items.length >= 2 ? (
              <CashFlowChart
                data={financials.items.slice(0, 4).reverse().map((item) => {
                  const payload = item.raw_payload as Record<string, number>;
                  return {
                    date: String(item.fiscal_year || ""),
                    operating: payload.netCashProvidedByOperatingActivities || 0,
                    investing: payload.netCashUsedForInvestingActivities || 0,
                    financing: payload.netCashUsedProvidedByFinancingActivities || 0,
                  };
                })}
                title="现金流趋势"
                height={240}
              />
            ) : (
              <EmptyDataState title="暂无现金流数据" detail="需要至少2期数据展示趋势" />
            )}
          </div>
        </div>
      </section>

      {/* Section 4: Event Timeline */}
      <section id="events" className="scroll-mt-24">
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              <Calendar size={14} />
              <span>事件时间轴</span>
            </div>
            <div className="flex gap-2 text-2xs">
              <span className="flex items-center gap-1"><span className="text-accent">●</span> 财报</span>
              <span className="flex items-center gap-1"><span className="text-up">●</span> 分红</span>
              <span className="flex items-center gap-1"><span className="text-warn">●</span> 拆股</span>
              <span className="flex items-center gap-1"><span className="text-pink">●</span> 内部人</span>
            </div>
          </div>

          {timelineEvents.length > 0 ? (
            <Timeline
              events={timelineEvents.slice(0, 15)}
              onEventClick={(event) => {
                if (event.type === "earnings") {
                  scrollToSection("financials");
                } else if (event.type === "insider") {
                  scrollToSection("insider");
                }
              }}
            />
          ) : (
            <EmptyDataState title="暂无事件数据" detail="该标的暂无近期事件记录" />
          )}
        </div>
      </section>

      {/* Section 5: Valuation Analysis */}
      <section id="valuation" className="scroll-mt-24">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <DollarSign size={14} className="mr-1 inline" />
          估值分析
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* DCF Valuation Card */}
          <div className="card p-3">
            <div className="mb-3 text-xs font-semibold text-text-secondary">DCF估值</div>
            {valuation ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">当前股价</span>
                  <span className="font-mono text-lg text-text-primary">${fmtNum(valuation.latest_price, 2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">DCF内在价值</span>
                  <span className="font-mono text-lg" style={{ color: COLORS.accent }}>
                    ${fmtNum(valuation.latest_dcf, 2)}
                  </span>
                </div>
                <div className="border-t border-border-soft pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">上涨空间</span>
                    <span
                      className={cn(
                        "font-mono text-xl font-semibold",
                        (valuation.upside_pct || 0) > 0 ? "text-up" : (valuation.upside_pct || 0) < 0 ? "text-down" : "text-text-primary"
                      )}
                    >
                      {valuation.upside_pct != null ? `${valuation.upside_pct > 0 ? "+" : ""}${valuation.upside_pct.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>
                {valuation.history && valuation.history.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-2xs text-text-tertiary">DCF vs 股价历史</div>
                    <Sparkline
                      data={valuation.history.slice(-20).map((h) => h.dcf)}
                      width={300}
                      height={40}
                      color={COLORS.accent}
                    />
                  </div>
                )}
              </div>
            ) : (
              <EmptyDataState title="暂无DCF数据" detail="该标的DCF估值数据暂不可用" />
            )}
          </div>

          {/* PE Band Card */}
          <div className="card p-3">
            <PeBand
              data={prices?.items
                ?.filter((p) => p.pe_ratio != null)
                .slice(-252) // 1 year
                .map((p) => ({
                  date: p.date,
                  pe: p.pe_ratio,
                  price: p.close,
                })) || []}
              title="PE估值带"
              height={240}
              showPrice
            />
          </div>
        </div>
      </section>

      {/* Section 6: Insider & Analyst */}
      <section id="insider" className="scroll-mt-24">
        <div className="card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              <Users size={14} />
              <span>内部人交易</span>
            </div>
            <Link to={`/symbol/${sym}/events`} className="flex items-center gap-1 text-2xs text-accent hover:underline">
              查看全部 <ArrowUpRight size={12} />
            </Link>
          </div>

          {insider?.items && insider.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="table-modern">
                <thead>
                  <tr className="border-b border-border-soft text-left text-text-tertiary">
                    <th className="px-2 py-1.5">日期</th>
                    <th className="px-2 py-1.5">申报人</th>
                    <th className="px-2 py-1.5">类型</th>
                    <th className="px-2 py-1.5 text-right">股数</th>
                    <th className="px-2 py-1.5 text-right">价格</th>
                  </tr>
                </thead>
                <tbody>
                  {insider.items.slice(0, 10).map((ins, i) => (
                    <tr key={i} className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}>
                      <td className="px-2 py-1.5 font-mono text-xs text-text-secondary">{fmtDay(ins.filing_date)}</td>
                      <td className="max-w-[150px] truncate px-2 py-1.5 text-xs text-text-primary">{ins.reporting_name}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-2xs",
                            ins.transaction_type?.toLowerCase().includes("buy")
                              ? "bg-up-soft text-up"
                              : "bg-down-soft text-down"
                          )}
                        >
                          {ins.transaction_type}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-text-secondary">
                        {fmtCap(ins.securities_transacted, 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-text-secondary">${fmtNum(ins.price, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyDataState title="暂无内部人交易数据" detail="该标的近期无内部人交易记录" />
          )}
        </div>
      </section>

      {/* Back to Top Button */}
      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-110"
        >
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function SummaryCard({
  label,
  value,
  change,
  sub,
  sparkline,
  positive,
  loading,
}: {
  label: string;
  value: string;
  change?: number | null;
  sub?: string;
  sparkline?: number[];
  positive?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="card p-3">
        <div className="h-4 w-16 animate-pulse rounded bg-bg-3" />
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-bg-3" />
      </div>
    );
  }

  return (
    <div className="card p-3">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-1 text-xl font-semibold text-text-primary">{value}</div>
      {change !== undefined && change !== null && (
        <div className={cn("mt-0.5 text-xs", change > 0 ? "text-up" : change < 0 ? "text-down" : "text-text-secondary")}>
          {change > 0 ? "+" : ""}
          {change.toFixed(2)}%
        </div>
      )}
      {sub && !change && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
      {sparkline && sparkline.length > 0 && (
        <div className="mt-2">
          <Sparkline
            data={sparkline}
            width={120}
            height={24}
            color={positive === true ? COLORS.up : positive === false ? COLORS.down : COLORS.text1}
          />
        </div>
      )}
    </div>
  );
}

function QuickStat({ label, value, suffix }: { label: string; value: string | number | null; suffix?: string }) {
  return (
    <div className="rounded-md border border-border-soft bg-bg-2/50 p-2 text-center">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text-primary">
        {value ?? "—"}
        {suffix && <span className="text-xs text-text-secondary">{suffix}</span>}
      </div>
    </div>
  );
}

function PriceChart({ symbol, data }: { symbol: string; data?: PricesSeriesResponse }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [ma20Data, setMa20Data] = useState<{ time: string; value: number }[]>([]);
  const [ma50Data, setMa50Data] = useState<{ time: string; value: number }[]>([]);

  // Compute MAs
  useEffect(() => {
    if (!data?.items?.length) {
      setMa20Data([]);
      setMa50Data([]);
      return;
    }

    const closes = data.items
      .filter((d) => d.close != null)
      .map((d) => ({ time: d.date, close: d.close! }));

    const calcMA = (period: number) => {
      const result: { time: string; value: number }[] = [];
      for (let i = period - 1; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          sum += closes[j]?.close ?? 0;
        }
        result.push({ time: closes[i]!.time, value: sum / period });
      }
      return result;
    };

    setMa20Data(calcMA(20));
    setMa50Data(calcMA(50));
  }, [data]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...tvChartOptions(),
      width: chartContainerRef.current.clientWidth,
      height: 380,
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      ...candleStyle,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      ...volumeStyle,
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const ma20Line = chart.addLineSeries({
      color: maColors.ma20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma50Line = chart.addLineSeries({
      color: maColors.ma50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    (chart as unknown as Record<string, unknown>).__ma20 = ma20Line;
    (chart as unknown as Record<string, unknown>).__ma50 = ma50Line;

    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0]?.contentRect ?? {};
      if (width) chart.applyOptions({ width });
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !data?.items?.length) return;

    const candleData: CandlestickData[] = [];
    const volumeData: HistogramData[] = [];

    let prevClose: number | null = null;
    for (const d of data.items) {
      if (d.open == null || d.high == null || d.low == null || d.close == null) continue;
      candleData.push({
        time: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      });
      if (d.volume != null) {
        volumeData.push({
          time: d.date,
          value: d.volume,
          color: d.close >= (prevClose ?? d.open) ? volumeStyle.upColor : volumeStyle.downColor,
        });
      }
      prevClose = d.close;
    }

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    const ma20 = (chart as unknown as Record<string, ISeriesApi<"Line">>).__ma20;
    const ma50 = (chart as unknown as Record<string, ISeriesApi<"Line">>).__ma50;
    if (ma20 && ma20Data.length) ma20.setData(ma20Data);
    if (ma50 && ma50Data.length) ma50.setData(ma50Data);

    chart.timeScale().fitContent();
  }, [data, ma20Data, ma50Data]);

  if (!data?.items?.length) {
    return (
      <div className="flex h-[380px] items-center justify-center text-sm text-text-tertiary">暂无价格数据</div>
    );
  }

  return <div ref={chartContainerRef} className="w-full" />;
}
