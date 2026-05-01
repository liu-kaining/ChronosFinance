import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  LineChart,
  CalendarClock,
  PieChart,
  ShieldCheck,
  Layers,
  Bookmark,
  ArrowRight,
  Sparkles,
} from "lucide-react";

import { zh } from "@/lib/i18n-zh";
import { cn } from "@/lib/cn";

const NAV_TILES = [
  {
    to: "/global/market",
    title: zh.nav.market,
    desc: "板块热力图、涨跌榜、成交活跃。",
    icon: <LayoutDashboard className="text-accent" size={20} />,
    color: "border-accent/20 bg-accent/5",
  },
  {
    to: "/global/macro",
    title: zh.nav.macro,
    desc: "宏观序列、收益率曲线、利率与增长。",
    icon: <LineChart className="text-accent-2" size={20} />,
    color: "border-accent-2/20 bg-accent-2/5",
  },
  {
    to: "/global/events",
    title: zh.nav.events,
    desc: "全市场事件：财报、公司行为、内部人交易。",
    icon: <CalendarClock className="text-purple" size={20} />,
    color: "border-purple/20 bg-purple/5",
  },
  {
    to: "/global/sectors",
    title: zh.nav.sectors,
    desc: "板块排名、涨跌对比、PE 分布。",
    icon: <PieChart className="text-emerald-400" size={20} />,
    color: "border-emerald-400/20 bg-emerald-400/5",
  },
  {
    to: "/watchlist",
    title: zh.nav.watchlist,
    desc: "自选股列表与快速跳转。",
    icon: <Bookmark className="text-yellow-400" size={20} />,
    color: "border-yellow-400/20 bg-yellow-400/5",
  },
  {
    to: "/global/quality",
    title: zh.nav.dataQuality,
    desc: "同步覆盖率、数据健康状态。",
    icon: <ShieldCheck className="text-blue-400" size={20} />,
    color: "border-blue-400/20 bg-blue-400/5",
  },
  {
    to: "/global/data-assets",
    title: zh.nav.dataAssets,
    desc: "数据资产清单与存储统计。",
    icon: <Layers className="text-gray-400" size={20} />,
    color: "border-gray-400/20 bg-gray-400/5",
  },
];

export function WelcomePage() {
  return (
    <div className="mx-auto max-w-4xl py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 text-text-secondary mb-3">
          <Sparkles size={16} className="text-accent-2" />
          <span className="text-xs uppercase tracking-wider">Chronos Finance</span>
        </div>
        <h1 className="text-3xl font-bold text-text-primary">投资研究工作站</h1>
        <p className="mt-2 text-sm text-text-secondary max-w-lg mx-auto">
          从全局到个股，建立完整投资判断。按 <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">⌘K</kbd> 搜索标的，
          按 <kbd className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-2xs">⌘J</kbd> 让 AI 辅助分析。
        </p>
      </div>

      {/* Navigation Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NAV_TILES.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className={cn(
              "flex items-start gap-4 rounded-lg border p-4 transition-all hover:shadow-md hover:scale-[1.01]",
              tile.color
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-2">
              {tile.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 font-medium text-text-primary">
                {tile.title}
                <ArrowRight size={14} className="text-text-tertiary" />
              </div>
              <div className="mt-0.5 text-xs text-text-secondary">{tile.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Tips */}
      <div className="mt-8 text-center text-xs text-text-tertiary">
        <p>使用 <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">⌘K</kbd> 快速搜索股票 · <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">⌘J</kbd> 打开 AI 助手</p>
      </div>
    </div>
  );
}
