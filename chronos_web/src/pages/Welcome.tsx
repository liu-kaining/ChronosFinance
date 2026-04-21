import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

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

export function WelcomePage() {
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
