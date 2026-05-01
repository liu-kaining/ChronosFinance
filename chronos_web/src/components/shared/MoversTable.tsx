import { Link } from "react-router-dom";
import type { MoverRow } from "../../lib/types";
import { fmtNum, fmtPctSigned, fmtCap } from "../../lib/format";

interface MoversTableProps {
  title: string;
  rows: MoverRow[];
  maxRows?: number;
}

function formatVolume(v: number | null | undefined): string {
  return fmtCap(v);
}

export function MoversTable({ title, rows, maxRows = 10 }: MoversTableProps) {
  const displayRows = rows.slice(0, maxRows);

  return (
    <div className="bg-gray-800/30 rounded-lg border border-gray-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50">
        <h3 className="text-sm font-medium text-gray-200">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs">
              <th className="text-left px-4 py-2 font-medium">Symbol</th>
              <th className="text-right px-4 py-2 font-medium">Price</th>
              <th className="text-right px-4 py-2 font-medium">Change</th>
              <th className="text-right px-4 py-2 font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const isPositive = (row.change_pct ?? 0) >= 0;
              return (
                <tr key={row.symbol} className="border-t border-gray-700/30 hover:bg-gray-700/20">
                  <td className="px-4 py-2">
                    <Link
                      to={`/symbol/${row.symbol}/price`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {row.symbol}
                    </Link>
                    {row.company_name && (
                      <span className="text-gray-500 text-xs ml-2 truncate max-w-[120px] inline-block align-bottom">
                        {row.company_name}
                      </span>
                    )}
                  </td>
                  <td className="text-right px-4 py-2 text-gray-200 font-mono">
                    {fmtNum(row.close)}
                  </td>
                  <td className={`text-right px-4 py-2 font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtPctSigned(row.change_pct)}
                  </td>
                  <td className="text-right px-4 py-2 text-gray-400 font-mono">
                    {formatVolume(row.volume)}
                  </td>
                </tr>
              );
            })}
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
