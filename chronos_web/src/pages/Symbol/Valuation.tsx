import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api, endpoints } from "@/lib/api";
import type {
  AnalystEstimatesResponse,
  ValuationResponse,
  SymbolSnapshotResponse,
} from "@/lib/types";
import { fmtNum, fmtPctSigned, fmtCap } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatGrid } from "@/components/shared/StatGrid";

export function ValuationPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: valuation, isLoading: valuationLoading } = useQuery({
    queryKey: ["valuation", sym],
    queryFn: () => api.get<ValuationResponse>(endpoints.valuation(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const { data: analyst } = useQuery({
    queryKey: ["analyst", sym],
    queryFn: () => api.get<AnalystEstimatesResponse>(endpoints.analyst(sym), { params: { limit: 10 } }),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const { data: snapshot } = useQuery({
    queryKey: ["symbolSnapshot", sym],
    queryFn: () => api.get<SymbolSnapshotResponse>(endpoints.symbolSnapshot(sym)),
    enabled: !!sym,
    staleTime: 30_000,
  });

  const latestDcf = valuation?.latest_dcf;
  const latestPrice = valuation?.latest_price;
  const upsidePct = valuation?.upside_pct;
  const analystItems = analyst?.items ?? [];

  // Get latest analyst price target
  const latestTarget = analystItems.find((a) => a.target_price != null);
  const targetPrice = latestTarget?.target_price;

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="估值分析"
        description="便宜吗？综合 DCF 模型、PE 带和分析师目标价判断估值水位。"
      />

      {/* DCF Valuation Card */}
      <div className="card p-4">
        <SectionHeader title="DCF 估值模型" subtitle="基于折现现金流的内在价值" />
        {valuationLoading ? (
          <div className="py-8 text-center text-text-tertiary">加载中...</div>
        ) : valuation?.rows ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-border-soft bg-bg-2/50 p-3 text-center">
              <div className="text-2xs text-text-tertiary">DCF 内在价值</div>
              <div className="mt-1 font-mono text-xl font-semibold text-text-primary">
                {fmtNum(latestDcf, 2)}
              </div>
            </div>
            <div className="rounded-lg border border-border-soft bg-bg-2/50 p-3 text-center">
              <div className="text-2xs text-text-tertiary">当前价格</div>
              <div className="mt-1 font-mono text-xl font-semibold text-text-primary">
                {fmtNum(latestPrice, 2)}
              </div>
            </div>
            <div className="rounded-lg border border-border-soft bg-bg-2/50 p-3 text-center">
              <div className="text-2xs text-text-tertiary">溢价/折价</div>
              <div className={cn(
                "mt-1 font-mono text-xl font-semibold",
                (upsidePct ?? 0) > 0 ? "text-up" : (upsidePct ?? 0) < 0 ? "text-down" : "text-text-secondary"
              )}>
                {fmtPctSigned(upsidePct ? upsidePct / 100 : null, 1)}
              </div>
            </div>
            <div className="rounded-lg border border-border-soft bg-bg-2/50 p-3 text-center">
              <div className="text-2xs text-text-tertiary">数据点</div>
              <div className="mt-1 font-mono text-xl font-semibold text-text-secondary">
                {valuation.rows}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-text-tertiary">暂无 DCF 估值数据</div>
        )}

        {/* DCF Trend */}
        {valuation?.items && valuation.items.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-text-tertiary mb-2">DCF 趋势</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {valuation.items.slice(-4).map((item) => (
                <div key={item.date} className="rounded-md border border-border-soft bg-bg-2/50 p-2">
                  <div className="text-2xs text-text-tertiary">{item.date}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-mono text-sm text-text-primary">DCF: {fmtNum(item.dcf, 2)}</span>
                    <span className="font-mono text-xs text-text-secondary">P: {fmtNum(item.stock_price, 2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Analyst Estimates */}
      <div className="card p-4">
        <SectionHeader title="分析师预期" subtitle="最新预测与目标价" />
        {snapshot?.analyst_by_kind && snapshot.analyst_by_kind.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
            {snapshot.analyst_by_kind.map((a) => (
              <div key={a.name} className="rounded-md border border-border-soft bg-bg-2/50 p-2 text-center">
                <div className="text-2xs text-text-tertiary">{a.name}</div>
                <div className="mt-1 font-mono text-sm text-text-primary">{a.rows} 条</div>
              </div>
            ))}
          </div>
        )}

        {targetPrice && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-accent">分析师目标价</div>
                <div className="font-mono text-lg font-semibold text-text-primary">
                  {fmtNum(targetPrice, 2)}
                </div>
              </div>
              {latestPrice && (
                <div className="text-right">
                  <div className="text-xs text-text-tertiary">潜在空间</div>
                  <div className={cn(
                    "font-mono text-lg font-semibold",
                    targetPrice > latestPrice ? "text-up" : "text-down"
                  )}>
                    {fmtPctSigned((targetPrice - latestPrice) / latestPrice, 1)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {analystItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft text-text-tertiary text-xs">
                  <th className="text-left px-3 py-2 font-medium">日期</th>
                  <th className="text-left px-3 py-2 font-medium">类型</th>
                  <th className="text-right px-3 py-2 font-medium">预估收入</th>
                  <th className="text-right px-3 py-2 font-medium">预估EPS</th>
                  <th className="text-right px-3 py-2 font-medium">目标价</th>
                </tr>
              </thead>
              <tbody>
                {analystItems.slice(0, 10).map((item, i) => (
                  <tr key={i} className="border-b border-border-soft/50 hover:bg-bg-2/30">
                    <td className="px-3 py-2 text-text-secondary">{item.date}</td>
                    <td className="px-3 py-2 text-text-secondary">{item.kind ?? "—"}</td>
                    <td className="text-right px-3 py-2 font-mono text-text-secondary">
                      {fmtCap(item.estimated_revenue, 0)}
                    </td>
                    <td className="text-right px-3 py-2 font-mono text-text-secondary">
                      {fmtNum(item.estimated_eps, 2)}
                    </td>
                    <td className="text-right px-3 py-2 font-mono text-text-secondary">
                      {fmtNum(item.target_price, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-text-tertiary">暂无分析师预期数据</div>
        )}
      </div>
    </div>
  );
}
