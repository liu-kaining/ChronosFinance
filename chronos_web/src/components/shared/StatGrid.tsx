import { ReactNode } from "react";

interface StatItem {
  label: string;
  value: ReactNode;
  hint?: string;
  color?: "green" | "red" | "yellow" | "blue" | "gray";
}

interface StatGridProps {
  items: StatItem[];
  columns?: 2 | 3 | 4;
}

const colorMap = {
  green: "text-emerald-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  blue: "text-blue-400",
  gray: "text-gray-300",
};

export function StatGrid({ items, columns = 4 }: StatGridProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-3`}>
      {items.map((item, i) => (
        <div key={i} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
          <div className="text-xs text-gray-400 mb-1">{item.label}</div>
          <div className={`text-lg font-semibold ${item.color ? colorMap[item.color] : "text-gray-100"}`}>
            {item.value}
          </div>
          {item.hint && <div className="text-xs text-gray-500 mt-0.5">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}
