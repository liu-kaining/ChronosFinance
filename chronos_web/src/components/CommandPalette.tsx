import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, TrendingUp, Sparkles } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { UniverseItem, UniversePage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmtCap } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UniverseItem[]>([]);
  const [aiMode, setAiMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      setAiMode(false);
    }
  }, [open]);

  // Debounced symbol prefix search.
  useEffect(() => {
    if (!open || aiMode) return;
    const q = query.trim();
    if (!q) {
      setItems([]);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const page = await api.get<UniversePage>(endpoints.universe(), {
          params: { symbol_prefix: q.toUpperCase(), limit: 20 },
          signal: ctl.signal,
        });
        setItems(page.items ?? []);
      } catch {
        // aborted or network — silently ignore, UI shows "no results"
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, open, aiMode]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        label="Global command palette"
        className={cn(
          "w-[640px] max-w-[92vw] overflow-hidden rounded-card border border-border bg-panel shadow-card",
        )}
        shouldFilter={false}
      >
        <div className="flex items-center gap-2 border-b border-border-soft px-3">
          {aiMode ? (
            <Sparkles size={14} className="text-accent-2" />
          ) : (
            <Search size={14} className="text-text-secondary" />
          )}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              aiMode
                ? "输入问题… 例如：'ROE>20% 的 AI 芯片股'"
                : "搜索股票代码（NVDA、AAPL…）"
            }
            className="flex-1 bg-transparent py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAiMode((x) => !x)}
            className={cn(
              "rounded-md px-2 py-1 text-2xs font-medium transition-colors",
              aiMode
                ? "bg-accent-2/15 text-accent-2"
                : "bg-bg-3 text-text-secondary hover:text-text-primary",
            )}
            title="切换 AI 模式"
          >
            AI
          </button>
          <kbd className="hidden rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs text-text-tertiary sm:inline">
            Esc
          </kbd>
        </div>

        <Command.List className="max-h-[50vh] overflow-auto p-2">
          {aiMode ? (
            <div className="p-6 text-center text-sm text-text-secondary">
              <Sparkles className="mx-auto mb-2 text-accent-2" size={20} />
              AI mode is available once the <code>chronos_ai</code> service is
              启动后可用。
            </div>
          ) : (
            <>
              {loading ? (
                <Command.Loading>
                  <div className="p-3 text-xs text-text-tertiary">
                    搜索中…
                  </div>
                </Command.Loading>
              ) : null}

              {!loading && query.trim() && items.length === 0 ? (
                <Command.Empty>
                  <div className="p-3 text-xs text-text-tertiary">
                    没有匹配标的。
                  </div>
                </Command.Empty>
              ) : null}

              {items.map((it) => (
                <Command.Item
                  key={it.symbol}
                  value={it.symbol}
                  onSelect={() => {
                    navigate(`/symbol/${it.symbol}/overview`);
                    onClose();
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                    "aria-selected:bg-bg-3 aria-selected:text-text-primary",
                  )}
                >
                  <TrendingUp size={14} className="text-text-tertiary" />
                  <span className="ticker w-16 text-text-primary">
                    {it.symbol}
                  </span>
                  <span className="flex-1 truncate text-text-secondary">
                    {it.company_name ?? "—"}
                  </span>
                  <span className="text-2xs text-text-tertiary">
                    {it.sector ?? ""}
                  </span>
                  <span className="w-16 text-right font-mono text-2xs text-text-tertiary">
                    {fmtCap(it.market_cap)}
                  </span>
                </Command.Item>
              ))}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
