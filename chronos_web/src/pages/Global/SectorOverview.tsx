import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api, endpoints } from "@/lib/api";
import type { SectorTrendsResponse } from "@/lib/types";
import { fmtPctSigned, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageNarrative } from "@/components/ui/PageNarrative";
import { SectionHeader } from "@/components/shared/SectionHeader";

export function SectorOverviewPage() {
  const { data: sectorTrends, isLoading } = useQuery({
    queryKey: ["sector-trends"],
    queryFn: () => api.get<SectorTrendsResponse>(endpoints.sectorTrends()),
    staleTime: 60_000,
  });

  const trends = sectorTrends?.trends ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="板块排名"
        description="按1日涨跌排序，含1周/1月变化和平均PE。"
      />

      <div className="card overflow-hidden">
        <SectionHeader title="板块表现" subtitle={`共 ${trends.length} 个板块`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-soft text-text-tertiary text-xs">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">板块</th>
                <th className="text-right px-4 py-3 font-medium">1日涨跌</th>
                <th className="text-right px-4 py-3 font-medium">1周涨跌</th>
                <th className="text-right px-4 py-3 font-medium">1月涨跌</th>
                <th className="text-right px-4 py-3 font-medium">平均PE</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((t, i) => {
                const change1d = t.change_1d;
                const change1w = t.change_1w;
                const change1m = t.change_1m;
                return (
                  <tr key={t.sector} className="border-b border-border-soft/50 hover:bg-bg-2/30">
                    <td className="px-4 py-3 text-text-tertiary font-mono">{i + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/sector/${encodeURIComponent(t.sector)}`}
                        className="text-text-primary hover:text-accent font-medium"
                      >
                        {t.sector}
                      </Link>
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      <span className={cn(
                        (change1d ?? 0) > 0 ? "text-up" : (change1d ?? 0) < 0 ? "text-down" : "text-text-secondary"
                      )}>
                        {fmtPctSigned(change1d ? change1d / 100 : null, 2)}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      <span className={cn(
                        (change1w ?? 0) > 0 ? "text-up" : (change1w ?? 0) < 0 ? "text-down" : "text-text-secondary"
                      )}>
                        {fmtPctSigned(change1w ? change1w / 100 : null, 2)}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      <span className={cn(
                        (change1m ?? 0) > 0 ? "text-up" : (change1m ?? 0) < 0 ? "text-down" : "text-text-secondary"
                      )}>
                        {fmtPctSigned(change1m ? change1m / 100 : null, 2)}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-text-secondary">
                      {t.avg_pe ? fmtNum(t.avg_pe, 1) : "—"}
                    </td>
                    <td className="text-right px-4 py-3">
                      <Link
                        to={`/sector/${encodeURIComponent(t.sector)}`}
                        className="text-xs text-accent hover:underline"
                      >
                        详情
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {trends.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-tertiary">
                    {isLoading ? "加载中..." : "暂无板块数据"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
