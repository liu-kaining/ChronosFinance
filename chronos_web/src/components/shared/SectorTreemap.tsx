import { Link } from "react-router-dom";
import { fmtNum, fmtCap } from "../../lib/format";

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
      <div className="text-center text-gray-500 py-8">No sector data available</div>
    );
  }

  // Sort by market cap descending
  const sorted = [...sectors].sort(
    (a, b) => (b.market_cap_total ?? 0) - (a.market_cap_total ?? 0)
  );

  // Calculate total market cap for sizing
  const totalMarketCap = sorted.reduce(
    (sum, s) => sum + (s.market_cap_total ?? 0),
    0
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {sorted.map((sector) => {
        const pct = totalMarketCap > 0
          ? ((sector.market_cap_total ?? 0) / totalMarketCap) * 100
          : 0;
        const changePct = sector.avg_change_pct ?? 0;
        const bgColor =
          changePct > 0.5
            ? "bg-emerald-900/40 border-emerald-700/50"
            : changePct < -0.5
            ? "bg-red-900/40 border-red-700/50"
            : "bg-gray-800/40 border-gray-700/50";

        return (
          <Link
            key={sector.sector}
            to={`/sector/${encodeURIComponent(sector.sector)}`}
            className={`${bgColor} border rounded-lg p-3 hover:opacity-80 transition-opacity`}
          >
            <div className="text-sm font-medium text-gray-200 truncate">
              {sector.sector}
            </div>
            <div className={`text-lg font-semibold ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmtPctValue(changePct)}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{sector.symbols} stocks</span>
              <span>{pct.toFixed(1)}%</span>
            </div>
            {sector.market_cap_total && (
              <div className="text-xs text-gray-500 mt-0.5">
                {fmtCap(sector.market_cap_total)}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
