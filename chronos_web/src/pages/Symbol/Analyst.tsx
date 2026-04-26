import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { AnalystEstimatesResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtCap, fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

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
  const [selectedConsensusKey, setSelectedConsensusKey] = useState<string>("");

  // Group by kind
  const priceTargets = items.filter((i) => i.kind === "price_target" || i.kind?.includes("price_target"));
  const consensusAnnual = items.filter((i) => i.kind === "consensus_annual");
  const consensusQuarter = items.filter((i) => i.kind === "consensus_quarter");
  const consensusRows = useMemo(
    () =>
      [...consensusAnnual.slice(0, 5), ...consensusQuarter.slice(0, 5)].map((c, idx) => ({
        ...c,
        __key: `${c.kind ?? "NA"}-${c.ref_date ?? "NA"}-${idx}`,
      })),
    [consensusAnnual, consensusQuarter],
  );

  // Extract latest price target
  const latestTarget = priceTargets[0]?.raw_payload as Record<string, unknown> | undefined;

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="预期叙事"
        description="先看目标价区间与中位数，再看盈利一致预期，判断当前价格与市场共识之间的偏离程度。"
        actions={
          <>
            <Link to={`/symbol/${sym}/overview`} className="chip">回看当前定价</Link>
            <Link to={`/symbol/${sym}/events`} className="chip">交叉验证业绩兑现</Link>
            <Link to={`/symbol/${sym}/raw`} className="chip">核对原始分析师数据</Link>
          </>
        }
      />
      {isLoading ? (
        <div className="card flex h-[300px] items-center justify-center">
          <div className="text-sm text-text-tertiary">加载分析师数据中…</div>
        </div>
      ) : (
        <>
          {/* Price target cards */}
          {latestTarget && (
            <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <MetricCard
                label="目标价下限"
                value={extractNum(latestTarget, "targetLow")}
              />
              <MetricCard
                label="目标价均值"
                value={extractNum(latestTarget, "targetMean")}
                highlight
              />
              <MetricCard
                label="目标价上限"
                value={extractNum(latestTarget, "targetHigh")}
              />
              <MetricCard
                label="目标价中位数"
                value={extractNum(latestTarget, "targetMedian")}
              />
            </div>
          )}

          {/* Price target distribution chart */}
          {priceTargets.length > 0 && (
            <div className="card p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                目标价分布
              </div>
              <PriceTargetChart data={priceTargets.slice(0, 5)} />
            </div>
          )}

          {/* Consensus table */}
          <div className="card overflow-auto p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              一致预期
            </div>
            <table className="table-modern">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">类型</th>
                  <th className="px-2 py-1.5">参考日期</th>
                  <th className="px-2 py-1.5 text-right">EPS 预期</th>
                  <th className="px-2 py-1.5 text-right">营收预期</th>
                  <th className="px-2 py-1.5 text-right">EBITDA 预期</th>
                </tr>
              </thead>
              <tbody>
                {consensusRows.map((c, i) => {
                  const payload = c.raw_payload as Record<string, unknown>;
                  return (
                    <tr
                      key={c.__key}
                      className={cn(
                        "cursor-pointer border-b border-border-soft/50",
                        i % 2 === 0 ? "bg-bg-2/30" : "",
                        selectedConsensusKey === c.__key ? "bg-accent/10" : "",
                      )}
                      onClick={() => setSelectedConsensusKey(c.__key)}
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
            {consensusRows.length === 0 && (
              <div className="p-3">
                <EmptyDataState
                  title="暂无一致预期数据"
                  detail="可先看目标价分布或回到事件页验证业绩兑现情况。"
                  actions={
                    <>
                      <Link to={`/symbol/${sym}/events`} className="chip">去看业绩与事件</Link>
                      <Link to={`/symbol/${sym}/raw`} className="chip">查看原始 JSON</Link>
                    </>
                  }
                />
              </div>
            )}
          </div>

          {/* Raw analyst rows */}
          {items.length > 0 && (
            <div className="card overflow-auto p-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                全部分析师数据（{items.length} 行）
              </div>
              <table className="table-modern">
                <thead>
                  <tr className="border-b border-border-soft text-left text-text-tertiary">
                    <th className="px-2 py-1.5">类型</th>
                    <th className="px-2 py-1.5">参考日期</th>
                    <th className="px-2 py-1.5">发布时间</th>
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
            <div className="card p-4">
              <EmptyDataState
                title="暂无分析师数据"
                detail="可能是供应商覆盖不足，或该标的暂未同步该数据集。"
                actions={
                  <>
                    <Link to="/global/data-assets?table=analyst_estimates" className="chip">查看分析师覆盖</Link>
                    <Link to={`/symbol/${sym}/raw`} className="chip">查看原始 JSON</Link>
                  </>
                }
              />
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
    return <div className="py-4 text-center text-xs text-text-tertiary">暂无目标价数据</div>;
  }

  const latest = targets[0]!;

  const option = {
    ...echartsBase,
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number }) => `${params.name}：${fmtNum(params.value, 2)}`,
    },
    grid: { left: 48, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: "category",
      data: ["下限", "中位", "均值", "上限"],
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
