import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, ExternalLink } from "lucide-react";

import { api, endpoints } from "@/lib/api";
import type { SymbolInventory } from "@/lib/types";

export function SymbolPeers() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

  const { data: inv, isLoading } = useQuery({
    queryKey: ["inventory", sym],
    queryFn: () => api.get<SymbolInventory>(endpoints.symbolInventory(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  // Check if peers data exists
  const hasPeers = inv?.tables?.peers_snapshot?.rows ?? 0 > 0;

  // Extract peers from raw_payload if available
  // Note: This would need a backend endpoint to expose peers data
  // For now, show a placeholder

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
          <Users size={16} />
          <span>Peer Companies</span>
        </div>

        {isLoading ? (
          <div className="h-[100px] animate-pulse rounded bg-bg-3" />
        ) : hasPeers ? (
          <div className="text-sm text-text-secondary">
            Peer data is available in the database. This page will display peer comparison
            metrics once the backend exposes a peers endpoint.
          </div>
        ) : (
          <div className="py-6 text-center">
            <Users size={32} className="mx-auto mb-2 text-text-tertiary" />
            <div className="text-sm text-text-secondary">
              No peer data available for {sym}
            </div>
            <div className="mt-1 text-xs text-text-tertiary">
              Peer data can be synced via the FMP API peers endpoint
            </div>
          </div>
        )}
      </div>

      {/* Placeholder peer cards */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Industry Peers (Placeholder)
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["Peer A", "Peer B", "Peer C", "Peer D"].map((peer) => (
            <div
              key={peer}
              className="rounded-md border border-border-soft bg-bg-2 px-3 py-3 text-center"
            >
              <div className="ticker text-sm text-text-primary">{peer}</div>
              <div className="mt-1 text-2xs text-text-tertiary">Sector Peer</div>
            </div>
          ))}
        </div>
      </div>

      {/* External link */}
      <div className="card p-3">
        <a
          href={`https://finance.yahoo.com/quote/${sym}/analysis`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-accent hover:text-accent/80"
        >
          <ExternalLink size={14} />
          <span>View analyst comparisons on Yahoo Finance</span>
        </a>
      </div>
    </div>
  );
}
