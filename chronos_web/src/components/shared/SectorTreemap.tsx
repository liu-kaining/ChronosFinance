import { Link } from "react-router-dom";
import { fmtCap, fmtNum } from "../../lib/format";
import { cn } from "../../lib/cn";

function fmtPctValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtNum(value)}%`;
}

interface SectorData {
  sector: string;
  symbols: number;
  market_cap_total?: number;
  avg_change_pct?: number;
}

interface SectorTreemapProps {
  sectors: SectorData[];
}

export function SectorTreemap({ sectors }: SectorTreemapProps) {
  if (!sectors.length) {
    return (
      <div className="py-8 text-center text-sm text-text-tertiary">暂无板块数据</div>
    );
  }

  // Sort by market cap descending
  const sorted = [...sectors].sort(
    (a, b) => (b.market_cap_total ?? 0) - (a.market_cap_total ?? 0),
  );

  // Calculate total market cap for sizing
  const totalMarketCap = sorted.reduce(
    (sum, s) => sum + (s.market_cap_total ?? 0),
    0,
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {sorted.map((sector) => {
        const pct =
          totalMarketCap > 0
            ? ((sector.market_cap_total ?? 0) / totalMarketCap) * 100
            : 0;
        const changePct = sector.avg_change_pct ?? 0;

        return (
          <Link
            key={sector.sector}
            to={`/sector/${encodeURIComponent(sector.sector)}`}
            className={cn(
              "rounded-lg border p-3 transition-all hover:-translate-y-0.5 hover:shadow-md",
              changePct > 0.5
                ? "border-up/20 bg-up/5"
                : changePct < -0.5
                  ? "border-down/20 bg-down/5"
                  : "border-border-soft bg-bg-2/50",
            )}
          >
            <div className="truncate text-sm font-medium text-text-primary">
              {sector.sector}
            </div>
            <div
              className={cn(
                "text-lg font-semibold",
                changePct >= 0 ? "text-up" : "text-down",
              )}
            >
              {fmtPctValue(changePct)}
            </div>
            <div className="mt-1 flex justify-between text-2xs text-text-tertiary">
              <span>{sector.symbols} 只</span>
              <span>{pct.toFixed(1)}%</span>
            </div>
            {sector.market_cap_total && (
              <div className="mt-0.5 text-2xs text-text-tertiary">
                {fmtCap(sector.market_cap_total)}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
