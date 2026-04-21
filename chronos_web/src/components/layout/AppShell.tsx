import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";

import { TopBar } from "./TopBar";
import { SideNav } from "./SideNav";
import { CommandPalette } from "@/components/CommandPalette";
import { ChatDrawer } from "@/components/ChatDrawer";

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Cmd+K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((x) => !x);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setChatOpen((x) => !x);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-bg-0">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenChat={() => setChatOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
