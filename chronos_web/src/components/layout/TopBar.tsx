import { Link } from "react-router-dom";
import { Search, Sparkles, Activity, Sun, Moon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/cn";
import { api, endpoints } from "@/lib/api";
import type { IngestHealthResponse, SyncProgressResponse } from "@/lib/types";
import { fmtNum } from "@/lib/format";

interface TopBarProps {
  onOpenPalette: () => void;
  onOpenChat: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function TopBar({ onOpenPalette, onOpenChat, theme, onToggleTheme }: TopBarProps) {
  const { data: sync } = useQuery({
    queryKey: ["topbar-sync-progress"],
    queryFn: () => api.get<SyncProgressResponse>(endpoints.syncProgress()),
    staleTime: 30_000,
  });
  const { data: ingest } = useQuery({
    queryKey: ["topbar-ingest-health"],
    queryFn: () => api.get<IngestHealthResponse>(endpoints.ingestHealth()),
    staleTime: 20_000,
  });
  const active = sync?.active_symbols ?? 0;
  const coreCoverage =
    active > 0
      ? Math.round(
          ((sync?.active_with_income_synced ?? 0) +
            (sync?.active_with_balance_synced ?? 0) +
            (sync?.active_with_cashflow_synced ?? 0) +
            (sync?.active_with_prices_synced ?? 0) +
            (sync?.active_with_earnings_synced ?? 0)) /
            (active * 5) *
            100,
        )
      : 0;
  const statusClass =
    coreCoverage >= 95 ? "bg-up" : coreCoverage >= 80 ? "bg-warn" : "bg-down";
  const queueWarn = (ingest?.failed ?? 0) > 0;
  const queueBusy = (ingest?.running ?? 0) >= 20;
  const queueClass = queueWarn
    ? "border-down/40 bg-down-soft/30 text-down"
    : queueBusy
      ? "border-warn/40 bg-warn/10 text-warn"
      : "border-border-soft bg-bg-2 text-text-secondary";

  return (
    <header
      className={cn(
        "flex h-14 items-center justify-between border-b border-border-soft bg-panel px-4",
      )}
    >
      <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Activity size={16} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="ticker text-sm text-text-primary">CHRONOS</span>
            <span className="text-2xs text-text-tertiary">
              金融决策工作台
            </span>
          </div>
        </Link>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "group flex w-[420px] max-w-[40vw] items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-border hover:bg-bg-3",
        )}
      >
        <Search size={14} />
        <span>搜索标的、宏观序列，或直接问 AI…</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-2xs text-text-tertiary">
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5">K</kbd>
        </span>
      </button>

      <div className="flex items-center gap-3 text-text-secondary">
        <div className="hidden items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-2 py-1 text-2xs md:flex">
          <span className={cn("h-2 w-2 rounded-full", statusClass)} />
          <span className="text-text-secondary">
            覆盖率 {coreCoverage}% · 活跃 {fmtNum(active, 0)}
          </span>
        </div>
        <div className={cn("hidden items-center gap-2 rounded-md border px-2 py-1 text-2xs lg:flex", queueClass)}>
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              queueWarn ? "animate-pulse bg-down" : queueBusy ? "animate-pulse bg-warn" : "bg-up",
            )}
          />
          <span>
            队列 运行:{fmtNum(ingest?.running, 0)} 失败:{fmtNum(ingest?.failed, 0)}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenChat}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-bg-3"
          title="打开 AI 助手 (⌘J)"
        >
          <Sparkles size={14} />
          <span>问 AI</span>
          <span className="ml-1 font-mono text-2xs text-text-tertiary">⌘J</span>
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex items-center gap-1 rounded-md border border-border-soft bg-bg-2 px-2 py-1 text-xs hover:bg-bg-3"
          title="切换明暗主题"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          <span>{theme === "dark" ? "浅色" : "深色"}</span>
        </button>
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="text-xs hover:text-text-primary"
        >
          API
        </a>
      </div>
    </header>
  );
}
