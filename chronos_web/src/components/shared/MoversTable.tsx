import { Link } from "react-router-dom";
import type { MoverRow } from "../../lib/types";
import { fmtNum, fmtPctSigned, fmtCap } from "../../lib/format";
import { cn } from "../../lib/cn";

interface MoversTableProps {
  title: string;
  rows: MoverRow[];
  maxRows?: number;
}

export function MoversTable({ title, rows, maxRows = 10 }: MoversTableProps) {
  const displayRows = rows.slice(0, maxRows);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border-soft px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-tertiary">
              <th className="px-4 py-2 text-left font-medium">标的</th>
              <th className="px-4 py-2 text-right font-medium">价格</th>
              <th className="px-4 py-2 text-right font-medium">涨跌</th>
              <th className="px-4 py-2 text-right font-medium">成交量</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const isPositive = (row.change_pct ?? 0) >= 0;
              return (
                <tr
                  key={row.symbol}
                  className="border-t border-border-soft/40 transition-colors hover:bg-bg-2/50"
                >
                  <td className="px-4 py-2">
                    <Link
                      to={`/symbol/${row.symbol}/price`}
                      className="font-medium text-accent hover:text-accent/80"
                    >
                      {row.symbol}
                    </Link>
                    {row.company_name && (
                      <span className="ml-2 inline-block max-w-[120px] truncate align-bottom text-2xs text-text-tertiary">
                        {row.company_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-primary">
                    {fmtNum(row.close)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right font-mono",
                      isPositive ? "text-up" : "text-down",
                    )}
                  >
                    {fmtPctSigned(row.change_pct)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-secondary">
                    {fmtCap(row.volume)}
                  </td>
                </tr>
              );
            })}
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-tertiary">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
