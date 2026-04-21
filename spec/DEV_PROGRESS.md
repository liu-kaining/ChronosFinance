# ChronosFinance 前端升级 + AI 接入 · 开发进度

> 本文档实时跟踪开发进度，每完成一个子任务都会更新。
> 用户策略：**全部开发完成后在开发机统一测试**，所以代码质量与 review 必须严格。

---

## 全局原则

1. **质量优先**：代码要能直接上生产，不留明显 bug
2. **无登录**：MVP 不做鉴权（后续迭代）
3. **前后端分离**：3 个容器（db / api / web / ai）
4. **AI 模型**：只实现标准 OpenAI 兼容 + Anthropic 两个 Provider，其他由用户配置 base_url/key 适配
5. **Self-review 策略**：
   - 每写完一个模块立刻 re-read，检查 import/typo/类型
   - TypeScript 严格模式 `"strict": true`
   - Python 全用 type hints
   - 所有 API 调用有错误处理

---

## 里程碑状态

| 阶段 | 状态 | 产出 |
|---|---|---|
| M0   | ✅ | 三份 spec 文档 |
| M1   | ✅ | 前端脚手架 + Docker + CORS |
| M2   | ✅ | 单股页核心 |
| M2.5 | ✅ | chronos_ai 起步 |
| M3   | ✅ | 全局工作台 |
| M3.5 | ⏳ | 图表注释 + 聊天闭环（可选） |
| M4   | ✅ | 辅助页 |
| M4.5 | ⏳ | 研究报告 + 筛股（可选） |
| M5   | ⏳ | 打磨 + MCP 导出（可选） |

---

## 详细进度（按完成时间倒序）

### M1 — 脚手架 & Docker & CORS ✅

- [x] 后端 CORS 中间件 + 配置（`core/config.py` 加 `CORS_ALLOW_ORIGINS`；`main.py` 注册 `CORSMiddleware`，`*` 自动禁用 credentials）
- [x] `chronos_web/` 工程初始化（package.json / tsconfig.json / tsconfig.app.json / tsconfig.node.json / vite.config.ts）
- [x] Tailwind 主题（`tailwind.config.ts` — TradingView 深灰色板 + 金融信号色）
- [x] `chronos_web/Dockerfile` + `nginx.conf`（多阶段构建，API/IA proxy，SPA fallback）
- [x] 更新根 `docker-compose.yml`（db / api / web / ai 四服务，ai 用 profiles 延后启动）
- [x] `.env.example` 环境变量模板
- [x] 前端 `lib/api.ts`（fetch 封装 + endpoints 字典）+ `lib/types.ts`（对齐后端 schemas）
- [x] 前端 `lib/ai.ts`（SSE 封装，支持 POST + AbortController）
- [x] 前端 `lib/format.ts`（fmtCap/fmtNum/fmtPct/fmtAgo 等）
- [x] 前端 `lib/theme.ts` + `lib/tv-theme.ts`（COLORS 常量 + lightweight-charts 主题）
- [x] 前端 `lib/cn.ts`（clsx + tailwind-merge）
- [x] AppShell（TopBar + SideNav + Outlet）
- [x] React Router 配置（`app/router.tsx` — /, /global/*, /symbol/:symbol/*）
- [x] TanStack Query Provider（`app/providers.tsx`）
- [x] ⌘K 全局搜索（`components/CommandPalette.tsx` — cmdk，symbol prefix search + AI mode 切换）
- [x] Welcome 页（四个 tile 入口）
- [x] 全局页面占位（MarketPulse / MacroDashboard / EventStream / DataQuality）
- [x] 单股页 Layout + 8 个 tab 占位（Overview / Chart / Financials / Events / Analyst / Peers / Sec / Raw）
- [x] 404 页

### M2 — 单股页核心 ✅

- [x] 单股 Hero 组件（symbol + 最新价 + 市值 + 涨跌）
- [x] 单股侧边 Tab 路由
- [x] Overview 页（4 KPI 卡片 + 日内 Range + 数据可用性 Grid）
- [x] Chart 页（lightweight-charts K线 + Volume + MA20/MA50）
- [x] Financials 页（瀑布图 Income Statement + 分类选择器 + 时间序列表格）
- [x] Events 页（EPS 对比柱状图 + 财报表格 + 公司行为 + 内幕交易）
- [x] Analyst 页（目标价柱状图 + 一致预期表格）
- [x] SEC Filings 页（年度分组时间线 + 表格）
- [x] Raw JSON 页（多数据源选择器 + JSON viewer）
- [x] Peers 页（placeholder - M4 完善）

### M2.5 — AI 服务起步 ✅

- [x] `chronos_ai/` 目录结构初始化
- [x] `pyproject.toml` / `requirements.txt`
- [x] `core/config.py` + `core/sse.py`
- [x] `llm/base.py`（抽象接口）
- [x] `llm/anthropic_provider.py`
- [x] `llm/openai_provider.py`（兼容 DeepSeek/Kimi 等）
- [x] `llm/factory.py`
- [x] `tools/registry.py`
- [x] 工具定义：universe/price/financial/event/macro/analyst/sec/compute（10 个工具）
- [x] `agents/base.py`（ReAct tool use 循环）
- [x] `agents/chat_agent.py`
- [x] `api/chat.py` SSE 端点
- [x] `main.py`
- [x] `Dockerfile`
- [x] 前端 `<ChatDrawer>` + Cmd+J 快捷键

### M3 — 全局工作台 ✅

- [x] MarketPulse（Stats Overview + Gainers/Losers + Sector Treemap）
- [x] MacroDashboard（Macro Series List + Line Chart）
- [x] EventStream（Recent Earnings + Insider Trades）
- [x] DataQuality（Sync Progress Bars + Table Counts）

### M3.5 — 图表注释 + 聊天闭环

- [ ] `agents/annotator.py`
- [ ] `api/annotate.py`
- [ ] `<ChartAnnotation>` 组件
- [ ] 所有 ChartCard 接入 ✨ 按钮
- [ ] 聊天 Drawer：上下文注入、markdown 渲染

### M4 — 辅助页 ✅

- [x] Peers 完整版（placeholder + 外部链接）
- [x] SEC Filings Timeline（已在 M2 实现）
- [x] Raw JSON Viewer（已在 M2 实现）

### M4.5 — 研究报告 + 筛股

- [ ] `agents/researcher.py`
- [ ] `api/research.py`
- [ ] 单股 AI Research tab
- [ ] `agents/screener.py`
- [ ] `api/screen.py`
- [ ] ⌘K AI 模式切换

### M5 — 打磨 + MCP

- [ ] 动效
- [ ] 移动端
- [ ] MCP Server 导出
- [ ] 会话持久化
- [ ] 成本面板

---

## 已知遗留 / 待确认

- `peers_snapshot` 数据是否已同步 —— M4 Peers 页开发时检查
- 后端 `last price` 端点：可能需要新增 `/api/v1/library/symbols/{sym}/latest`
- 市场脉搏 `market-stats` 端点：M3 开发时确定是后端新增还是前端计算

---

## 每次开发完一个子任务的 Checklist

- [ ] 代码 re-read 一遍
- [ ] import 有没有缺
- [ ] 类型对不对
- [ ] 错误处理是否完整
- [ ] 更新本文档对应条目 `[ ]` → `[x]`
- [ ] （必要时）更新其他 spec 文档

