import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { AnalystEstimatesResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtCap, fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SymbolAnalyst() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ["analyst", sym],
    queryFn: () => api.get<AnalystEstimatesResponse>(endpoints.analyst(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const items = data?.items ?? [];

  // Group by kind
  const priceTargets = items.filter((i) => i.kind === "price_target" || i.kind?.includes("price_target"));
  const consensusAnnual = items.filter((i) => i.kind === "consensus_annual");
  const consensusQuarter = items.filter((i) => i.kind === "consensus_quarter");

  // Extract latest price target
  const latestTarget = priceTargets[0]?.raw_payload as Record<string, unknown> | undefined;

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="card flex h-[300px] items-center justify-center">
          <div className="text-sm text-text-tertiary">Loading…</div>
        </div>
      ) : (
        <>
          {/* Price target cards */}
          {latestTarget && (
            <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <MetricCard
                label="Target Low"
                value={extractNum(latestTarget, "targetLow")}
              />
              <MetricCard
                label="Target Mean"
                value={extractNum(latestTarget, "targetMean")}
                highlight
              />
              <MetricCard
                label="Target High"
                value={extractNum(latestTarget, "targetHigh")}
              />
              <MetricCard
                label="Target Median"
                value={extractNum(latestTarget, "targetMedian")}
              />
            </div>
          )}

          {/* Price target distribution chart */}
          {priceTargets.length > 0 && (
            <div className="card p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Price Target Distribution
              </div>
              <PriceTargetChart data={priceTargets.slice(0, 5)} />
            </div>
          )}

          {/* Consensus table */}
          <div className="card overflow-auto p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Consensus Estimates
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">Kind</th>
                  <th className="px-2 py-1.5">Ref Date</th>
                  <th className="px-2 py-1.5 text-right">EPS Est</th>
                  <th className="px-2 py-1.5 text-right">Rev Est</th>
                  <th className="px-2 py-1.5 text-right">EBITDA Est</th>
                </tr>
              </thead>
              <tbody>
                {[...consensusAnnual.slice(0, 5), ...consensusQuarter.slice(0, 5)].map((c, i) => {
                  const payload = c.raw_payload as Record<string, unknown>;
                  return (
                    <tr
                      key={`${c.kind}-${c.ref_date}-${i}`}
                      className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                    >
                      <td className="px-2 py-1.5">
                        <span className="chip">{c.kind}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">
                        {fmtDay(c.ref_date)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                        {fmtNum(extractNum(payload, "estimatedEpsAvg"), 2)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                        {fmtCap(extractNum(payload, "estimatedRevenueAvg"))}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                        {fmtCap(extractNum(payload, "estimatedEbitdaAvg"))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {consensusAnnual.length === 0 && consensusQuarter.length === 0 && (
              <div className="py-4 text-center text-xs text-text-tertiary">
                No consensus data
              </div>
            )}
          </div>

          {/* Raw analyst rows */}
          {items.length > 0 && (
            <div className="card overflow-auto p-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                All Analyst Data ({items.length} rows)
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-soft text-left text-text-tertiary">
                    <th className="px-2 py-1.5">Kind</th>
                    <th className="px-2 py-1.5">Ref Date</th>
                    <th className="px-2 py-1.5">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 20).map((a, i) => (
                    <tr
                      key={`${a.kind}-${i}`}
                      className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                    >
                      <td className="px-2 py-1.5 text-text-primary">{a.kind}</td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">
                        {fmtDay(a.ref_date)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-text-secondary">
                        {fmtDay(a.published_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {items.length === 0 && (
            <div className="card flex h-[200px] items-center justify-center">
              <div className="text-sm text-text-tertiary">No analyst data available.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function extractNum(obj: Record<string, unknown> | undefined, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === "number") return v;
  return null;
}

function MetricCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className={cn("kpi-num", highlight && "text-accent")}>
        {value !== null ? fmtNum(value, 2) : "—"}
      </div>
    </div>
  );
}

function PriceTargetChart({ data }: { data: Array<{ raw_payload: Record<string, unknown> }> }) {
  if (!data.length) return null;

  const targets = data.map((d) => {
    const p = d.raw_payload;
    return {
      low: typeof p.targetLow === "number" ? p.targetLow : null,
      mean: typeof p.targetMean === "number" ? p.targetMean : null,
      high: typeof p.targetHigh === "number" ? p.targetHigh : null,
      median: typeof p.targetMedian === "number" ? p.targetMedian : null,
    };
  }).filter((t) => t.mean != null);

  if (targets.length === 0) {
    return <div className="py-4 text-center text-xs text-text-tertiary">No price target data</div>;
  }

  const latest = targets[0]!;

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "item",
    },
    grid: { left: 48, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: ["Low", "Median", "Mean", "High"],
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: [
          { value: latest.low, itemStyle: { color: COLORS.down } },
          { value: latest.median, itemStyle: { color: COLORS.purple } },
          { value: latest.mean, itemStyle: { color: COLORS.accent } },
          { value: latest.high, itemStyle: { color: COLORS.up } },
        ],
        barWidth: "50%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 180 }} />;
}
