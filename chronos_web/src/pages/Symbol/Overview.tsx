import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  DollarSign,
  BarChart3,
  PieChart,
  Calendar,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type {
  StaticCategoryInfo,
  StaticCategoriesResponse,
  SymbolInventory,
  SymbolSnapshotResponse,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmtCap, fmtNum, fmtDay, fmtPctSigned } from "@/lib/format";
import { signalColor } from "@/lib/theme";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

/** Fetch static categories to understand available financial data */
function useStaticCategories(symbol: string) {
  return useQuery({
    queryKey: ["static-categories", symbol],
    queryFn: () => api.get<StaticCategoriesResponse>(endpoints.staticCategories(symbol)),
    enabled: !!symbol,
    staleTime: 5 * 60_000,
  });
}

export function SymbolOverview() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

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
  const { data: catsData } = useStaticCategories(sym);

  const latest = snap?.latest_price;
  const change = snap?.latest_price?.change_pct ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="投资叙事"
        description="先看价格与成交确认市场定价，再看最近业绩与数据覆盖，最后核验公告与内部人行为是否支持该定价。"
        actions={
          <>
            <Link to={`/symbol/${sym}/chart`} className="chip">① 价格结构</Link>
            <Link to={`/symbol/${sym}/financials`} className="chip">② 财务质量</Link>
            <Link to={`/symbol/${sym}/events`} className="chip">③ 事件验证</Link>
            <Link to={`/symbol/${sym}/sec`} className="chip">④ 公告核验</Link>
          </>
        }
      />

      {/* Price card */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <KpiCard
          icon={<DollarSign size={16} />}
          label="最新价"
          value={latest?.close != null ? fmtNum(latest.close, 2) : "—"}
          sub={change !== null ? fmtPctSigned(change, 2) : undefined}
          subColor={signalColor(change)}
          loading={snapLoading}
        />
        <KpiCard
          icon={<BarChart3 size={16} />}
          label="成交量"
          value={latest?.volume != null ? fmtCap(latest.volume, 0) : "—"}
          sub={latest?.date ? fmtDay(latest.date) : undefined}
          loading={snapLoading}
        />
        <KpiCard
          icon={<PieChart size={16} />}
          label="市值"
          value={fmtCap(snap?.universe?.market_cap)}
          sub={snap?.universe?.sector ?? undefined}
          loading={invLoading}
        />
        <KpiCard
          icon={<Calendar size={16} />}
          label="交易所"
          value={snap?.universe?.exchange ?? "—"}
          sub={snap?.universe?.is_actively_trading ? "交易中" : "未活跃"}
          loading={invLoading}
        />
      </div>

      {snap?.latest_earnings && (
        <div className="card p-4">
          <div className="mb-2 text-xs text-text-tertiary">最近财报</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xs text-text-tertiary">日期</div>
              <div className="font-mono text-sm text-text-secondary">{fmtDay(snap.latest_earnings.date)}</div>
            </div>
            <div>
              <div className="text-2xs text-text-tertiary">EPS 预期 / 实际</div>
              <div className="font-mono text-sm text-text-secondary">
                {fmtNum(snap.latest_earnings.eps_estimated, 2)} / {fmtNum(snap.latest_earnings.eps_actual, 2)}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-2xs text-text-tertiary">营收预期 / 实际</div>
              <div className="font-mono text-sm text-text-secondary">
                {fmtCap(snap.latest_earnings.revenue_estimated)} / {fmtCap(snap.latest_earnings.revenue_actual)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data availability grid */}
      <div className="card p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          数据可用性
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(catsData?.categories ?? []).map((c) => (
            <div key={`${c.data_category}-${c.period}`}>
              <DataCategoryCard cat={c} />
            </div>
          ))}
          {(!catsData?.categories || catsData.categories.length === 0) && (
            <div className="col-span-full">
              <EmptyDataState
                title="未发现财务数据分类"
                detail="该标的财务数据暂不可用，可先看价格与事件页，再回到财务页复查。"
                actions={
                  <>
                    <Link to={`/symbol/${sym}/events`} className="chip">去看事件页</Link>
                    <Link to={`/symbol/${sym}/raw`} className="chip">查看原始 JSON</Link>
                  </>
                }
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="mb-2 text-xs text-text-tertiary">同步覆盖</div>
          <div className="kpi-num">
            {snap?.synced_flags_true ?? 0}/{snap?.synced_flags_total ?? 0}
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-2 text-xs text-text-tertiary">内部人交易（90天）</div>
          <div className="kpi-num">{fmtNum(snap?.insider_rows_90d, 0)}</div>
        </div>
        <div className="card p-4">
          <div className="mb-2 text-xs text-text-tertiary">SEC 表单</div>
          <div className="text-sm text-text-secondary">
            {(snap?.sec_by_form ?? []).slice(0, 3).map((s) => `${s.form_type}:${s.rows}`).join(" · ") || "—"}
          </div>
        </div>
      </div>

      {/* Company info */}
      {snap?.universe?.company_name && (
        <div className="card p-4">
          <div className="mb-1 text-xs text-text-tertiary">公司信息</div>
          <div className="text-sm text-text-primary">{snap.universe.company_name}</div>
          {snap.universe.industry && (
            <div className="mt-1 text-xs text-text-secondary">
              {snap.universe.industry}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

interface KpiCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  loading?: boolean;
}

function KpiCard({ icon, label, value, sub, subColor, loading }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      {loading ? (
        <div className="h-6 w-20 animate-pulse rounded bg-bg-3" />
      ) : (
        <div className="kpi-num">{value}</div>
      )}
      {sub && !loading && (
        <div className={cn("text-xs", subColor ? `text-[${subColor}]` : "text-text-secondary")} style={subColor ? { color: subColor } : undefined}>
          {sub}
        </div>
      )}
    </div>
  );
}

function DataCategoryCard({ cat }: { cat: StaticCategoryInfo }) {
  const label = cat.data_category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const years = cat.fiscal_year_min && cat.fiscal_year_max
    ? `${cat.fiscal_year_min}–${cat.fiscal_year_max}`
    : "—";
  return (
    <div className="rounded-md border border-border-soft bg-bg-2 px-2.5 py-2">
      <div className="truncate text-xs font-medium text-text-primary">
        {label}
      </div>
      <div className="mt-0.5 flex items-center justify-between text-2xs text-text-tertiary">
        <span>{cat.period}</span>
        <span>{years}</span>
      </div>
      <div className="mt-0.5 text-2xs text-text-secondary">
        {cat.rows} rows
      </div>
    </div>
  );
}
