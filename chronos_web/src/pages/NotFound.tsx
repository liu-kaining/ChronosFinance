import { Link, useRouteError } from "react-router-dom";

export function NotFoundPage() {
  const err = useRouteError() as { status?: number; statusText?: string } | null;
  const status = err?.status ?? 404;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg-0 text-text-primary">
      <div className="ticker text-4xl text-text-tertiary">{status}</div>
      <div className="text-sm text-text-secondary">
        {err?.statusText ?? "Page not found."}
      </div>
      <Link
        to="/"
        className="rounded-md border border-border-soft bg-bg-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-3 hover:text-text-primary"
      >
        Back home
      </Link>
    </div>
  );
}
