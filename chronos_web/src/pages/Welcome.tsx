import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  ShieldCheck,
  Sparkles,
  Database,
  Activity,
  TrendingUp,
} from "lucide-react";
import { api, endpoints } from "@/lib/api";
import type {
  IngestHealthResponse,
  MarketSnapshotResponse,
  StatsOverview,
  SyncProgressResponse,
} from "@/lib/types";
import { fmtCap, fmtNum, fmtPct, fmtPctSigned } from "@/lib/format";

const TILES = [
  {
    to: "/global/market-pulse",
    title: "Market Pulse",
    desc: "Sector treemap, winners & losers, rotation.",
    icon: <LayoutDashboard className="text-accent" size={20} />,
  },
  {
    to: "/global/macro",
    title: "Macro Dashboard",
    desc: "Treasury curve, CPI/GDP, macro series browser.",
    icon: <LineChart className="text-accent-2" size={20} />,
  },
  {
    to: "/global/events",
    title: "Event Stream",
    desc: "Upcoming earnings, corporate actions, insider flow.",
    icon: <CalendarClock className="text-purple" size={20} />,
  },
  {
    to: "/global/quality",
    title: "Data Quality",
    desc: "Freshness matrix, budget gauge, failure ranking.",
    icon: <ShieldCheck className="text-up" size={20} />,
  },
];

const RETRY_SYNC_PATH: Record<string, string> = {
  filings: "alpha/filings",
  insider: "alpha/insider",
  estimates: "alpha/estimates",
  segments: "segments",
  earnings: "events/earnings",
  prices: "market/prices",
};

function retryCommandFor(datasetKey: string): string {
  const path = RETRY_SYNC_PATH[datasetKey];
  if (!path) return "";
  return `curl -X POST "http://localhost:\${APP_WRITE_PORT:-8004}/api/v1/sync/${path}"`;
}

export function WelcomePage() {
  const { data: stats } = useQuery({
    queryKey: ["welcome-stats"],
    queryFn: () => api.get<StatsOverview>(endpoints.statsOverview()),
    staleTime: 60_000,
  });
  const { data: sync } = useQuery({
    queryKey: ["welcome-sync"],
    queryFn: () => api.get<SyncProgressResponse>(endpoints.syncProgress()),
    staleTime: 60_000,
  });
  const { data: market } = useQuery({
    queryKey: ["welcome-market"],
    queryFn: () => api.get<MarketSnapshotResponse>(endpoints.marketSnapshot(), { params: { limit: 5 } }),
    staleTime: 30_000,
  });
  const { data: ingest } = useQuery({
    queryKey: ["welcome-ingest-health"],
    queryFn: () => api.get<IngestHealthResponse>(endpoints.ingestHealth()),
    staleTime: 20_000,
  });

  const active = sync?.active_symbols ?? 0;
  const coreDone =
    active > 0
      ? ([
          sync?.active_with_income_synced ?? 0,
          sync?.active_with_balance_synced ?? 0,
          sync?.active_with_cashflow_synced ?? 0,
          sync?.active_with_prices_synced ?? 0,
          sync?.active_with_earnings_synced ?? 0,
        ].reduce((a, b) => a + b, 0) /
          (active * 5))
      : 0;
  const freshnessLabel =
    coreDone >= 0.95 && (ingest?.failed ?? 0) === 0
      ? "fresh"
      : coreDone >= 0.8
        ? "stable"
        : "catching up";
  const freshnessClass =
    freshnessLabel === "fresh"
      ? "border-up/40 bg-up-soft text-up"
      : freshnessLabel === "stable"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-down/40 bg-down-soft text-down";
  const syncClosing = [
    { key: "filings", done: sync?.active_with_filings_synced ?? 0 },
    { key: "insider", done: sync?.active_with_insider_synced ?? 0 },
    { key: "estimates", done: sync?.active_with_estimates_synced ?? 0 },
    { key: "segments", done: sync?.active_with_segments_synced ?? 0 },
    { key: "earnings", done: sync?.active_with_earnings_synced ?? 0 },
    { key: "prices", done: sync?.active_with_prices_synced ?? 0 },
  ]
    .map((x) => {
      const missing = Math.max(0, active - x.done);
      const ratio = active > 0 ? x.done / active : 0;
      return { ...x, missing, ratio };
    })
    .sort((a, b) => b.missing - a.missing);

  return (
    <div className="mx-auto max-w-5xl py-10">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-text-secondary">
          <Sparkles size={14} className="text-accent-2" />
          <span className="text-xs uppercase tracking-wider">
            Chronos Finance
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-text-primary">
          Wall Street–grade data workstation
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Professional financial data, charts, and AI-assisted research — one
          unified interface. Press{" "}
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">
            ⌘K
          </kbd>{" "}
          to search any symbol, or{" "}
          <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">
            ⌘J
          </kbd>{" "}
          to ask the AI analyst.
        </p>
      </div>

      <div className="card mb-6 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <DataKpi
          icon={<Database size={14} />}
          label="Active Symbols"
          value={fmtNum(stats?.universe.active, 0)}
          sub={`${fmtNum(stats?.universe.total, 0)} total`}
        />
        <DataKpi
          icon={<Activity size={14} />}
          label="Rows (Core Tables)"
          value={fmtCap(
            (stats?.tables.daily_prices ?? 0) +
              (stats?.tables.static_financials ?? 0) +
              (stats?.tables.earnings_calendar ?? 0),
            0,
          )}
          sub="prices + financials + earnings"
        />
        <DataKpi
          icon={<ShieldCheck size={14} />}
          label="Core Coverage"
          value={fmtPctSigned(coreDone, 1)}
          sub={`${fmtNum(sync?.active_with_filings_synced, 0)}/${fmtNum(active, 0)} filings`}
        />
        <DataKpi
          icon={<TrendingUp size={14} />}
          label="Best Mover"
          value={market?.top_gainers?.[0]?.symbol ?? "—"}
          sub={fmtPctSigned(market?.top_gainers?.[0]?.change_pct, 2)}
        />
      </div>

      <div className="card mb-6 p-4">
        <div className="mb-1 text-2xs uppercase tracking-wider text-text-tertiary">Market Brief</div>
        <div className="text-sm text-text-secondary">
          {market?.top_gainers?.[0]?.symbol ? (
            <>
              Today strongest is <span className="ticker text-text-primary">{market.top_gainers[0].symbol}</span>{" "}
              ({fmtPctSigned(market.top_gainers[0].change_pct, 2)}), while weakness centers on{" "}
              <span className="ticker text-text-primary">{market.top_losers?.[0]?.symbol ?? "—"}</span>.{" "}
              Dominant sector by breadth:{" "}
              <span className="text-text-primary">{market.sectors?.[0]?.sector ?? "—"}</span>.
            </>
          ) : (
            "Market snapshot is loading."
          )}
        </div>
        <div className="mt-2 text-2xs text-text-tertiary">
          Data freshness:{" "}
          <span className={`rounded border px-1.5 py-0.5 font-medium uppercase ${freshnessClass}`}>
            {freshnessLabel}
          </span>{" "}
          (coverage{" "}
          {fmtPctSigned(coreDone, 1)}, queue running {fmtNum(ingest?.running, 0)}, failed{" "}
          {fmtNum(ingest?.failed, 0)}).
        </div>
      </div>

      <div className="card mb-6 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-2xs uppercase tracking-wider text-text-tertiary">Sync Closing Panel</div>
          <div className="text-2xs text-text-tertiary">
            Remaining total:{" "}
            <span className="font-mono text-text-secondary">
              {fmtNum(syncClosing.reduce((acc, x) => acc + x.missing, 0), 0)}
            </span>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft text-left text-text-tertiary">
                <th className="px-2 py-1.5">Dataset</th>
                <th className="px-2 py-1.5 text-right">Done</th>
                <th className="px-2 py-1.5 text-right">Missing</th>
                <th className="px-2 py-1.5 text-right">Coverage</th>
                <th className="px-2 py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {syncClosing.map((row, i) => (
                <tr key={row.key} className={i % 2 === 0 ? "bg-bg-2/30" : ""}>
                  <td className="px-2 py-1.5">
                    <span className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs uppercase text-text-secondary">
                      {row.key}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtNum(row.done, 0)} / {fmtNum(active, 0)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      row.missing > 0 ? "text-warn" : "text-up"
                    }`}
                  >
                    {fmtNum(row.missing, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtPct(row.ratio, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {row.missing > 0 ? (
                      <button
                        type="button"
                        className="rounded border border-border-soft px-2 py-0.5 text-2xs text-text-secondary hover:bg-bg-2"
                        onClick={() => {
                          const cmd = retryCommandFor(row.key);
                          if (!cmd) return;
                          void navigator.clipboard.writeText(cmd);
                        }}
                        title="Copy retry command"
                      >
                        Copy Retry Cmd
                      </button>
                    ) : (
                      <span className="text-2xs text-up">Done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-2xs text-text-tertiary">
          Buttons copy a retry command to clipboard, then run it in terminal.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TILES.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="card card-hover flex items-start gap-3 p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bg-2">
              {t.icon}
            </div>
            <div className="flex-1">
              <div className="font-medium text-text-primary">{t.title}</div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {t.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DataKpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-2xs text-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      <div className="kpi-num">{value}</div>
      {sub ? <div className="text-2xs text-text-secondary">{sub}</div> : null}
    </div>
  );
}
