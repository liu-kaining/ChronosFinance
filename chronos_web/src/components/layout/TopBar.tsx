import { Link } from "react-router-dom";
import { Search, Sparkles, Activity } from "lucide-react";

import { cn } from "@/lib/cn";

interface TopBarProps {
  onOpenPalette: () => void;
  onOpenChat: () => void;
}

export function TopBar({ onOpenPalette, onOpenChat }: TopBarProps) {
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
              financial workstation
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
        <span>Search symbol, macro series, or ask AI…</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-2xs text-text-tertiary">
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5">K</kbd>
        </span>
      </button>

      <div className="flex items-center gap-3 text-text-secondary">
        <button
          type="button"
          onClick={onOpenChat}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-bg-3"
          title="Open AI chat (⌘J)"
        >
          <Sparkles size={14} />
          <span>Ask AI</span>
          <span className="ml-1 font-mono text-2xs text-text-tertiary">⌘J</span>
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
