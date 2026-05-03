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
  Command,
  MessageSquare,
  Activity,
  Zap,
} from "lucide-react";

import { zh } from "@/lib/i18n-zh";
import { cn } from "@/lib/cn";

const NAV_SECTIONS = [
  {
    label: "全局视野",
    items: [
      {
        to: "/global/market",
        title: zh.nav.market,
        desc: "板块热力图 · 涨跌榜 · 市场脉搏",
        icon: <LayoutDashboard size={22} />,
        gradient: "from-blue-500/20 to-cyan-500/10",
        border: "border-blue-500/20",
        iconColor: "text-blue-400",
      },
      {
        to: "/global/macro",
        title: zh.nav.macro,
        desc: "收益率曲线 · CPI · GDP · 就业",
        icon: <LineChart size={22} />,
        gradient: "from-amber-500/20 to-orange-500/10",
        border: "border-amber-500/20",
        iconColor: "text-amber-400",
      },
      {
        to: "/global/sectors",
        title: zh.nav.sectors,
        desc: "板块排名 · 涨跌对比 · PE 分布",
        icon: <PieChart size={22} />,
        gradient: "from-emerald-500/20 to-teal-500/10",
        border: "border-emerald-500/20",
        iconColor: "text-emerald-400",
      },
      {
        to: "/global/events",
        title: zh.nav.events,
        desc: "财报日历 · 公司行为 · 内部人交易",
        icon: <CalendarClock size={22} />,
        gradient: "from-purple-500/20 to-violet-500/10",
        border: "border-purple-500/20",
        iconColor: "text-purple-400",
      },
    ],
  },
  {
    label: "工具与数据",
    items: [
      {
        to: "/watchlist",
        title: zh.nav.watchlist,
        desc: "自选股列表 · 快速跳转 · 价格监控",
        icon: <Bookmark size={22} />,
        gradient: "from-yellow-500/20 to-amber-500/10",
        border: "border-yellow-500/20",
        iconColor: "text-yellow-400",
      },
      {
        to: "/global/quality",
        title: zh.nav.dataQuality,
        desc: "同步覆盖率 · 数据健康 · 更新状态",
        icon: <ShieldCheck size={22} />,
        gradient: "from-sky-500/20 to-blue-500/10",
        border: "border-sky-500/20",
        iconColor: "text-sky-400",
      },
      {
        to: "/global/data-assets",
        title: zh.nav.dataAssets,
        desc: "数据资产清单 · 表覆盖 · 存储统计",
        icon: <Layers size={22} />,
        gradient: "from-slate-400/15 to-gray-500/10",
        border: "border-slate-400/20",
        iconColor: "text-slate-400",
      },
    ],
  },
];

const QUICK_STATS = [
  { label: "标的覆盖", value: "500+", icon: <Activity size={14} className="text-blue-400" /> },
  { label: "数据更新", value: "每日", icon: <Zap size={14} className="text-amber-400" /> },
  { label: "AI 分析", value: "实时", icon: <MessageSquare size={14} className="text-emerald-400" /> },
];

export function WelcomePage() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero Section */}
      <div className="relative mb-10 overflow-hidden rounded-2xl border border-border-soft/50 bg-gradient-to-br from-panel via-panel-hi to-panel p-8 sm:p-12">
        {/* Decorative gradient blobs */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-48 w-48 rounded-full bg-purple/10 blur-3xl" />
        <div className="pointer-events-none absolute right-1/3 -top-10 h-32 w-32 rounded-full bg-accent-2/8 blur-2xl" />

        <div className="relative">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="text-xs font-medium text-accent">投资研究工作站</span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-r from-text-primary via-text-primary to-text-secondary bg-clip-text">
              Chronos
            </span>
            <span className="ml-2 bg-gradient-to-r from-accent to-purple bg-clip-text text-transparent">
              Finance
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">
            从宏观周期到个股估值，构建完整投资判断框架。
            <br />
            用 <Kbd>⌘K</Kbd> 搜索标的，用 <Kbd>⌘J</Kbd> 唤起 AI 分析助手。
          </p>

          {/* Quick stats */}
          <div className="mt-6 flex flex-wrap gap-4">
            {QUICK_STATS.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center gap-2 rounded-lg border border-border-soft/50 bg-bg-2/50 px-3 py-1.5"
              >
                {stat.icon}
                <span className="text-xs text-text-tertiary">{stat.label}</span>
                <span className="font-mono text-sm font-semibold text-text-primary">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation Sections */}
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-border-soft/80 to-transparent" />
            <span className="text-2xs font-medium uppercase tracking-widest text-text-tertiary">
              {section.label}
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-border-soft/80 to-transparent" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2">
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-5 transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5",
                  item.border,
                  "bg-gradient-to-br",
                  item.gradient,
                )}
              >
                {/* Hover glow */}
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/5 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />

                <div className="relative flex items-start gap-4">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                      "border border-white/10 bg-white/5 backdrop-blur-sm",
                      item.iconColor,
                    )}
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">{item.title}</span>
                      <ArrowRight
                        size={14}
                        className="text-text-tertiary transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                      />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{item.desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Bottom shortcut hint */}
      <div className="mt-4 flex items-center justify-center gap-6 rounded-xl border border-border-soft/30 bg-bg-2/30 px-6 py-4">
        <ShortcutHint keys="⌘K" label="搜索股票" icon={<Command size={13} />} />
        <div className="h-4 w-px bg-border-soft" />
        <ShortcutHint keys="⌘J" label="AI 助手" icon={<MessageSquare size={13} />} />
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex items-center rounded border border-border-soft bg-bg-3/80 px-1.5 py-0.5 font-mono text-2xs font-medium text-text-primary shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutHint({ keys, label, icon }: { keys: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-text-tertiary">{icon}</span>
      <kbd className="rounded border border-border-soft bg-bg-3/80 px-1.5 py-0.5 font-mono text-2xs font-medium text-text-secondary shadow-sm">
        {keys}
      </kbd>
      <span className="text-xs text-text-tertiary">{label}</span>
    </div>
  );
}
