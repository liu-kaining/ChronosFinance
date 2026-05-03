import { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface StatItem {
  label: string;
  value: ReactNode;
  hint?: string;
  color?: "up" | "down" | "warn" | "accent" | "default";
}

interface StatGridProps {
  items: StatItem[];
  columns?: 2 | 3 | 4;
}

const colorMap = {
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
  accent: "text-accent",
  default: "text-text-primary",
};

export function StatGrid({ items, columns = 4 }: StatGridProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-3", gridCols[columns])}>
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-border-soft bg-bg-2/50 p-3"
        >
          <div className="text-2xs text-text-tertiary">{item.label}</div>
          <div
            className={cn(
              "mt-1 text-lg font-semibold",
              item.color ? colorMap[item.color] : "text-text-primary",
            )}
          >
            {item.value}
          </div>
          {item.hint && (
            <div className="mt-0.5 text-2xs text-text-tertiary">{item.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}
