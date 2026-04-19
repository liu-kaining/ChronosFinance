# ChronosFinance 数据架构重构规划（中文版）

## 1. 文档目的

本文档是下一阶段数据平台重构的唯一执行基线。
后续所有与 schema、入库流程、API 分层、资料库数据透明化相关的改动，均以本文档为准；除非先更新本文档再变更代码。

核心目标：

1. 最大化 FMP 可用数据覆盖，不浪费订阅能力。
2. 支持稳定的增量同步（默认每 3 小时）并可度量新鲜度。
3. 明确分离写入/维护 API 与读取/消费 API。
4. 保证全局数据尽可能完整、单标的数据具备足够时间跨度。
5. 提供可观测、可解释的数据覆盖视图（有什么、更新到哪、完整度如何）。

---

## 2. 已确认运行约束

基于当前 FMP 账号与官方文档：

- 方案档位：`Premium Annual`
- 请求上限：`750 calls / minute`
- 带宽上限：`50 GB / rolling 30 days`

结论：调度策略必须同时优化 QPS 和带宽预算，不能只盯每分钟请求数。

---

## 3. 范围与非目标

### 本期范围

- 按长期可维护目标重建数据模型，支持全量 + 增量。
- 引入 dataset 驱动的编排式同步。
- 建立基于 `sync_state` 的新鲜度/完整度框架。
- 设计分层调度节奏与配额分配策略。
- 拆分写侧 API 与读侧 API。
- 保持资料库/展示页以“透明展示数据全貌”为中心。

### 本期非目标

- 实时流式架构（streaming）。
- 多数据源供应商抽象（非 FMP）。
- 高级建模与训练流水线。

---

## 4. 已定核心决策

1. **核心标的池 = 1857**（当前全量核心池），不是 300。
2. **默认增量周期 = 每 3 小时**（核心数据集）。
3. **写读 API 分离**：
   - 写侧：`/api/v1/ingest/*`
   - 读侧：`/api/v1/data/*` 与 `/api/v1/library/*`
4. **新鲜度状态唯一权威**：`sync_state` 表（不是散落在各表的临时字段）。
5. 现有 `*_synced` 仅表示“首次全量回填完成”语义。
6. 大体量数据集（大文本/高频）单独配额、较低频率运行。

---

## 5. 目标架构

## 5.1 分层

1. **数据源层**：FMP Stable endpoints。
2. **入库层**：dataset worker（`fetch -> normalize -> upsert -> update sync_state`）。
3. **存储层**：规范化事实表 + 全局表 + 同步控制表。
4. **读 API 层**：轻量、可索引、可携带新鲜度信息的查询接口。
5. **展示层**：资料库/看板等只读页面，消费读 API。

## 5.2 Dataset 作为最小调度单元

每个 dataset 独立调度、独立状态管理。

- 示例 dataset key：
  - `symbol.daily_prices`
  - `symbol.financial.income_statement`
  - `global.earnings_calendar`
  - `global.macro_series.CPIAUCSL`

每个 dataset 显式定义：

- cadence（调度频率）
- incremental cursor strategy（增量游标策略）
- retry/backoff policy（重试与退避）
- quota class（`light` / `medium` / `heavy`）
- freshness SLA target（新鲜度目标）

---

## 6. 数据模型蓝图

## 6.1 核心参考表

- `stock_universe`
- `company_profile_history`
- `symbol_aliases`（如需处理代码变更连续性）

## 6.2 单标事实表（必须有时间跨度）

- `daily_prices`
- `intraday_prices`（按范围和频率策略控制）
- `quotes_latest`
- `historical_market_cap`
- `shares_float`
- `statement_income`
- `statement_balance`
- `statement_cashflow`
- `metrics_kv`（统一承载 key metrics/ratios/scores/EV）
- `analyst_price_targets`
- `analyst_ratings_history`
- `institutional_holders`
- `sec_filings_index`
- `company_press_releases`
- `upgrades_downgrades`
- `stock_news`
- `executive_compensation`
- `revenue_segmentation`

## 6.3 全局事实表（必须尽量完整）

- `earnings_calendar`
- `dividend_calendar_global`
- `split_calendar_global`
- `ipo_calendar`
- `economic_calendar`
- `macro_series_catalog`
- `macro_economics`
- `treasury_rates_wide`

## 6.4 同步控制表（必选）

- `sync_datasets`
- `sync_state`
- `sync_runs`

`sync_state` 最小字段集：

- `dataset_key`
- `symbol`（全局数据可为空）
- `cursor_date` / `cursor_value`
- `last_success_at`
- `last_attempt_at`
- `fresh_until`
- `records_written`
- `bytes_estimated`
- `content_hash_last`
- `status`
- `error_message`（可空）

---

## 7. 按数据类型的增量策略

1. **日期序列类**：使用最大日期游标（`cursor_date`），并保留重叠窗口防漏数。
2. **财报期间类**：使用 `(fiscal_year, fiscal_period)` 作为组合游标。
3. **快照类**：按自然主键 + `as_of` 做 upsert。
4. **事件流类**：滚动窗口拉取 + 按自然唯一键去重。
5. **文本重载类**：事件驱动拉取 + 每日对账扫描。
6. **幂等写入**：
   - `INSERT ... ON CONFLICT DO UPDATE`
   - 仅当 `content_hash` 变化时更新，降低无效写放大。

---

## 8. 调度节奏与配额策略

## 8.1 标的分层

- `P0` = 全量 `1857`（核心层）
- `P1` = P0 中活跃子集（可配置，如 300-600）
- `P2` = 重数据目标子集（可配置）

## 8.2 默认节奏

- **每 3 小时**：P0 核心增量数据集。
- **每 1~3 小时**：P1 中等/较重数据集。
- **每日/每周**：P2 重 payload + 低波动数据集。
- **每日对账轮**：补洞、迟到数据修复、一致性校验。

## 8.3 配额分配

双层控制：

1. 全局限流器（`<=750 calls/min`，保留安全余量）。
2. 滚动带宽预算守卫（`<=50GB/30d`，设置多级告警阈值）。

建议策略：

- 全局关键数据集预留固定容量。
- 单标数据集按优先级分配预算。
- 接近带宽上限时，优先降速/延后 heavy 数据集。

---

## 9. API 设计

## 9.1 入库/维护 API（写侧）

- `POST /api/v1/ingest/run`
- `POST /api/v1/ingest/datasets/{dataset_key}/run`
- `POST /api/v1/ingest/symbols/{symbol}/run`
- `GET /api/v1/ingest/runs/{run_id}`
- `GET /api/v1/ingest/state`（运维视图）

写侧只面向 cron / ops / 内部维护流程。

## 9.2 查询/消费 API（读侧）

- 现有 data/library 查询接口延续。
- 新增/完善新鲜度与覆盖度接口：
  - `GET /api/v1/data/freshness/overview`
  - `GET /api/v1/data/freshness/symbol/{symbol}`
  - `GET /api/v1/data/coverage/symbol/{symbol}`
  - `GET /api/v1/data/coverage/global`

读接口响应在适用场景下应包含 `meta.freshness`。

---

## 10. 实施路线图

## Phase M0：对齐与冻结

- 冻结架构决策（即本文档）。
- 定义 dataset registry v1。
- 确认 DDL 迁移包清单。

## Phase M1：控制面基础建设

- 创建 `sync_datasets`、`sync_state`、`sync_runs`。
- 落地通用编排能力：
  - rate limiter
  - retry/backoff
  - cursor helpers
  - run logging

## Phase M2：全局数据集迁移

- 迁移全局日历、宏观、国债收益率链路。
- 提供全局 freshness/coverage 读接口。

## Phase M3：单标核心数据集迁移

- 将 P0 单标数据集迁入新 schema + sync state 框架。
- 保证先全量回填，再稳定增量。

## Phase M4：重数据层接入

- 接入 heavy 数据集并纳入配额感知调度。
- 实现 payload 预算与优雅降速策略。

## Phase M5：读 API 整合 + 资料库透明化

- 完成 atlas/freshness 等可视化接口。
- 确保 UI 清晰展示“完整度 + 新鲜度”。

## Phase M6：切换与旧链路退役

- cron 全量切换到新写侧 ingest API。
- 通过对齐验证后下线旧同步链路。
- 保留至少一个发布周期的回滚脚本。

---

## 11. 验收标准

1. 1857 个标的全部纳入核心增量周期。
2. 全局数据集具备明确 freshness 状态与 coverage 指标。
3. 单标数据集可展示时间跨度与新鲜度元信息。
4. 写读 API 按职责彻底分离。
5. 流水线具备幂等、可恢复、可重跑能力。
6. QPS 与带宽均在套餐约束内，且有告警机制。

---

## 12. 可观测性与告警

需持续跟踪并告警：

- 各 dataset 同步成功率
- 过期 dataset 数量（freshness SLA 违约）
- 单次 run 字节量与 30 天滚动字节估算
- 写放大（尝试写入行数 vs 实际变更行数）
- 各 endpoint 高频失败模式

---

## 13. 变更治理

凡涉及 cadence、主键/唯一键、dataset registry、API contract 的变更，必须先更新本文档，再修改代码。

建议流程：

1. 先更新规划文档。
2. 基于变更章节生成实现 TODO 清单。
3. 按小里程碑执行代码改造。
4. 完成验证并回写状态记录。

---

## 14. 立即落地交付物

1. `sync_*` 控制表 + 首批重构事实表的 DDL v1。
2. dataset registry 种子配置（key/cadence/cursor/quota class）。
3. orchestrator 骨架 + 一组端到端迁移样例：
   - 1 个全局 dataset
   - 1 个单标 dataset
4. freshness/coverage 查询接口 v1。

---

## 15. 阶段状态（持续更新）

当前代码实现进度（相对于本规划）：

- M0：已完成（方案冻结）
- M1：已完成（`sync_datasets` / `sync_state` / `sync_runs` + orchestrator）
- M2：已完成（全局日历、宏观、国债链路迁移到新编排）
- M3：已完成（单标核心 + alpha 迁移到新编排）
- M4：已完成（heavy dataset + 30天滚动带宽预算守卫）
- M5：已完成（资料库接入 freshness/coverage 视图）
- M6：已完成（新增 `scripts/ingest_scheduler.sh`，旧 `/api/v1/sync/*` 作为兼容壳层转发）

当前建议：

1. 运维调度以 `scripts/ingest_scheduler.sh` + `/api/v1/ingest/*` 为主。
2. `v1_sync` 仅用于兼容窗口，计划在验证稳定后下线。
3. 每次改动 cadence / registry / API contract 前先更新本文件。

