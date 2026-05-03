import { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-tertiary">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
