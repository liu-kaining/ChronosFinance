# ChronosFinance 代码库全面解读

> 本文档记录 2026-04 对 ChronosFinance 仓库的一次性全面通读，用于后续前端/后端改造的上下文参考。
> 仓库根：`/Users/liqian/Desktop/code/github/ChronosFinance/`

---

## 1. 技术栈

- **后端**：Python + FastAPI 0.115 + SQLAlchemy 2.0 (async) + asyncpg + PostgreSQL + Pydantic v2
- **前端**：纯原生 HTML + JavaScript（无构建工具，无框架），ECharts 5.5.1（CDN）
- **数据源**：FMP Premium API（`chronos_finance/app/utils/fmp_client.py`）
- **部署**：Docker / docker-compose

项目根：`chronos_finance/`

---

## 2. 数据入库流程

入口 `chronos_finance/app/main.py:29` 的 lifespan：启动时 `init_db()` + `seed_registry()` 注入数据集注册表。

**三层架构**：
- **Registry 注册表** `app/services/sync/registry.py` — `DatasetSpec` 定义每个 dataset（key / scope / handler / cadence / quota_class / priority）。启动时 upsert 到 `sync_datasets` 表。
- **Orchestrator 调度器** `app/services/sync/orchestrator.py` — 跑 `run_dataset(dataset_key, symbol=...)`，写 `sync_runs` 执行日志、更新 `sync_state` 游标/新鲜度。
- **Handlers 各数据集 handler** `app/services/sync/datasets/`：
  - `daily_prices.py` — OHLCV 日线
  - `symbol_financials.py` — 利润/资产/现金流/比率/key_metrics/EV 等 → `static_financials`
  - `symbol_events.py` — 分红、拆股、财报历史
  - `symbol_alpha.py` — 内幕交易、分析师估值、SEC 10-K
  - `earnings_calendar.py` — 全局财报日历
  - `global_reference.py` — 宏观 / treasury / 全球 calendar
- **旧写入路径** `app/services/static_data_sync.py` (`sync_stock_universe` 等) 与 `integrated_sync.py` 仍存在，主要桥接 `/api/v1/sync/*` → 新 orchestrator。

入库模式：FMP API → raw dict → 各 handler 校验/reshape → SQLAlchemy bulk upsert（`INSERT ... ON CONFLICT`）到对应表。JSONB 字段 `raw_payload` 保留原始载荷以便后续挖掘。

触发方式：`POST /api/v1/ingest/datasets/{dataset_key}/run` 或 `POST /api/v1/sync/*`（背景任务）；脚本 `chronos_finance/scripts/ingest_scheduler.sh` 用于定期拉起。

---

## 3. 数据模型（全部位于 `app/models/`）

| 文件 | 表 | 主键 | 关键字段 |
|---|---|---|---|
| `stock_universe.py` | `stock_universe` | `symbol` | company_name / exchange / sector / industry / market_cap / is_actively_trading + 16 个 `*_synced` bool 旗标 + `raw_payload` |
| `static_financials.py` | `static_financials` | id; UQ(symbol,data_category,period,fiscal_year) | data_category（如 `income_statement_annual`）/ period / fiscal_year / fiscal_quarter / `raw_payload` JSONB |
| `market.py` | `daily_prices` | (symbol, date) | open/high/low/close/adj_close/volume |
| `market.py` | `corporate_actions` | id; UQ(symbol,action_type,action_date) | action_type('dividend'/'split') / raw_payload |
| `market.py` | `earnings_calendar` | (symbol, date) | eps_estimated/actual, revenue_estimated/actual |
| `market.py` | `dividend_calendar_global` / `split_calendar_global` / `ipo_calendar` / `economic_calendar` | 全局事件 | |
| `alpha.py` | `insider_trades` | id | filing_date, transaction_date, reporting_name, transaction_type, securities_transacted, price |
| `alpha.py` | `analyst_estimates` | id; UQ(symbol,kind,ref_date,published_date) | kind（`consensus_annual` / `consensus_quarter` / `price_target`）+ raw_payload |
| `alpha.py` | `sec_files` | id; UQ(symbol,form_type,fiscal_year,fiscal_period) | `raw_content` JSONB（10-K/10-Q 全文结构） |
| `alpha.py` | `stock_news`, `company_press_releases` | id | symbol, published_date, title, url |
| `macro.py` | `macro_economics` | (series_id, date) | value + raw_payload |
| `macro.py` | `macro_series_catalog` | series_id | display_name/category/source/frequency/unit |
| `macro.py` | `treasury_rates_wide` | date | month1…year30 的国债利率 |
| `sync_control.py` | `sync_datasets` / `sync_state` / `sync_runs` | 见注释 | 同步控制平面（注册表 + 每 dataset×symbol 游标+新鲜度 + 运行日志） |

`GLOBAL_SYMBOL_SENTINEL = ""` 作为全局数据集的 symbol 占位（避免 NULL 在唯一约束中的陷阱）。

---

## 4. 数据查询 API（前端主要依赖）

API 路由注册于 `main.py:50-55`，所有响应 schema 在 `app/schemas/`。

### 4.1 Insight / 库内统计（`app/api/v1_insight.py`，prefix `/api/v1`）
- `GET /stats/overview` — universe 总/活/非活 + 8 张事实表行数
- `GET /stats/sync-progress` — active 标的中各 `*_synced` 完成数
- `GET /data/universe?active_only&limit&offset&symbol_prefix` — 分页 universe
- `GET /data/symbols/{symbol}/inventory` — 单标的各表行数/日期区间/分类
- `GET /data/symbols/{symbol}/data-atlas` — 上述 + JSONB 文本长度累计
- `GET /data/macro/series` — 列出所有 macro series_id
- `GET /data/macro/series/{series_id}?limit&order` — 某 series 时序点

### 4.2 Library 明细（`app/api/v1_library.py`，prefix `/api/v1/library`）
- `GET /symbols/{sym}/prices?limit&order` — OHLCV（K 线/迷你价格图）
- `GET /symbols/{sym}/static/categories` — static_financials 的 bucket 列表
- `GET /symbols/{sym}/static?category&period&limit` — 某 bucket 的行（含 raw_payload）
- `GET /symbols/{sym}/earnings?limit` — 财报日历
- `GET /symbols/{sym}/corporate-actions?limit` — 分红/拆股
- `GET /symbols/{sym}/insider?limit` — 内幕交易
- `GET /symbols/{sym}/analyst-estimates?limit` — 分析师估值
- `GET /symbols/{sym}/sec-filings?limit` — SEC 元数据（不含全文 body）

### 4.3 新鲜度/覆盖度（`app/api/v1_freshness.py`）
- `GET /api/v1/data/freshness/overview` — 全量
- `GET /api/v1/data/freshness/symbol/{sym}` — 按标的
- `GET /api/v1/data/coverage/global` — 全局数据集覆盖
- `GET /api/v1/data/coverage/symbol/{sym}` — 单标覆盖

### 4.4 写入侧（`app/api/v1_ingest.py`、`app/api/v1_sync.py`）
触发/查看 `sync_runs`、`sync_state`、预算使用等。前端页面一般不调用。

---

## 5. 前端页面

**路由绑定** `main.py:60-87`：
- `/ui` → `app/static/dashboard.html`（运营看板）
- `/library` → `app/static/library.html`（资料库 / 主要展示页）

### 5.1 `dashboard.html`（354 行，简洁运营面板）
单页 4 个 tab（用 `section.tab.visible` 切换）：

| Tab | API 调用 | UI |
|---|---|---|
| 总览 `overview` | `/api/v1/stats/overview` | 行数卡片网格 `.grid .stat` |
| 同步进度 `sync` | `/api/v1/stats/sync-progress` | 各 `*_synced` 完成度 `n/total` |
| 标的列表 `universe` | `/api/v1/data/universe` | 分页表格（symbol/company/income/prices/filings ✓/·） |
| 单标 inventory `symbol` | `/api/v1/data/symbols/{sym}/inventory` | `<pre>` JSON 打印 |

无图表，无 ECharts。CSS 变量 dark theme（`--bg: #0f1419`, `--accent: #3d8bfd`）。

### 5.2 `library.html`（1460 行，深度研究页）

**布局**：顶部搜索栏 + 左侧 sidebar 导航 + 右侧主内容区。使用 hash 路由 `#/SYMBOL/VIEW`（如 `#/NVDA/dashboard`、`#/macro`、`#/health`）。

**sidebar 导航项** → 对应 `render*()` 函数：

| view | 渲染函数 | 调用 API | 主要 UI / 图表 |
|---|---|---|---|
| `dashboard` | `renderDashboard` (行 439) | `.../inventory`, `.../prices?limit=260`, `.../earnings?limit=80` | Hero + 迷你价格线 + 同步覆盖雷达图 + KPI 行 + 最近 EPS 柱状图 |
| `market` | `renderMarket` (行 527) | `.../prices?limit=...` | K 线蜡烛图 + 成交量 + MA20（可切 1Y/3Y/~6Y/MAX，`dataZoom`） |
| `financials` | `renderFinancials` (行 628) | `.../static?category=...&period=annual` | 子 tab（利润表/资产/现金流/关键指标/比率）+ 时序折线图 + 完整数据表 |
| `events` | `renderEvents` (行 748) | earnings + corporate-actions + insider | 双轴 EPS/营收折线、公司行为时间线、内幕交易表、明细表 |
| `analyst` | `renderAnalyst` (行 891) | `.../analyst-estimates` | kind 计数 KPI + 一致预期 EPS 折线 + 明细表 |
| `sec` | `renderSec` (行 946) | `.../sec-filings` | 只列元数据表（10-K/10-Q id/form/财年/申报日） |
| `raw` | `renderRaw` (行 980) | inventory | `<pre>` JSON dump |
| `macro` | `renderMacro` (行 990) | `/api/v1/data/macro/series`, `/api/v1/data/macro/series/{id}` | 下拉 series 选择 + 折线图 + 明细表 |
| `health` | `renderHealth` (行 1089) | freshness + coverage | 状态总览 KPI + freshness 表 + coverage 表 |
| `atlas` | `renderAtlas` (行 1169) | `.../data-atlas` | JSONB 体量综合视图（KPI + 多张分组表） |

**搜索**：顶部 `#q` → debounce 220ms → `/api/v1/data/universe?symbol_prefix=...&active_only=false` → 下拉列表（portal 到 body，`position: fixed`）。

**关键公共函数**：
- `api(path)` — fetch + JSON
- `esc(s)` — HTML 转义
- `parseHash()` / `setHash()` — hash 路由
- `extractFinancialSeries(items)` / `numFromPayload()` — 从 raw_payload 挖数值
- `maSeries(arr, n)` — MA 均线计算
- `summarizeCorp(p)` — 公司行为摘要
- `fmtCap(n)` / `fmtAtlasBytes(n)` — 格式化
- `disposeChart()` / `disposeAllCharts()` — ECharts 实例管理
- 窗口 resize 监听自动 `chart.resize()`

**全局 charts 对象**：`charts.mini / radar / epsm / k / fin / erev / an / macro`，切 view 前 `disposeAllCharts()`。

**主题 CSS 变量**：
```
--bg0:#0a0e14 --bg1:#111820 --panel:#141b26 --panel2:#1a2332
--border:#2a3441 --text:#e6edf3 --muted:#8b949e
--accent:#58a6ff --up:#3fb950 --down:#f85149 --warn:#d29922
```

---

## 6. 关键外部文件

- `spec/DATA_REARCHITECTURE_PLAN_CN.md` — 设计规约（§6.4 同步控制表、§9 API 分层、§9.2 Library UI）
- `chronos_finance/.env.example` — FMP_API_KEY、Postgres 配置
- `chronos_finance/Dockerfile` + `docker-compose.yml` — 容器化
- `chronos_finance/scripts/` — smoke_test / verify / backup / ingest_scheduler 等运维脚本
- `scripts/` 根目录 — 一次性投研脚本（AI infra 50 / core12 portfolio）

---

## 7. 前端修改要点

1. **纯单文件**：HTML + CSS + IIFE 封装的 JS，无打包、无热更新，改完直接 `/library` 刷新即可。
2. **所有新数据都能从现有 API 拿到**；若需新字段请先看 `v1_library.py` / `v1_insight.py`，没有就扩 schema + API。
3. **图表全部 ECharts**，复用 `charts[name]` + `disposeChart(name)` 的 pattern。
4. **视图新增流程**：sidebar 加 `<button class="nav-item" data-view="xxx">` → `render()` 分支 → `renderXxx(root)` → `VIEW_LABELS` 加中文标签。
5. **hash 路由**：`setHash(sym, view)` 会自动写 URL hash 并触发 `hashchange → boot()`。

---

## 8. 依赖版本（`chronos_finance/requirements.txt`）

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
sqlalchemy[asyncio]==2.0.36
asyncpg==0.30.0
pydantic==2.10.3
pydantic-settings==2.7.0
httpx==0.28.1
tenacity==9.0.0
python-dotenv==1.0.1
alembic==1.14.0
```
