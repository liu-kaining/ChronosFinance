# ChronosFinance API-WRITE 服务架构文档

> 本文档由代码逆向工程生成，描述 `api-write` 服务的完整架构。
> 生成日期：2026-04-23

---

## 目录

1. [技术栈与核心机制](#1-技术栈与核心机制)
2. [数据字典与映射关系](#2-数据字典与映射关系)
3. [API 路由清单](#3-api-路由清单)
4. [数据库设计亮点](#4-数据库设计亮点)
5. [同步编排器架构](#5-同步编排器架构)
6. [待优化与潜在风险](#6-待优化与潜在风险)

---

## 1. 技术栈与核心机制

### 1.1 Web 框架

| 组件 | 技术 | 版本/配置 |
|------|------|-----------|
| **Web 框架** | FastAPI | 0.115.6 |
| **ASGI 服务器** | Uvicorn | 生产模式 |
| **数据验证** | Pydantic v2 | `BaseModel`, `Field` |
| **配置管理** | pydantic-settings | `.env` 文件加载 |

### 1.2 数据库层

| 组件 | 技术 | 配置 |
|------|------|------|
| **ORM** | SQLAlchemy 2.0 | async 模式 |
| **驱动** | asyncpg | PostgreSQL 原生异步 |
| **连接池** | `pool_size=20` | `max_overflow=10` |
| **健康检查** | `pool_pre_ping=True` | 自动剔除失效连接 |

```python
# 连接字符串
postgresql+asyncpg://{user}:{password}@{host}:5432/{db}
```

### 1.3 后台任务机制

```
┌─────────────────────────────────────────────────────────────┐
│  FastAPI Request Handler                                     │
│  └── bg.add_task(_run_dataset_job, dataset_key, symbol)     │
│       └── BackgroundTasks (Starlette)                       │
│            └── asyncio.create_task()                        │
│                 └── run_dataset() [orchestrator]            │
│                      ├── asyncio.Semaphore(10)              │
│                      └── asyncio.gather() [并发处理]         │
└─────────────────────────────────────────────────────────────┘
```

**关键特性：**
- Fire-and-forget 模式：HTTP 请求立即返回 `202 Accepted`
- 并发控制：`asyncio.Semaphore(10)` 限制同时处理的 symbol 数
- 错误隔离：`asyncio.gather(return_exceptions=True)` 单个失败不影响其他

### 1.4 限流器 (Rate Limiter)

**实现：** 滑动窗口算法 (`fmp_client.py`)

```python
class RateLimiter:
    _max_calls: int = 750      # 配额
    _period: float = 60.0      # 时间窗口（秒）
    _timestamps: deque[float]  # 请求时间戳队列
    _lock: asyncio.Lock        # 并发安全
```

**工作流程：**
1. 请求到达时获取锁
2. 清理过期时间戳（`<= now - 60s`）
3. 若队列已满，计算等待时间并 sleep（**锁已释放**）
4. 记录当前时间戳，放行请求

**关键优化：** sleep 在锁外执行，避免阻塞其他协程

### 1.5 错误重试机制

**实现：** Tenacity 库装饰器

```python
@retry(
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    wait=wait_exponential(multiplier=1, min=1, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
async def get(self, endpoint, params): ...
```

**重试策略：**
- 仅重试 **传输层错误** 和 **5xx 状态码**
- **不重试** FMP "软错误"（HTTP 200 + `{"Error Message": ...}`）
- 指数退避：1s → 2s → 4s → 8s → 16s（最大 30s）
- 最大重试次数：5 次

### 1.6 带宽熔断机制

**实现：** 滚动窗口带宽预算 (`budget.py`)

```python
FMP_BANDWIDTH_LIMIT_GB: int = 50        # 月度带宽上限
FMP_BANDWIDTH_WINDOW_DAYS: int = 30     # 滚动窗口
FMP_BANDWIDTH_HEAVY_THROTTLE_RATIO: float = 0.90   # heavy 单独限流阈值
FMP_BANDWIDTH_MEDIUM_THROTTLE_RATIO: float = 0.98  # medium+heavy 限流阈值
```

**限流逻辑：**
```
usage_ratio = bytes_used / (50GB)

if ratio >= 0.98 and quota_class in {"medium", "heavy"}:
    → throttle medium + heavy
elif ratio >= 0.90 and quota_class == "heavy":
    → throttle heavy only
else:
    → allow
```

### 1.7 R2 冷热分离存储

**架构：** SEC 文件采用冷热分离存储策略

```
┌─────────────────────────────────────────────────────────────────┐
│  FMP API Response (JSON)                                        │
│  └── StorageService.upload_json()                               │
│       ├── R2 Object Storage (Cold) ← Primary Storage            │
│       │   └── sec_filings/{symbol}/{form_type}/{fy}_{fp}.json   │
│       │                                                          │
│       └── PostgreSQL (Hot) ← Metadata Index                     │
│           └── sec_files table                                   │
│               ├── symbol, form_type, fiscal_year, fiscal_period │
│               ├── storage_path (R2 path)                        │
│               └── raw_content (nullable, fallback cache)        │
└─────────────────────────────────────────────────────────────────┘
```

**配置项：**
```python
R2_ENDPOINT_URL: str      # e.g. https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID: str     # R2 API token
R2_SECRET_ACCESS_KEY: str # R2 API secret
R2_BUCKET_NAME: str       # e.g. chronos-sec-filings
R2_REGION: str = "auto"   # R2 使用 auto
```

**R2 路径约定：**
```
sec_filings/{symbol}/{form_type}/{fiscal_year}_{fiscal_period}.json

Examples:
  sec_filings/AAPL/10-K/2023_FY.json
  sec_filings/MSFT/10-Q/2024_Q1.json
  sec_filings/GOOGL/8-K/2024_2024-03-15.json
```

**容错机制：**
- R2 上传失败时自动降级到 DB-only 存储 (`raw_content` 字段)
- 3 次重试 + 指数退避 (1s → 2s → 4s)
- 上传操作不阻塞 DB 事务（先上传 R2，再写 DB）

**依赖：** `aioboto3==13.2.0`

---

## 2. 数据字典与映射关系

### 2.1 数据集总览

系统当前支持 **32 个数据集**，分为 **global** 和 **symbol** 两种作用域。

### 2.2 Global 数据集 (全局，不按股票)

| Dataset Key | 业务含义 | FMP API 端点 | DB 表名 | 增量依据 |
|-------------|----------|--------------|---------|----------|
| `global.earnings_calendar` | 全局盈利日历 | `/earnings-calendar` | `earnings_calendar` | `MAX(date)` |
| `global.dividends_calendar` | 全局分红日历 | `/dividends-calendar` | `dividend_calendar_global` | `MAX(date)` |
| `global.splits_calendar` | 全局拆股日历 | `/splits-calendar` | `split_calendar_global` | `MAX(date)` |
| `global.ipos_calendar` | IPO 日历 | `/ipos-calendar` | `ipo_calendar` | `MAX(date)` |
| `global.economic_calendar` | 经济事件日历 | `/economic-calendar` | `economic_calendar` | `MAX(date)` |
| `global.treasury_rates_wide` | 美债收益率曲线 | `/treasury-rates` | `treasury_rates_wide` | `MAX(date)` |
| `global.macro_economics` | 宏观经济指标 | `/economic-indicators` | `macro_economics` | `MAX(date)` per series |
| `global.macro_series_catalog` | 宏观指标目录 | (代码内置) | `macro_series_catalog` | content_hash |
| `global.sector_performance` | 行业表现 & P/E | `/historical-sectors-performance` + `/sector_price_earning_ratio` | `sector_performance_series` | `MAX(date)` |

### 2.3 Symbol 数据集 (按股票)

#### Phase 2-3: 财务数据 (→ `static_financials`)

| Dataset Key | 业务含义 | FMP API 端点 | 增量依据 |
|-------------|----------|--------------|----------|
| `symbol.financials.income_statement` | 利润表 | `/income-statement` | fiscal_period |
| `symbol.financials.balance_sheet` | 资产负债表 | `/balance-sheet-statement` | fiscal_period |
| `symbol.financials.cash_flow` | 现金流表 | `/cash-flow-statement` | fiscal_period |
| `symbol.financials.ratios` | 财务比率 | `/ratios` | fiscal_period |
| `symbol.financials.metrics` | 关键指标 | `/key-metrics` | fiscal_period |
| `symbol.financials.scores` | 评分 (Altman-Z/Piotroski) | `/score` | snapshot |
| `symbol.financials.enterprise_values` | 企业价值 | `/enterprise-values` | fiscal_period |
| `symbol.financials.executive_compensation` | 高管薪酬 | `/governance/executive_compensation` | fiscal_period |
| `symbol.financials.revenue_segmentation` | 营收分割 | `/revenue-product-segmentation` + `/revenue-geographic-segmentation` | fiscal_period |
| `symbol.financials.stock_peers` | 同行公司 | `/stock_peers` | snapshot |

#### Phase 4: 市场数据

| Dataset Key | 业务含义 | FMP API 端点 | DB 表名 | 增量依据 |
|-------------|----------|--------------|---------|----------|
| `symbol.daily_prices` | 日 K 线 OHLCV | `/historical-price-eod/full` | `daily_prices` | `MAX(date)` |
| `symbol.corporate_actions` | 分红/拆股 | `/historical-price-full/stock_dividend` + `/stock_split` | `corporate_actions` | `MAX(date)` |
| `symbol.earnings_history` | 历史盈利 | `/earnings` | `earnings_calendar` | `MAX(date)` |

#### Phase 5: Alpha 信号

| Dataset Key | 业务含义 | FMP API 端点 | DB 表名 | 增量依据 |
|-------------|----------|--------------|---------|----------|
| `symbol.alpha.insider_trades` | 内部人交易 | `/insider-trading` | `insider_trades` | event_window |
| `symbol.alpha.analyst_estimates` | 分析师预估 | `/analyst-estimates` + `/price-target` | `analyst_estimates` | snapshot |
| `symbol.alpha.sec_filings_10k` | 10-K 文件 | `/financial-reports-json` | `sec_files` | fiscal_period + R2 |
| `symbol.alpha.sec_filings_10q` | 10-Q 文件 | `/financial-reports-json` | `sec_files` | fiscal_period + R2 |
| `symbol.alpha.sec_filings_8k` | 8-K 文件 | `/sec_filings` | `sec_files` | filing_date + R2 |
| `symbol.alpha.sec_filings_10q` | 10-Q 文件 | `/financial-reports-json` | `sec_files` | 跳过已存在 (year, quarter) |
| `symbol.alpha.sec_filings_8k` | 8-K 文件 | `/sec_filings?type=8-K` | `sec_files` | `MAX(filing_date)` |
| `symbol.alpha.stock_news` | 股票新闻 | `/stock_news` | `stock_news` | event_window |
| `symbol.alpha.press_releases` | 公司新闻稿 | `/press-releases` | `company_press_releases` | event_window |

#### Phase 6: Premium 数据集

| Dataset Key | 业务含义 | FMP API 端点 | DB 表名 | 增量依据 |
|-------------|----------|--------------|---------|----------|
| `symbol.daily_market_cap` | 历史市值 | `/historical-market-capitalization` | `daily_market_cap` | `MAX(date)` |
| `symbol.share_float` | 流通盘数据 | `/shares-float` | `stock_universe` (UPDATE) | snapshot |
| `symbol.valuation.dcf` | 每日 DCF 估值 | `/historical-discounted-cash-flow` | `valuation_dcf` | `MAX(date)` |
| `symbol.company_employees_history` | 历史员工数 | `/historical/employee_count` | `company_employees_history` | `MAX(date)` |
| `symbol.alpha.equity_offerings` | 股权融资事件 | `/equity-offering-search` | `equity_offerings` | `MAX(filing_date)` |

---

## 3. API 路由清单

### 3.1 Write API (端口 8001)

#### `/api/v1/sync/*` — Legacy 触发器

| Method | Path | 说明 | 参数 |
|--------|------|------|------|
| POST | `/universe` | 同步股票池 | - |
| POST | `/financials/income` | 利润表 | `?symbol=AAPL` (可选) |
| POST | `/financials/balance` | 资产负债表 | `?symbol=AAPL` |
| POST | `/financials/cashflow` | 现金流表 | `?symbol=AAPL` |
| POST | `/ratios` | 财务比率 | `?symbol=AAPL` |
| POST | `/metrics` | 关键指标 | `?symbol=AAPL` |
| POST | `/scores` | 评分 | `?symbol=AAPL` |
| POST | `/enterprise-values` | 企业价值 | `?symbol=AAPL` |
| POST | `/compensation` | 高管薪酬 | `?symbol=AAPL` |
| POST | `/segments` | 营收分割 | `?symbol=AAPL` |
| POST | `/peers` | 同行 | `?symbol=AAPL` |
| POST | `/market/prices` | 日 K 线 | `?symbol=AAPL` |
| POST | `/market/actions` | 分红/拆股 | `?symbol=AAPL` |
| POST | `/market/market-cap` | 历史市值 | `?symbol=AAPL` |
| POST | `/market/float` | 流通盘 | `?symbol=AAPL` |
| POST | `/events/earnings` | 盈利日历 | `?symbol=AAPL` |
| POST | `/alpha/insider` | 内部人交易 | `?symbol=AAPL` |
| POST | `/alpha/estimates` | 分析师预估 | `?symbol=AAPL` |
| POST | `/alpha/filings` | 10-K 文件 | `?symbol=AAPL` |
| POST | `/alpha/filings-10q` | 10-Q 文件 | `?symbol=AAPL` |
| POST | `/alpha/filings-8k` | 8-K 文件 | `?symbol=AAPL` |
| POST | `/financials/dcf` | DCF 估值 | `?symbol=AAPL` |
| POST | `/company/employees` | 历史员工数 | `?symbol=AAPL` |
| POST | `/alpha/equity-offerings` | 股权融资事件 | `?symbol=AAPL` |
| POST | `/global/sectors` | 行业表现 | - |
| POST | `/macro/indicators` | 宏观指标 | - |

#### `/api/v1/ingest/*` — 新版 Orchestrator API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/datasets` | 列出所有数据集定义 |
| GET | `/datasets/{key}` | 单个数据集详情 |
| POST | `/datasets/{key}/run` | 触发数据集运行 |
| GET | `/budget` | 带宽预算状态 |
| GET | `/state` | 同步状态查询 |
| GET | `/runs` | 运行日志查询 |

### 3.2 Read API (端口 8000)

#### `/api/v1/stats/*` — 统计接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/overview` | 系统概览 |
| GET | `/sync-progress` | 同步进度（含所有 `*_synced` 计数） |
| GET | `/data/freshness` | 数据新鲜度 |
| GET | `/data/coverage` | 数据覆盖度 |

#### `/api/v1/data/*` — 数据查询

| Method | Path | 说明 |
|--------|------|------|
| GET | `/universe` | 股票池列表 |
| GET | `/inventory/{symbol}` | 单股数据清单 |
| GET | `/atlas/{symbol}` | 单股数据量统计 |
| GET | `/macro` | 宏观数据 |

#### `/api/v1/library/*` — 数据交付

| Method | Path | 说明 |
|--------|------|------|
| GET | `/prices/{symbol}` | K 线数据 |
| GET | `/financials/{symbol}` | 财务数据 |
| GET | `/earnings/{symbol}` | 盈利数据 |
| GET | `/insider/{symbol}` | 内部人交易 |
| GET | `/analyst/{symbol}` | 分析师预估 |
| GET | `/sec/{symbol}` | SEC 文件 |

---

## 4. 数据库设计亮点

### 4.1 核心表结构

#### `stock_universe` — 股票主表

```sql
PRIMARY KEY: symbol (VARCHAR 20)

关键字段:
  is_actively_trading BOOLEAN  -- 是否在交易
  market_cap FLOAT             -- 市值
  free_float FLOAT             -- 流通比例
  float_shares BIGINT          -- 流通股数
  outstanding_shares BIGINT    -- 总股本

同步标志 (16 个):
  income_synced, balance_synced, cashflow_synced,
  ratios_synced, metrics_synced, scores_synced, ev_synced,
  compensation_synced, segments_synced, peers_synced,
  prices_synced, actions_synced, earnings_synced,
  insider_synced, estimates_synced, filings_synced,
  float_synced, market_cap_synced, dcf_synced
```

#### `daily_prices` — 日 K 线

```sql
PRIMARY KEY: (symbol, date)

UNIQUE CONSTRAINT: 无（PK 即唯一）

字段:
  open, high, low, close, adj_close FLOAT
  volume BIGINT
```

#### `static_financials` — 财务数据 (多态表)

```sql
PRIMARY KEY: id (SERIAL)

UNIQUE CONSTRAINT: (symbol, data_category, period, fiscal_year)

data_category 枚举:
  'income_statement', 'balance_sheet', 'cash_flow',
  'ratios', 'metrics', 'scores', 'enterprise_values',
  'executive_compensation', 'revenue_segmentation', 'stock_peers'

period 枚举: 'annual', 'quarter'
```

#### `sec_files` — SEC 文件

```sql
PRIMARY KEY: id (SERIAL)

UNIQUE CONSTRAINT: (symbol, form_type, fiscal_year, fiscal_period)

form_type 枚举: '10-K', '10-Q', '8-K'

fiscal_period:
  'FY' for 10-K
  'Q1'/'Q2'/'Q3' for 10-Q
  ISO date string for 8-K
```

#### `valuation_dcf` — DCF 估值

```sql
PRIMARY KEY: (symbol, date)

字段:
  dcf FLOAT          -- DCF 内在价值
  stock_price FLOAT  -- 当日股价
```

#### `company_employees_history` — 历史员工数

```sql
PRIMARY KEY: (symbol, date)

字段:
  employee_count BIGINT  -- 员工数量
```

#### `equity_offerings` — 股权融资事件

```sql
PRIMARY KEY: id (SERIAL)

UNIQUE CONSTRAINT: (symbol, filing_date, offering_amount)

字段:
  filing_date DATE        -- 备案日期
  offering_date DATE      -- 发行日期
  offering_amount FLOAT   -- 融资金额 (USD)
  shares_offered BIGINT   -- 发行股数
  offering_price FLOAT    -- 发行价格
  offering_type VARCHAR   -- 发行类型
```

### 4.2 幂等性保证

**所有写入均使用 PostgreSQL Upsert：**

```python
stmt = pg_insert(Table).values(rows)
stmt = stmt.on_conflict_do_update(
    index_elements=["symbol", "date"],  # 或 constraint="uq_xxx"
    set_={
        "field1": stmt.excluded.field1,
        "field2": stmt.excluded.field2,
        "raw_payload": stmt.excluded.raw_payload,
    },
)
```

**效果：**
- 重复运行不会产生重复行
- 数据更新时自动覆盖
- 无需先 DELETE 再 INSERT

### 4.3 同步控制表

#### `sync_datasets` — 数据集注册表

```sql
PRIMARY KEY: dataset_key

字段:
  scope VARCHAR          -- 'global' or 'symbol'
  cadence_seconds INT    -- 刷新周期
  cursor_strategy VARCHAR -- 'date'/'fiscal_period'/'snapshot'/'event_window'
  quota_class VARCHAR    -- 'light'/'medium'/'heavy'
  enabled BOOLEAN        -- 是否启用
```

#### `sync_state` — 同步状态

```sql
PRIMARY KEY: (dataset_key, symbol)

字段:
  cursor_date DATE           -- 日期游标
  cursor_value VARCHAR       -- 通用游标
  status VARCHAR             -- 'ok'/'failed'/'skipped'/'throttled'
  last_success_at TIMESTAMPTZ
  fresh_until TIMESTAMPTZ    -- 数据新鲜度过期时间
  records_written_total BIGINT
  bytes_estimated_total BIGINT
  content_hash_last VARCHAR  -- 内容哈希（用于 unchanged 检测）
```

#### `sync_runs` — 运行日志

```sql
PRIMARY KEY: id (SERIAL)

字段:
  dataset_key, symbol VARCHAR
  trigger VARCHAR            -- 'manual'/'legacy_sync'/'scheduler'
  status VARCHAR             -- 'running'/'ok'/'failed'/'skipped'/'throttled'
  started_at, finished_at TIMESTAMPTZ
  records_written INT
  error_message TEXT
```

---

## 5. 同步编排器架构

### 5.1 核心数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HTTP Request                                 │
│  POST /api/v1/ingest/datasets/{key}/run                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI BackgroundTasks                           │
│  bg.add_task(run_dataset, dataset_key, symbol, trigger)             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Orchestrator                                     │
│  run_dataset(dataset_key, symbol, trigger)                           │
│                                                                       │
│  1. 解析 DatasetSpec (从 registry)                                    │
│  2. 检查带宽预算 (should_throttle)                                    │
│  3. 解析目标 symbol 列表                                              │
│  4. 并发执行 (asyncio.Semaphore(10) + gather)                        │
│     └── _run_single(spec, symbol, trigger)                          │
│          ├── 打开 SyncRun 行                                         │
│          ├── 调用 handler(ctx) → DatasetResult                       │
│          ├── 提交 SyncState (upsert)                                 │
│          └── 翻转 legacy flag (如配置)                               │
│  5. 汇总结果返回                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 DatasetContext (Handler 入参)

```python
@dataclass
class DatasetContext:
    spec: DatasetSpec              # 数据集定义
    symbol: str                     # 当前 symbol ("" for global)
    previous_state: SyncState | None  # 上次同步状态
    trigger: str = "manual"         # 触发来源

    @property
    def previous_cursor_date(self) -> date | None: ...

    @property
    def previous_cursor_value(self) -> str | None: ...
```

### 5.3 DatasetResult (Handler 返回)

```python
@dataclass
class DatasetResult:
    records_written: int = 0        # 写入行数
    bytes_estimated: int = 0        # 估计字节数
    requests_count: int = 0         # API 请求次数
    cursor_date: date | None = None # 新游标日期
    cursor_value: str | None = None # 新游标值
    content_hash: str | None = None # 内容哈希
    skipped_reason: str | None = None  # 'unchanged'/'empty'
    details: dict[str, Any] = field(default_factory=dict)
```

### 5.4 Cursor Strategy 说明

| Strategy | 适用场景 | 增量逻辑 |
|----------|----------|----------|
| `date` | 时间序列数据 | `MAX(date)` + `from=` 参数 |
| `fiscal_period` | 财务数据 | 按财年/季度递增 |
| `snapshot` | 快照数据 | content_hash 检测 |
| `event_window` | 事件流 | `MAX(date)` + limit |
| `custom` | 自定义 | Handler 自行实现 |

---

## 6. 待优化与潜在风险

### 6.1 性能瓶颈

| 问题 | 影响 | 建议 |
|------|------|------|
| **Symbol 并发数固定为 10** | FMP 限流 750/60s 是真正瓶颈，但 10 并发可能不够 | 考虑动态调整基于带宽剩余 |
| **无批量 INSERT 优化** | 部分小表仍逐行 INSERT | 统一使用 `pg_insert().values([batch])` |
| **JSONB 全量存储** | `raw_payload` 存储完整 FMP 响应，数据膨胀 | 考虑压缩或仅存关键字段 |
| **无分区表** | `daily_prices` 百亿级时查询变慢 | 按 year 或 symbol hash 分区 |

### 6.2 可靠性风险

| 问题 | 影响 | 建议 |
|------|------|------|
| **无持久化任务队列** | API 重启时后台任务丢失 | 引入 Redis/Celery 或数据库任务表 |
| **无分布式锁** | 多实例部署时可能重复执行 | 引入 Redis 分布式锁 |
| **错误无告警** | 失败仅记录日志 | 接入 Sentry/Prometheus 告警 |
| **无断点续传 UI** | 失败后需手动重跑 | 实现自动重试 + UI 展示失败任务 |

### 6.3 数据质量风险

| 问题 | 影响 | 建议 |
|------|------|------|
| **无数据校验** | FMP 返回异常数据直接入库 | 增加 Pydantic schema 校验 |
| **无数据修复机制** | 错误数据需手动处理 | 实现 `DELETE + RE-SYNC` 工具 |
| **无数据版本控制** | 无法追溯历史快照 | 考虑 `_version` 列 + 时间旅行查询 |

### 6.4 运维风险

| 问题 | 影响 | 建议 |
|------|------|------|
| **无健康检查深度探针** | 仅 `/health` 返回 200 | 增加 DB 连接、FMP 配额检查 |
| **无 Metrics 暴露** | 无法监控性能 | 暴露 Prometheus `/metrics` 端点 |
| **日志无结构化** | 难以聚合分析 | 使用 structlog/json 日志 |
| **无 API 版本控制** | 未来升级可能破坏兼容 | 路由增加 `/v2/` 前缀 |

### 6.5 安全风险

| 问题 | 影响 | 建议 |
|------|------|------|
| **无认证** | 任何人可触发同步 | 增加 API Key / JWT 认证 |
| **无请求限流** | 可被 DDoS | 增加 per-IP rate limit |
| **敏感配置明文** | `.env` 中明文存储 API Key | 使用 Vault 或 KMS |

---

## 附录 A: 环境变量清单

```bash
# PostgreSQL
POSTGRES_USER=chronos
POSTGRES_PASSWORD=changeme_strong_password
POSTGRES_DB=chronos_finance
POSTGRES_HOST=db
POSTGRES_PORT=5432

# FMP API
FMP_API_KEY=your_api_key
FMP_BASE_URL=https://financialmodelingprep.com/stable
FMP_RATE_LIMIT=750
FMP_RATE_PERIOD=60
FMP_BANDWIDTH_LIMIT_GB=50
FMP_BANDWIDTH_WINDOW_DAYS=30
FMP_BANDWIDTH_HEAVY_THROTTLE_RATIO=0.90
FMP_BANDWIDTH_MEDIUM_THROTTLE_RATIO=0.98

# App
APP_ENV=production
APP_PORT=8000
LOG_LEVEL=INFO
CORS_ALLOW_ORIGINS=http://localhost:3000
```

---

## 附录 B: 快速命令参考

### B.1 服务管理

```bash
# 启动所有服务
docker-compose up -d

# 停止所有服务
docker-compose down

# 重启单个服务
docker-compose restart api-write
docker-compose restart api-read

# 查看服务状态
docker-compose ps

# 查看服务日志
docker-compose logs -f api-write
docker-compose logs -f api-read
docker-compose logs -f db

# 进入数据库容器
docker-compose exec db psql -U chronos -d chronos_finance
```

### B.2 数据同步

```bash
# ── 全量同步 (首次初始化) ────────────────────────────────
cd chronos_finance
bash scripts/full_sync_campaign.sh

# 后台运行 (推荐)
nohup bash scripts/full_sync_campaign.sh >> full_sync.log 2>&1 </dev/null &

# ── 每日增量同步 ──────────────────────────────────────────
bash scripts/daily_incremental_sync.sh

# Cron 配置 (每天收盘后运行)
# crontab -e
# 30 17 * * 1-5 cd /path/to/chronos_finance && bash scripts/daily_incremental_sync.sh >> /var/log/chronos/incremental.log 2>&1
```

### B.3 API 调用 — Write 端 (端口 8001)

```bash
# ── 触发 Legacy Sync 路由 ────────────────────────────────
# 同步股票池
curl -X POST http://localhost:8001/api/v1/sync/universe

# 同步单只股票的 K 线
curl -X POST "http://localhost:8001/api/v1/sync/market/prices?symbol=AAPL"

# 同步全市场 K 线 (后台任务)
curl -X POST http://localhost:8001/api/v1/sync/market/prices

# 同步财务数据
curl -X POST "http://localhost:8001/api/v1/sync/financials/income?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/financials/balance?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/financials/cashflow?symbol=AAPL"

# 同步 Alpha 数据
curl -X POST "http://localhost:8001/api/v1/sync/alpha/insider?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/alpha/estimates?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/alpha/filings?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/alpha/filings-10q?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/alpha/filings-8k?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/alpha/equity-offerings?symbol=AAPL"

# 同步 Premium 数据
curl -X POST "http://localhost:8001/api/v1/sync/market/market-cap?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/market/float?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/financials/dcf?symbol=AAPL"
curl -X POST "http://localhost:8001/api/v1/sync/company/employees?symbol=AAPL"

# 同步 Global 数据
curl -X POST http://localhost:8001/api/v1/sync/global/sectors
curl -X POST http://localhost:8001/api/v1/sync/macro/indicators

# ── Orchestrator API ──────────────────────────────────────
# 列出所有数据集
curl http://localhost:8001/api/v1/ingest/datasets | jq

# 查看单个数据集详情
curl http://localhost:8001/api/v1/ingest/datasets/symbol.daily_prices | jq

# 触发数据集运行 (全量)
curl -X POST http://localhost:8001/api/v1/ingest/datasets/symbol.daily_prices/run

# 触发数据集运行 (单只股票)
curl -X POST "http://localhost:8001/api/v1/ingest/datasets/symbol.daily_prices/run?symbol=AAPL"

# 查看带宽预算
curl http://localhost:8001/api/v1/ingest/budget | jq

# 查看同步状态
curl http://localhost:8001/api/v1/ingest/state | jq

# 查看运行日志
curl "http://localhost:8001/api/v1/ingest/runs?limit=20" | jq
```

### B.4 API 调用 — Read 端 (端口 8000)

```bash
# ── 健康检查 ──────────────────────────────────────────────
curl http://localhost:8000/health

# ── 统计接口 ──────────────────────────────────────────────
# 系统概览
curl http://localhost:8000/api/v1/stats/overview | jq

# 同步进度 (含所有 *_synced 计数)
curl http://localhost:8000/api/v1/stats/sync-progress | jq

# 数据新鲜度
curl http://localhost:8000/api/v1/data/freshness | jq

# 数据覆盖度
curl http://localhost:8000/api/v1/data/coverage | jq

# ── 数据查询 ──────────────────────────────────────────────
# 股票池列表
curl "http://localhost:8000/api/v1/data/universe?limit=20" | jq

# 单股数据清单
curl http://localhost:8000/api/v1/data/inventory/AAPL | jq

# 单股数据量统计
curl http://localhost:8000/api/v1/data/atlas/AAPL | jq

# ── 数据交付 (Library) ────────────────────────────────────
# K 线数据
curl "http://localhost:8000/api/v1/library/prices/AAPL?start=2024-01-01&end=2024-12-31" | jq

# 财务数据
curl http://localhost:8000/api/v1/library/financials/AAPL | jq

# 盈利数据
curl http://localhost:8000/api/v1/library/earnings/AAPL | jq

# 内部人交易
curl http://localhost:8000/api/v1/library/insider/AAPL | jq

# 分析师预估
curl http://localhost:8000/api/v1/library/analyst/AAPL | jq

# SEC 文件
curl http://localhost:8000/api/v1/library/sec/AAPL | jq
```

### B.5 数据库操作

```bash
# ── 连接数据库 ────────────────────────────────────────────
docker-compose exec db psql -U chronos -d chronos_finance

# ── 执行迁移脚本 ──────────────────────────────────────────
docker-compose exec -T db psql -U chronos -d chronos_finance < scripts/migrations/001_add_5_premium_datasets.sql
docker-compose exec -T db psql -U chronos -d chronos_finance < scripts/migrations/002_add_2_alpha_premium_datasets.sql

# ── 常用查询 ──────────────────────────────────────────────
# 查看表大小
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

# 查看活跃股票数
SELECT COUNT(*) FROM stock_universe WHERE is_actively_trading = true;

# 查看最新 K 线日期
SELECT MAX(date) FROM daily_prices;

# 查看同步进度
SELECT symbol, COUNT(*) FILTER (WHERE prices_synced) as prices,
       COUNT(*) FILTER (WHERE income_synced) as income
FROM stock_universe WHERE is_actively_trading = true
GROUP BY symbol LIMIT 10;

# 清空所有数据表 (谨慎!)
TRUNCATE TABLE stock_universe, daily_prices, static_financials,
              daily_market_cap, valuation_dcf, sector_performance_series,
              company_employees_history, equity_offerings
RESTART IDENTITY CASCADE;
```

### B.6 数据质量检查

```bash
# 运行数据质量稽查脚本
cd chronos_finance
python scripts/audit_data_quality.py

# 安装依赖 (如果缺少)
pip install asyncpg tabulate
```

### B.7 开发调试

```bash
# ── 本地开发 (非 Docker) ──────────────────────────────────
cd chronos_finance
pip install -r requirements.txt

# 启动 Read API
uvicorn app.main_read:app --host 0.0.0.0 --port 8000 --reload

# 启动 Write API
uvicorn app.main_write:app --host 0.0.0.0 --port 8001 --reload

# ── 查看 API 文档 ──────────────────────────────────────────
# Swagger UI
open http://localhost:8000/docs
open http://localhost:8001/docs

# ReDoc
open http://localhost:8000/redoc
open http://localhost:8001/redoc

# ── 语法检查 ──────────────────────────────────────────────
python -m py_compile app/services/sync/registry.py
python -m py_compile app/api/v1_sync.py
```

---

## 附录 C: 迁移脚本清单

| 文件 | 说明 |
|------|------|
| `scripts/migrations/001_add_5_premium_datasets.sql` | Phase 6: 市值、流通盘、DCF、行业表现等 |
| `scripts/migrations/002_add_2_alpha_premium_datasets.sql` | Phase 7: 员工数、股权融资 |

---

*文档结束*
