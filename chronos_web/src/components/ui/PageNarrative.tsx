import type { ReactNode } from "react";

type PageNarrativeProps = {
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageNarrative({ title, description, actions }: PageNarrativeProps) {
  return (
    <div className="card p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-tertiary">{title}</div>
      <div className="text-sm text-text-secondary">{description}</div>
      {actions ? <div className="mt-2 flex flex-wrap gap-2 text-2xs">{actions}</div> : null}
    </div>
  );
}
