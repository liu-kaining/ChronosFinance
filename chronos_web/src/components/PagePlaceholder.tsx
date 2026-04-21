import type { ReactNode } from "react";
import { Construction } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  milestone?: string;
  children?: ReactNode;
}

export function PagePlaceholder({ title, subtitle, milestone, children }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-3 text-text-tertiary">
        <Construction size={24} />
      </div>
      <div>
        <h2 className="text-lg font-medium text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
        ) : null}
      </div>
      {milestone ? (
        <div className="chip">
          <span>Planned in</span>
          <span className="font-mono font-semibold text-accent">
            {milestone}
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
