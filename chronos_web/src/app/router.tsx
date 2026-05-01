import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { WelcomePage } from "@/pages/Welcome";
import { SymbolLayout } from "@/pages/Symbol";
import { PriceActionPage } from "@/pages/Symbol/PriceAction";
import { SymbolFinancials } from "@/pages/Symbol/Financials";
import { SymbolEvents } from "@/pages/Symbol/Events";
import { ValuationPage } from "@/pages/Symbol/Valuation";
import { SymbolPeers } from "@/pages/Symbol/Peers";
import { SymbolSec } from "@/pages/Symbol/Sec";
import { SymbolRaw } from "@/pages/Symbol/Raw";
import { SectorDetailPage } from "@/pages/Sector";
import { SectorOverviewPage } from "@/pages/Global/SectorOverview";
import { WatchlistPage } from "@/pages/Watchlist";
import { GlobalLayout } from "@/pages/Global";
import { MarketOverviewPage } from "@/pages/Global/MarketOverview";
import { MacroDashboardPage } from "@/pages/Global/MacroDashboard";
import { EventStreamPage } from "@/pages/Global/EventStream";
import { DataQualityPage } from "@/pages/Global/DataQuality";
import { DataAssetsPage } from "@/pages/Global/DataAssets";
import { NotFoundPage } from "@/pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <WelcomePage /> },

      // ---------- Global workstation ----------
      {
        path: "global",
        element: <GlobalLayout />,
        children: [
          { index: true, element: <Navigate to="market" replace /> },
          { path: "market", element: <MarketOverviewPage /> },
          { path: "macro", element: <MacroDashboardPage /> },
          { path: "events", element: <EventStreamPage /> },
          { path: "sectors", element: <SectorOverviewPage /> },
          { path: "quality", element: <DataQualityPage /> },
          { path: "data-assets", element: <DataAssetsPage /> },
          // Legacy redirects
          { path: "market-pulse", element: <Navigate to="/global/market" replace /> },
        ],
      },

      // ---------- Single stock workstation ----------
      {
        path: "symbol/:symbol",
        element: <SymbolLayout />,
        children: [
          { index: true, element: <Navigate to="price" replace /> },
          { path: "price", element: <PriceActionPage /> },
          { path: "financials", element: <SymbolFinancials /> },
          { path: "events", element: <SymbolEvents /> },
          { path: "valuation", element: <ValuationPage /> },
          { path: "peers", element: <SymbolPeers /> },
          { path: "sec", element: <SymbolSec /> },
          { path: "raw", element: <SymbolRaw /> },
          // Legacy redirects
          { path: "evidence", element: <Navigate to="price" replace /> },
          { path: "overview", element: <Navigate to="price" replace /> },
          { path: "chart", element: <Navigate to="price" replace /> },
          { path: "analyst", element: <Navigate to="valuation" replace /> },
        ],
      },

      // ---------- Sector analysis ----------
      {
        path: "sector/:sector",
        element: <SectorDetailPage />,
      },

      // ---------- Watchlist ----------
      {
        path: "watchlist",
        element: <WatchlistPage />,
      },
    ],
  },
]);
