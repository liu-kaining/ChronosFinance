import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  ShieldCheck,
  Compass,
  Layers,
  Bookmark,
  PieChart,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { zh } from "@/lib/i18n-zh";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: zh.nav.home, icon: <Compass size={16} />, end: true },
  { to: "/watchlist", label: zh.nav.watchlist, icon: <Bookmark size={16} /> },
];

const GLOBAL: NavItem[] = [
  {
    to: "/global/market",
    label: zh.nav.market,
    icon: <LayoutDashboard size={16} />,
  },
  { to: "/global/macro", label: zh.nav.macro, icon: <LineChart size={16} /> },
  { to: "/global/events", label: zh.nav.events, icon: <CalendarClock size={16} /> },
  {
    to: "/global/sectors",
    label: zh.nav.sectors,
    icon: <PieChart size={16} />,
  },
  {
    to: "/global/quality",
    label: zh.nav.dataQuality,
    icon: <ShieldCheck size={16} />,
  },
  {
    to: "/global/data-assets",
    label: zh.nav.dataAssets,
    icon: <Layers size={16} />,
  },
];

export function SideNav() {
  return (
    <nav className="flex w-60 shrink-0 flex-col gap-4 border-r border-border-soft/80 bg-panel-lo/90 px-3 py-4 backdrop-blur-sm">
      <Section title={null} items={PRIMARY} />
      <Section title="全局" items={GLOBAL} />
    </nav>
  );
}

function Section({ title, items }: { title: string | null; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-1">
      {title ? (
        <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary/90">
          {title}
        </div>
      ) : null}
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all",
              isActive
                ? "bg-accent/10 text-text-primary shadow-sm ring-1 ring-accent/20"
                : "text-text-secondary hover:bg-bg-2 hover:text-text-primary",
            )
          }
        >
          {it.icon}
          <span>{it.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
