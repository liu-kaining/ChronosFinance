import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  BarChart3,
  PieChart,
  Calendar,
} from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { DailyPrice, PricesSeriesResponse, StaticCategoryInfo, StaticCategoriesResponse, SymbolInventory } from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmtCap, fmtNum, fmtDay } from "@/lib/format";
import { signalColor } from "@/lib/theme";

/** Fetch latest price (most recent bar) */
function useLatestPrice(symbol: string) {
  return useQuery({
    queryKey: ["price-latest", symbol],
    queryFn: async () => {
      const res = await api.get<PricesSeriesResponse>(endpoints.prices(symbol), {
        params: { limit: 2, order: "desc" },
      });
      const items = res.items ?? [];
      if (items.length === 0) return null;
      const latest = items[0] as DailyPrice;
      const prev = items[1] as DailyPrice | undefined;
      const change = prev?.close && latest.close
        ? (latest.close - prev.close) / prev.close
        : null;
      return { latest, prev, change };
    },
    enabled: !!symbol,
    staleTime: 30_000,
  });
}

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

  const { data: priceData, isLoading: priceLoading } = useLatestPrice(sym);
  const { data: catsData } = useStaticCategories(sym);

  const latest = priceData?.latest;
  const change = priceData?.change;

  return (
    <div className="flex flex-col gap-4">
      {/* Price card */}
      <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <KpiCard
          icon={<DollarSign size={16} />}
          label="Last Price"
          value={latest?.close ? fmtNum(latest.close, 2) : "—"}
          sub={change !== null ? fmtPctSigned(change, 2) : undefined}
          subColor={signalColor(change)}
          loading={priceLoading}
        />
        <KpiCard
          icon={<BarChart3 size={16} />}
          label="Volume"
          value={latest?.volume ? fmtCap(latest.volume, 0) : "—"}
          sub={latest?.date ? fmtDay(latest.date) : undefined}
          loading={priceLoading}
        />
        <KpiCard
          icon={<PieChart size={16} />}
          label="Market Cap"
          value={fmtCap(inv?.market_cap)}
          sub={inv?.sector ?? undefined}
          loading={invLoading}
        />
        <KpiCard
          icon={<Calendar size={16} />}
          label="Exchange"
          value={inv?.exchange ?? "—"}
          sub={inv?.is_actively_trading ? "Trading" : "Inactive"}
          loading={invLoading}
        />
      </div>

      {/* Daily range */}
      {latest && (
        <div className="card p-4">
          <div className="mb-2 text-xs text-text-tertiary">Day Range</div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-text-secondary">
              {fmtNum(latest.low, 2)}
            </span>
            <div className="relative h-2 flex-1 rounded-full bg-bg-3">
              {latest.high && latest.low && latest.close ? (
                <div
                  className="absolute top-0 h-2 w-1.5 rounded-full bg-accent"
                  style={{
                    left: `${Math.min(100, Math.max(0, ((latest.close - latest.low) / (latest.high - latest.low)) * 100))}%`,
                    transform: "translateX(-50%)",
                  }}
                />
              ) : null}
            </div>
            <span className="font-mono text-sm text-text-secondary">
              {fmtNum(latest.high, 2)}
            </span>
          </div>
        </div>
      )}

      {/* Data availability grid */}
      <div className="card p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Data Availability
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(catsData?.categories ?? []).map((c) => (
            <DataCategoryCard key={`${c.data_category}-${c.period}`} cat={c} />
          ))}
          {(!catsData?.categories || catsData.categories.length === 0) && (
            <div className="col-span-full py-4 text-center text-sm text-text-tertiary">
              No financial data categories found.
            </div>
          )}
        </div>
      </div>

      {/* Company info */}
      {inv?.company_name && (
        <div className="card p-4">
          <div className="mb-1 text-xs text-text-tertiary">Company</div>
          <div className="text-sm text-text-primary">{inv.company_name}</div>
          {inv.industry && (
            <div className="mt-1 text-xs text-text-secondary">
              {inv.industry}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

interface KpiCardProps {
  icon: React.ReactNode;
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
