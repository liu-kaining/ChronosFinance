import type { ReactNode } from "react";

type EmptyDataStateProps = {
  title: string;
  detail?: string;
  actions?: ReactNode;
};

export function EmptyDataState({ title, detail, actions }: EmptyDataStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg-2/50 p-4">
      <div className="text-sm font-medium text-text-primary">{title}</div>
      {detail ? <div className="mt-1 text-xs text-text-secondary">{detail}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
