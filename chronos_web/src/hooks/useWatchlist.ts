/**
 * useWatchlist - Manage user's watchlist in localStorage
 */

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "chronos-watchlist";

export interface WatchlistItem {
  symbol: string;
  addedAt: string;
  notes?: string;
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setWatchlist(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage when watchlist changes
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [watchlist, isLoaded]);

  const addToWatchlist = useCallback((symbol: string, notes?: string) => {
    setWatchlist((prev) => {
      if (prev.some((item) => item.symbol === symbol)) {
        return prev;
      }
      return [
        ...prev,
        {
          symbol,
          addedAt: new Date().toISOString(),
          notes,
        },
      ];
    });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => prev.filter((item) => item.symbol !== symbol));
  }, []);

  const isInWatchlist = useCallback(
    (symbol: string) => {
      return watchlist.some((item) => item.symbol === symbol);
    },
    [watchlist]
  );

  const updateNotes = useCallback((symbol: string, notes: string) => {
    setWatchlist((prev) =>
      prev.map((item) => (item.symbol === symbol ? { ...item, notes } : item))
    );
  }, []);

  return {
    watchlist,
    isLoaded,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    updateNotes,
  };
}
