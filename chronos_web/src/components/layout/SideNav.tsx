import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  ShieldCheck,
  Compass,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Home", icon: <Compass size={16} />, end: true },
];

const GLOBAL: NavItem[] = [
  {
    to: "/global/market-pulse",
    label: "Market Pulse",
    icon: <LayoutDashboard size={16} />,
  },
  { to: "/global/macro", label: "Macro", icon: <LineChart size={16} /> },
  { to: "/global/events", label: "Events", icon: <CalendarClock size={16} /> },
  {
    to: "/global/quality",
    label: "Data Quality",
    icon: <ShieldCheck size={16} />,
  },
];

export function SideNav() {
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-4 border-r border-border-soft bg-panel-lo px-2 py-3">
      <Section title={null} items={PRIMARY} />
      <Section title="Global" items={GLOBAL} />
    </nav>
  );
}

function Section({ title, items }: { title: string | null; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      {title ? (
        <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
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
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-bg-3 text-text-primary"
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
