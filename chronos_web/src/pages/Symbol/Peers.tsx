import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, ExternalLink } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SymbolInventory } from "@/lib/types";
import { EmptyDataState } from "@/components/ui/EmptyDataState";
import { PageNarrative } from "@/components/ui/PageNarrative";

export function SymbolPeers() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: inv, isLoading } = useQuery({
    queryKey: ["inventory", sym],
    queryFn: () => api.get<SymbolInventory>(endpoints.symbolInventory(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  // Check if peers data exists
  const hasPeers = inv?.tables?.peers_snapshot?.rows ?? 0 > 0;

  // Extract peers from raw_payload if available
  // Note: This would need a backend endpoint to expose peers data
  // For now, show a placeholder

  return (
    <div className="flex flex-col gap-4">
      <PageNarrative
        title="同业叙事"
        description="同业页用于横向比较估值与盈利质量，验证当前标的是行业领先还是补涨。"
      />

      <div className="card p-4">
        {isLoading ? (
          <div className="h-[100px] animate-pulse rounded bg-bg-3" />
        ) : hasPeers ? (
          <EmptyDataState
            title="已检测到同业数据"
            detail="数据库已存在同业快照；待读接口开放后，这里将展示同业估值/盈利对比图。"
          />
        ) : (
          <EmptyDataState
            title={`暂无 ${sym} 的同业数据`}
            detail="可先在事件与财务页完成判断；同业数据可通过供应商 peers 数据集补齐。"
          />
        )}
      </div>

      {/* Placeholder peer cards */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          行业同业（占位）
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["同业A", "同业B", "同业C", "同业D"].map((peer) => (
            <div
              key={peer}
              className="rounded-md border border-border-soft bg-bg-2 px-3 py-3 text-center"
            >
              <div className="ticker text-sm text-text-primary">{peer}</div>
              <div className="mt-1 text-2xs text-text-tertiary">行业可比标的</div>
            </div>
          ))}
        </div>
      </div>

      {/* External link */}
      <div className="card p-3">
        <a
          href={`https://finance.yahoo.com/quote/${sym}/analysis`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-accent hover:text-accent/80"
        >
          <ExternalLink size={14} />
          <span>在 Yahoo Finance 查看可比分析</span>
        </a>
      </div>
    </div>
  );
}
