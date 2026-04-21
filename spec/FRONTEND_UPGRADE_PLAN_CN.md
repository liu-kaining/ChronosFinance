# ChronosFinance 前端升级方案 V2 (2026-04)

**目标**：把现有两个单文件 HTML 看板升级为华尔街投行级专业工作台，前后端彻底解耦。

---

## 0. 核心决策（已与用户对齐）

| 项 | 决策 |
|---|---|
| 架构 | **前后端分离**，前端独立 Docker 容器 |
| 技术栈 | Vite + React 18 + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router 7 |
| 金融图表 | TradingView **lightweight-charts**（K 线/价格）+ **ECharts 5**（treemap/radar/sankey/瀑布） |
| 视觉风格 | TradingView Pro 风（深灰 `#131722` + 多色高亮） |
| 全局模块 | 市场脉搏 + 宏观仪表盘 + 事件流 + 数据质量中心 |
| 单股重点 | 专业 K 线 + 财报拆解 + 事件标记 K 线 + 同行对比 |

---

## 1. 目标架构

```
ChronosFinance/
├── chronos_finance/              # 后端 (现有, 基本不动)
│   ├── app/
│   │   ├── api/                  # 可能新增 2-3 个端点
│   │   └── main.py               # 加 CORS middleware
│   └── Dockerfile
│
├── chronos_web/                  # 🆕 前端独立工程
│   ├── public/
│   ├── src/
│   │   ├── app/                  # 入口、路由、Providers
│   │   │   ├── main.tsx
│   │   │   ├── router.tsx
│   │   │   └── providers.tsx     # QueryClient, Theme, Toast
│   │   ├── pages/
│   │   │   ├── Global/           # 全局工作台
│   │   │   │   ├── index.tsx
│   │   │   │   ├── MarketPulse.tsx      # Sector Treemap + 涨跌分布
│   │   │   │   ├── MacroDashboard.tsx   # 收益率曲线 + 宏观指标
│   │   │   │   ├── EventStream.tsx      # 财报/分红/内幕
│   │   │   │   └── DataQuality.tsx      # Freshness/Budget/Ranking
│   │   │   ├── Symbol/           # 单股工作台
│   │   │   │   ├── index.tsx     # 布局（Hero + 子路由）
│   │   │   │   ├── Overview.tsx  # 大屏概览
│   │   │   │   ├── Chart.tsx     # 专业K线
│   │   │   │   ├── Financials.tsx# 财报拆解
│   │   │   │   ├── Events.tsx    # 事件 + 内幕
│   │   │   │   ├── Analyst.tsx   # 分析师视图
│   │   │   │   ├── Peers.tsx     # 同行对比
│   │   │   │   ├── SecFilings.tsx
│   │   │   │   └── Raw.tsx
│   │   │   └── Library/          # 原 Atlas/Inventory
│   │   ├── components/
│   │   │   ├── layout/           # TopBar, SideNav, AppShell
│   │   │   ├── charts/           # 复用图表组件
│   │   │   │   ├── CandleStick.tsx      # lightweight-charts 封装
│   │   │   │   ├── TechChart.tsx        # K线+成交量+RSI+MACD
│   │   │   │   ├── SectorTreemap.tsx
│   │   │   │   ├── YieldCurve.tsx
│   │   │   │   ├── WaterfallChart.tsx
│   │   │   │   ├── RadarChart.tsx
│   │   │   │   └── Sparkline.tsx
│   │   │   ├── cards/            # StatCard, KpiCard, HeatCell
│   │   │   ├── tables/           # DataTable (TanStack Table)
│   │   │   ├── SymbolSearch.tsx  # ⌘K 全局搜索
│   │   │   └── ui/               # shadcn/ui 生成的原子组件
│   │   ├── hooks/
│   │   │   ├── useInventory.ts
│   │   │   ├── usePrices.ts
│   │   │   ├── useFinancials.ts
│   │   │   └── ...               # 每个 API 一个 hook
│   │   ├── lib/
│   │   │   ├── api.ts            # fetch 封装
│   │   │   ├── types.ts          # 与后端 schemas 对齐的 TS 类型
│   │   │   ├── format.ts         # fmtCap/fmtBytes/fmtPct/fmtDate
│   │   │   ├── theme.ts          # 颜色常量（up/down/warn/accent）
│   │   │   └── tv-theme.ts       # lightweight-charts 主题
│   │   └── styles/globals.css
│   ├── Dockerfile                # multi-stage: node build → nginx serve
│   ├── nginx.conf                # SPA fallback + proxy /api → api:8000
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   └── package.json
│
├── docker-compose.yml            # 加 web 服务
└── spec/                         # 设计文档
```

---

## 2. Docker 编排

`docker-compose.yml` 新增：

```yaml
services:
  db:
    image: postgres:16
    ...

  api:
    build: ./chronos_finance
    environment:
      - CORS_ALLOW_ORIGINS=http://localhost:3000,http://web
    ports: ["8000:8000"]
    depends_on: [db]

  web:
    build: ./chronos_web
    ports: ["3000:80"]
    depends_on: [api]
    environment:
      - API_UPSTREAM=http://api:8000   # nginx 反代用
```

`chronos_web/Dockerfile`（多阶段）：

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build     # → dist/

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`chronos_web/nginx.conf`：

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://api:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri $uri/ /index.html;   # SPA fallback
  }
}
```

后端需要加 CORS（dev 模式）：

```python
# chronos_finance/app/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS.split(",") if settings.CORS_ALLOW_ORIGINS else [],
    allow_methods=["GET"],
    allow_headers=["*"],
)
```

---

## 3. 视觉系统（TradingView Pro 深灰风）

### 3.1 色板

```css
/* 背景层 */
--bg-0:   #0d1015;    /* 最深，页面底 */
--bg-1:   #131722;    /* 面板主色 TradingView 官方 */
--bg-2:   #1e222d;    /* 卡片 */
--bg-3:   #2a2e39;    /* hover / 选中 */
--border: #363a45;
--border-soft: #2a2e39;

/* 文本 */
--text-0: #d1d4dc;    /* 主要 */
--text-1: #9598a1;    /* 次要 */
--text-2: #5d606b;    /* 辅助 */

/* 金融信号色（对色盲友好版） */
--up:     #26a69a;    /* 绿蓝 TradingView 色 */
--down:   #ef5350;    /* 橙红 */
--up-soft:   rgba(38,166,154,0.15);
--down-soft: rgba(239,83,80,0.15);

/* 指标色（高对比） */
--accent:    #2962ff;  /* 蓝 */
--accent-2:  #f7931a;  /* 金 / BTC 橙 */
--warn:      #ff9800;
--purple:    #9c27b0;
--cyan:      #00bcd4;
--pink:      #e91e63;

/* 语义 */
--ok:     var(--up);
--stale:  var(--warn);
--fail:   var(--down);
```

### 3.2 字体

- **UI 字体**：Inter / -apple-system（数字等宽感通过 `font-variant-numeric: tabular-nums` 实现）
- **数字/代码**：JetBrains Mono / SF Mono
- **品牌字（symbol 大标题）**：JetBrains Mono Bold，字间距 0.04em

### 3.3 间距 / 栅格

- 页面 max-width 无上限（投行工作台占满屏）
- 卡片 radius 8px，边框 1px `--border-soft`
- 阴影极轻：`0 1px 2px rgba(0,0,0,0.4)`
- 高密度表格：行高 28px，字号 12px
- 大数字展示：字号 24-28px，数字等宽

### 3.4 动效

- 所有数字变化用 `requestAnimationFrame` tween 300ms
- 涨跌单元格闪烁（绿/红背景 fade 500ms）
- 路由切换淡入 150ms
- 图表 dispose / init 加 FLIP 过渡

---

## 4. 全局工作台（`/`）

### 4.1 顶栏 TopBar
- 左：CHRONOS logo + 小副标
- 中：⌘K 全局搜索（symbol / macro series / sector）
- 右：市场状态指示（美股开/收盘倒计时）、刷新时间、主题切换（暂定只做深色）、Help、OpenAPI 链接

### 4.2 市场脉搏（MarketPulse）

**布局**：
```
┌───────────────────────────────────────────────────────────────┐
│ Sector Treemap （占 2/3 宽） │ 涨跌分布柱 / 热力图（1/3）    │
│  ECharts treemap:            │                                │
│  - 块大小 = 市值             │  按 sector 聚合的条形          │
│  - 块颜色 = 近一日/近一周%    │  + 指标切换（1D/5D/1M/YTD）    │
│  - 钻取：sector → industry   │                                │
├───────────────────────────────────────────────────────────────┤
│ 宽度占满：行业轮动 / Top N 涨跌榜（可切换）                   │
│ - 近期表现前 20 / 后 20 柱状                                  │
│ - 每条点击跳转单股页                                          │
└───────────────────────────────────────────────────────────────┘
```

**数据来源**：
- 现有 `GET /api/v1/data/universe?limit=5000` 拉基础信息
- **需新增** `GET /api/v1/data/universe/market-stats?window=1d|5d|1m` → 计算每个 symbol 的价格变化率，后端聚合
- 或者前端从 `daily_prices` 拉近期数据计算（方案 A 更省流量）

### 4.3 宏观仪表盘（MacroDashboard）

**布局**：
```
┌──────────────────────────┬─────────────────────────────────┐
│ US Treasury Yield Curve  │ Key Macro Indicators (2×2 grid) │
│  动画曲线，x=期限 y=%    │  CPI / GDP / 失业率 / 联邦基金   │
│  今日/一周前/一月前对比  │  每个小卡 = KPI + sparkline     │
├──────────────────────────┴─────────────────────────────────┤
│ 期限利差 Spread Panel                                       │
│  10Y-2Y, 10Y-3M, 30Y-10Y 折线（衰退指示）                   │
├──────────────────────────────────────────────────────────────┤
│ 宏观数据序列浏览器（原 macro view，重做）                    │
│  - 左列：series 分组树（category → series）                  │
│  - 右：多选叠加折线 + 预览表                                 │
└──────────────────────────────────────────────────────────────┘
```

**数据**：`/api/v1/data/macro/series` + `/api/v1/data/macro/series/{id}`
**需新增**：`GET /api/v1/data/macro/treasury-curve?dates=today,1w,1m` 返回国债曲线快照

### 4.4 事件流（EventStream）

**布局**：
- 上：未来 14 天财报日历 —— 按日期分组的卡片流，每天显示 4-8 家公司，带 marketCap 权重背景
- 中左：公司行为流（近 30 日）—— 按日 timeline，分红/拆股不同图标
- 中右：内幕交易热度榜 —— top 20 最大买/卖，颜色区分 type

**数据**：`earnings_calendar` + `corporate_actions` + `insider_trades`
**需新增**：`GET /api/v1/data/events/upcoming-earnings?days=14` 全市场聚合
**需新增**：`GET /api/v1/data/events/top-insider-trades?window=30d&limit=20`

### 4.5 数据质量中心（DataQuality）

**布局**：
- KPI 行：Tracked / OK / Stale / Failed / Throttled / Never（升级现有 health）
- Freshness 矩阵：行 = dataset_key，列 = 最近 N 小时的状态点阵（绿/黄/红）
- Bandwidth Budget gauge：圆环 + 剩余百分比
- Top 失败数据集排行表
- Orphan states 警告面板

**数据**：现有 freshness / coverage API + `/api/v1/ingest/budget` + `/api/v1/ingest/runs`

---

## 5. 单股工作台（`/symbol/:sym/*`）

### 5.1 Hero 区（所有子页共享，基金经理视角）

```
┌─────────────────────────────────────────────────────────────────────┐
│ NVDA  NVIDIA Corporation          ┃ Last 485.32  +2.41%  +11.45    │
│ NASDAQ · Semiconductors · Large   ┃ Mkt Cap 1.2T   P/E 68.5        │
│ [Overview][Chart][Financials][Events][Analyst][Peers][SEC][Raw]    │
└─────────────────────────────────────────────────────────────────────┘
```

- 左：symbol 大号 + 公司名 + 交易所/sector/industry tag
- 右：最新价、涨跌、涨跌%（绿红）、市值、PE、52W H/L 条
- 下：子 tab 导航

数据取自 `inventory` + 最新 `daily_prices` 最后一行 + `static_financials` 最近一年。

### 5.2 Overview（大屏概览，基金经理一屏看全）

2 行 × 3 列 grid：

| 区块 | 内容 |
|---|---|
| (1,1) 价格+成交量 mini | 一年价格线 + volume 副图，事件 marker（财报日） |
| (1,2) 财务快照 | 营收/净利/ROE/FCF 近 5 年柱 + YoY 趋势箭头 |
| (1,3) 估值对比 | 当前 P/E / P/B / EV/EBITDA vs 行业中位数（对比条） |
| (2,1) 数据同步雷达 | 保留现有雷达 |
| (2,2) 最近事件 timeline | 合并财报/分红/内幕的 mini timeline |
| (2,3) 分析师一致预期 | EPS consensus trendline + 目标价箱型 |

### 5.3 专业 K 线（Chart）⭐ 核心升级

使用 **TradingView lightweight-charts**：

```
┌─────────────────────────────────────────────────────────────┐
│ Toolbar: [1D][1W][1M][3M][6M][1Y][3Y][5Y][MAX]             │
│          [Line][Candle][Area][Hollow]                        │
│          [+ MA20][+ MA50][+ MA200][+ BOLL][+ VWAP]          │
│          [RSI][MACD][Volume] 副图开关                        │
├─────────────────────────────────────────────────────────────┤
│ 主图：蜡烛图 + 均线叠加 + BOLL 通道                         │
│ crosshair 十字光标 + 右侧价格轴 + 底部日期轴                │
│ 事件 markers：E(earnings) D(dividend) S(split) I(insider)   │
├─────────────────────────────────────────────────────────────┤
│ 副图1：成交量（涨跌色）                                      │
├─────────────────────────────────────────────────────────────┤
│ 副图2：RSI(14)                                              │
├─────────────────────────────────────────────────────────────┤
│ 副图3：MACD                                                 │
└─────────────────────────────────────────────────────────────┘
信息栏（随光标移动）：O 483.2  H 486.1  L 481.5  C 485.32  V 32.4M
```

指标在前端计算：MA / EMA / Bollinger / RSI / MACD。事件 marker 从 earnings_calendar + corporate_actions + insider_trades 合并。

### 5.4 财报拆解（Financials）⭐

4 个子 tab：

**Income 利润表**：
- 营收 → 毛利 → 营业利润 → 净利润 的 **瀑布图**（ECharts waterfall）
- 每项下方：近 10 年柱形图，YoY% 色阶
- 右侧：毛利率 / 营业利润率 / 净利率 折线

**Balance 资产负债表**：
- 资产/负债/权益 的堆叠柱图（10 年）
- 流动比率 / 负债率 折线
- 现金 & 投资 vs 总债务 对比

**Cash Flow**：
- 经营/投资/融资现金流 三色柱（正负分开）
- FCF 折线 + FCF yield

**Dupont ROE 杜邦分解**：
- 净利率 × 资产周转率 × 权益乘数 = ROE
- 三个子指标的时序分别绘制 + 合成 ROE
- ECharts sankey 图显示因子传导

所有数字用 `fmtNumber()`：绝对值自动 K/M/B/T，支持切换单位。

### 5.5 Events（升级现有）

- 主图：EPS 实际 vs 预期 柱 + 营收对比线（保留但重设计）
- 财报表现惊喜：EPS surprise% 柱状（绿红）
- 公司行为时间线（玻璃拟态卡片流）
- 内幕交易热力表：rows=高管名，cols=月份，cell=净交易额
- 全量明细表（TanStack Table，虚拟滚动，可排序/筛选）

### 5.6 Analyst

- 目标价分布：**盒须图** + 散点（每个 analyst 一个点）
- 一致预期 EPS 时间线 + revisions 变化箭头
- 评级饼图（Buy/Hold/Sell）演化 stacked area
- 预期 vs 实际偏差 柱状

### 5.7 Peers（新增）⭐

- 前提：有 `static_financials` 的 `peers_snapshot` 类别
- 顶部：多选 peers（默认从 peers_snapshot 取 top 5）
- 图表 1：归一化股价走势（所有 peer 从 1.0 起）
- 图表 2：P/E / P/B / ROE / Revenue Growth 横向对比柱
- 图表 3：市值 vs ROE 散点（气泡大小 = 营收）
- 下方：并排 KPI 表格

### 5.8 SEC Filings（小升级）
- 保留现有表
- 新增：按年份分组的 timeline
- 点击某 filing 打开 side drawer 查看顶层章节树（不加载全文）

### 5.9 Raw
- JSON viewer 组件（支持折叠/搜索/复制路径）

---

## 6. API 侧需要的新增/调整

| 优先级 | 端点 | 用途 |
|---|---|---|
| P0 | CORS 中间件 | 允许 web 容器访问 |
| P1 | `GET /api/v1/data/universe/market-stats` | 市场脉搏 treemap |
| P1 | `GET /api/v1/data/events/upcoming-earnings` | 全市场财报日历 |
| P1 | `GET /api/v1/data/events/top-insider-trades` | 内幕热度榜 |
| P2 | `GET /api/v1/data/macro/treasury-curve` | 利率曲线快照 |
| P2 | `GET /api/v1/library/symbols/{sym}/price-latest` | 最新价+涨跌（Hero） |
| P3 | `GET /api/v1/library/symbols/{sym}/peers` | 获取 peers 列表 |

前端先用现有 API 做 MVP，不够再补后端。

---

## 7. 实施阶段（里程碑，已与 AI 能力合并）

> AI 相关条目详见 `spec/AI_INTEGRATION_PLAN_CN.md`。

### M1：脚手架 + 基础布局（主干跑通）
- [ ] 初始化 `chronos_web` （Vite + React + TS + Tailwind + shadcn/ui）
- [ ] Dockerfile + nginx.conf + docker-compose 接入
- [ ] 后端加 CORS
- [ ] AppShell：TopBar + 路由 + ⌘K 搜索（**预埋 AI 模式开关**）
- [ ] lib/api.ts + lib/types.ts（全部 API 的 TS 类型）
- [ ] **lib/ai.ts**：SSE 流式 fetch 封装 + `useAIStream` hook（先空跑，等 M2.5）
- [ ] 主题系统 globals.css + tailwind preset

### M2：单股页面核心（最高价值）
- [ ] Symbol Hero + 子 tab 路由
- [ ] Overview 页
- [ ] Chart 页（TradingView lightweight-charts + 指标 + events marker）
- [ ] Financials 页（瀑布 + YoY + 杜邦）
- [ ] Events 页
- [ ] Analyst 页
- [ ] **所有 ChartCard 统一抽象，右上角预留 `✨ 注释` 按钮槽位**

### M2.5：AI 能力起步
- [ ] 初始化 `chronos_ai/` 容器（FastAPI + uvicorn）
- [ ] LLM 适配层（Anthropic + OpenAI-compat 两个 Provider）
- [ ] Tool Registry + 10 个核心工具（inventory/prices/financials/earnings/...）
- [ ] `POST /api/ai/chat` SSE 端点（通用对话）
- [ ] docker-compose 加入 ai 服务，nginx 代理 `/api/ai/*`
- [ ] 前端 `<ChatDrawer>` 组件（Cmd+J 召唤）上线

### M3：全局工作台
- [ ] MarketPulse（需后端 1 个新端点）
- [ ] MacroDashboard
- [ ] EventStream
- [ ] DataQuality

### M3.5：图表注释 + 聊天闭环
- [ ] `POST /api/ai/annotate` 端点 + 短任务模型路由
- [ ] `<ChartAnnotation>` 组件接入所有 ChartCard
- [ ] 聊天 Drawer 支持：当前上下文注入（symbol/view）、markdown 渲染、跳转卡片
- [ ] 工具集扩到 15+（补齐 macro / analyst / sec）

### M4：辅助页面
- [ ] Peers（peers_snapshot 数据可用性检查）
- [ ] SEC Filings
- [ ] Raw JSON Viewer
- [ ] Library / Atlas（迁移原数据全景）

### M4.5：研究报告 + 自然语言筛股
- [ ] `POST /api/ai/research/{symbol}` 长任务 SSE
- [ ] 单股页 `AI Research` tab，流式 markdown
- [ ] `POST /api/ai/screen` 自然语言筛股
- [ ] ⌘K 命令面板加 "AI 模式" 切换
- [ ] `ai_reports` 表（可选）持久化

### M5：打磨 + MCP 导出
- [ ] 动效 / 过渡
- [ ] 键盘快捷键
- [ ] 错误态 / loading skeleton
- [ ] 移动端兼容（基金经理也用 iPad）
- [ ] **MCP Server 导出** `python -m chronos_ai.mcp`，支持 Claude Desktop 直连
- [ ] **会话持久化**（`ai_sessions` / `ai_messages` 表）
- [ ] **成本监控面板**（token 统计、日账单）
- [ ] 埋点（console.time + ai_runs 表）

---

## 8. 开发 / 本地运行

```bash
# 一次性安装
cd chronos_web
npm install

# 开发模式（与 docker api 共存）
# api 用 docker: docker compose up api db
# 前端本地：
npm run dev    # http://localhost:5173, proxy /api → http://localhost:8000

# 生产构建
npm run build

# 全栈 docker
docker compose up --build
# → web:  http://localhost:3000
# → api:  http://localhost:8000
```

`vite.config.ts` 开发代理：

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
```

---

## 9. package.json 关键依赖

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.0",
    "@tanstack/react-query": "^5.60.0",
    "@tanstack/react-table": "^8.20.0",
    "lightweight-charts": "^4.2.0",
    "echarts": "^5.5.1",
    "echarts-for-react": "^3.0.2",
    "d3-format": "^3.1.0",
    "d3-scale": "^4.0.2",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.460.0",
    "cmdk": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

---

## 10. 旧 HTML 的处理

- `app/static/library.html` 和 `dashboard.html` 保留，路由 `/ui` 与 `/library` 继续可用一段过渡期
- 新前端起来后 `/web` 或 `/` (经 nginx) 访问
- M5 结束后可以把旧 HTML 移到 `chronos_finance/app/static/_legacy/`

---

## 附录 A：TradingView lightweight-charts 关键 API 参考

```ts
import { createChart, ColorType } from "lightweight-charts";

const chart = createChart(container, {
  layout: {
    background: { type: ColorType.Solid, color: "#131722" },
    textColor: "#d1d4dc",
  },
  grid: { vertLines: { color: "#1e222d" }, horzLines: { color: "#1e222d" } },
  crosshair: { mode: 1 },
  rightPriceScale: { borderColor: "#2a2e39" },
  timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false },
});

const candle = chart.addCandlestickSeries({
  upColor: "#26a69a", downColor: "#ef5350",
  borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350",
});
candle.setData(bars);  // { time, open, high, low, close }[]

// 事件 marker
candle.setMarkers([
  { time: "2024-05-22", position: "aboveBar", color: "#2962ff", shape: "arrowDown", text: "E" },
]);

// 均线副系列
const ma20 = chart.addLineSeries({ color: "#f7931a", lineWidth: 1 });
ma20.setData([{ time, value }, ...]);

// 成交量副图（第二个 priceScale）
const volume = chart.addHistogramSeries({
  priceFormat: { type: "volume" },
  priceScaleId: "",
});
volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
```
