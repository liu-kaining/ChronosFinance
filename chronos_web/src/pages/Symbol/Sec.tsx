import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api, endpoints } from "@/lib/api";
import type { SecFilingsListResponse } from "@/lib/types";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SymbolSec() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ["sec", sym],
    queryFn: () => api.get<SecFilingsListResponse>(endpoints.secFilings(sym)),
    enabled: !!sym,
    staleTime: 10 * 60_000,
  });

  const items = data?.items ?? [];

  // Group by fiscal year
  const byYear = items.reduce<Record<number, typeof items>>((acc, item) => {
    const year = item.fiscal_year ?? 0;
    if (!acc[year]) acc[year] = [];
    acc[year].push(item);
    return acc;
  }, {});

  const years = Object.keys(byYear)
    .map(Number)
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="card flex h-[300px] items-center justify-center">
          <div className="text-sm text-text-tertiary">Loading…</div>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex h-[300px] items-center justify-center">
          <div className="text-sm text-text-tertiary">No SEC filings available.</div>
        </div>
      ) : (
        <>
          {/* Timeline by year */}
          {years.map((year) => (
            <div key={year} className="card p-3">
              <div className="mb-2 text-sm font-semibold text-text-primary">
                FY {year}
              </div>
              <div className="flex flex-wrap gap-2">
                {byYear[year]?.map((f) => (
                  <a
                    key={f.id}
                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=${f.form_type}&dateb=${f.filing_date ?? ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-2.5 py-1.5 text-xs transition-colors hover:border-border hover:bg-bg-3"
                  >
                    <FormTypeBadge type={f.form_type} />
                    <span className="font-mono text-text-secondary">
                      {fmtDay(f.filing_date)}
                    </span>
                    {f.fiscal_period && (
                      <span className="text-text-tertiary">{f.fiscal_period}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Full table */}
          <div className="card overflow-auto p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              All Filings ({items.length})
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">Form</th>
                  <th className="px-2 py-1.5">Filing Date</th>
                  <th className="px-2 py-1.5">Fiscal Year</th>
                  <th className="px-2 py-1.5">Period</th>
                  <th className="px-2 py-1.5 text-right">Keys</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 50).map((f, i) => (
                  <tr
                    key={f.id}
                    className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                  >
                    <td className="px-2 py-1.5">
                      <FormTypeBadge type={f.form_type} />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-text-secondary">
                      {fmtDay(f.filing_date)}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {f.fiscal_year ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {f.fiscal_period ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-text-tertiary">
                      {f.content_keys_estimate ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function FormTypeBadge({ type }: { type: string }) {
  const color =
    type === "10-K"
      ? "bg-accent/15 text-accent"
      : type === "10-Q"
        ? "bg-purple/15 text-purple"
        : type === "8-K"
          ? "bg-warn/15 text-warn"
          : type === "DEF 14A"
            ? "bg-cyan/15 text-cyan"
            : "bg-bg-3 text-text-secondary";

  return (
    <span className={cn("rounded px-1.5 py-0.5 font-mono font-medium", color)}>
      {type}
    </span>
  );
}
