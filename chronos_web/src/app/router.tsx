import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { WelcomePage } from "@/pages/Welcome";
import { SymbolLayout } from "@/pages/Symbol";
import { SymbolOverview } from "@/pages/Symbol/Overview";
import { SymbolChart } from "@/pages/Symbol/Chart";
import { SymbolFinancials } from "@/pages/Symbol/Financials";
import { SymbolEvents } from "@/pages/Symbol/Events";
import { SymbolAnalyst } from "@/pages/Symbol/Analyst";
import { SymbolPeers } from "@/pages/Symbol/Peers";
import { SymbolSec } from "@/pages/Symbol/Sec";
import { SymbolRaw } from "@/pages/Symbol/Raw";
import { GlobalLayout } from "@/pages/Global";
import { MarketPulsePage } from "@/pages/Global/MarketPulse";
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
          { index: true, element: <Navigate to="market-pulse" replace /> },
          { path: "market-pulse", element: <MarketPulsePage /> },
          { path: "macro", element: <MacroDashboardPage /> },
          { path: "events", element: <EventStreamPage /> },
          { path: "quality", element: <DataQualityPage /> },
          { path: "data-assets", element: <DataAssetsPage /> },
        ],
      },

      // ---------- Single stock workstation ----------
      {
        path: "symbol/:symbol",
        element: <SymbolLayout />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: "overview", element: <SymbolOverview /> },
          { path: "chart", element: <SymbolChart /> },
          { path: "financials", element: <SymbolFinancials /> },
          { path: "events", element: <SymbolEvents /> },
          { path: "analyst", element: <SymbolAnalyst /> },
          { path: "peers", element: <SymbolPeers /> },
          { path: "sec", element: <SymbolSec /> },
          { path: "raw", element: <SymbolRaw /> },
        ],
      },
    ],
  },
]);
