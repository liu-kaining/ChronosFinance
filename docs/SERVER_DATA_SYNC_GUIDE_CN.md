# ChronosFinance 服务器数据运维指南

本文档用于服务器环境，覆盖以下 4 件事：

1. 导出数据（备份）
2. 导入数据（恢复）
3. 启动每日增量同步
4. 配置每 4 小时检查并触发增量任务

---

## 0. 前置条件

在服务器上进入项目根目录（示例）：

```bash
cd ~/github/ChronosFinance
```

确保服务已启动：

```bash
docker compose up -d
docker compose ps
```

建议先确认读写 API 健康：

```bash
curl -s "http://localhost:8003/health" | python3 -m json.tool
curl -s "http://localhost:8004/health" | python3 -m json.tool
```

---

## 1) 如何导出数据（备份）

项目已提供脚本：`scripts/backup_db.sh`。

### 1.1 全量备份（推荐）

```bash
cd ~/github/ChronosFinance
bash scripts/backup_db.sh
```

默认会生成：

- `backups/<POSTGRES_DB>_YYYYMMDD_HHMMSS.dump`

### 1.2 指定名称备份

```bash
cd ~/github/ChronosFinance
BACKUP_NAME="pre_upgrade_20260427" bash scripts/backup_db.sh
```

### 1.3 仅结构 / 仅数据

```bash
# 仅 schema
bash scripts/backup_db.sh --schema-only

# 仅 data
bash scripts/backup_db.sh --data-only
```

### 1.4 验证备份文件

```bash
ls -lht backups/*.dump | head
```

### 1.5 备份到 R2（固定文件名，仅数据变化时覆盖）

项目已提供脚本：`scripts/backup_to_r2_latest.sh`。

行为说明：

- 本地先生成固定文件名备份：`backups/chronos_finance_latest.dump`
- 计算本地 SHA256
- 读取 R2 manifest 对象 metadata 中的 `sha256`
- 若相同：跳过上传（不改动 R2）
- 若不同：切分为小文件分片上传（提高成功率），并覆盖 manifest

建议安装 aws cli（可选）。如果未安装，脚本会自动使用 docker 内的 `amazon/aws-cli` 镜像上传：

```bash
aws --version
```

执行备份并按需上传：

```bash
cd ~/github/ChronosFinance
bash scripts/backup_to_r2_latest.sh
```

可选：调整分片大小（默认 128MB）：

```bash
R2_SPLIT_CHUNK_MB=64 bash scripts/backup_to_r2_latest.sh
```

可选：自定义 R2 对象 key（仍然固定）：

```bash
R2_OBJECT_KEY="db/chronos_finance_latest.dump" bash scripts/backup_to_r2_latest.sh
```

---

## 2) 如何导入数据（恢复）

项目已提供脚本：`scripts/restore_db.sh`。

> 警告：恢复会覆盖现有数据，请先备份当前库。

### 2.1 普通恢复（交互确认）

```bash
cd ~/github/ChronosFinance
bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.dump
```

### 2.2 无确认恢复（自动化）

```bash
cd ~/github/ChronosFinance
bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.dump --no-confirm
```

### 2.3 Clean 模式恢复（先删后建）

```bash
cd ~/github/ChronosFinance
bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.dump --clean --no-confirm
```

### 2.4 恢复后验证

```bash
curl -s "http://localhost:8003/api/v1/stats/overview" | python3 -m json.tool
curl -s "http://localhost:8003/api/v1/stats/sync-progress" | python3 -m json.tool
```

### 2.5 从 R2 分片 manifest 恢复（推荐）

项目已提供脚本：`scripts/restore_from_r2_manifest.sh`。  
该脚本会：

- 下载 manifest（固定 key）
- 下载所有分片并校验分片 SHA
- 拼接为本地 dump 并校验整包 SHA
- 默认调用 `scripts/restore_db.sh` 完成恢复

直接恢复：

```bash
cd ~/github/ChronosFinance
bash scripts/restore_from_r2_manifest.sh
```

只下载不恢复：

```bash
bash scripts/restore_from_r2_manifest.sh --download-only
```

指定输出文件：

```bash
bash scripts/restore_from_r2_manifest.sh --output backups/chronos_from_r2.dump
```

自动恢复且跳过确认（谨慎）：

```bash
bash scripts/restore_from_r2_manifest.sh --restore --no-confirm
```

---

## 3) 如何启动每日增量同步

项目已有脚本：`chronos_finance/scripts/daily_incremental_sync.sh`。

该脚本特点：

- 不清表
- 基于各数据集游标做增量抓取
- 触发后异步执行（fire-and-forget）

### 3.1 手工执行一次

```bash
cd ~/github/ChronosFinance
bash chronos_finance/scripts/daily_incremental_sync.sh
```

### 3.2 每日自动执行（cron）

编辑 crontab：

```bash
crontab -e
```

示例（每天 22:10 执行，按服务器时区）：

```cron
10 22 * * * cd ~/github/ChronosFinance && bash chronos_finance/scripts/daily_incremental_sync.sh >> ~/github/ChronosFinance/chronos_finance/daily_incremental.log 2>&1
```

查看日志：

```bash
tail -f ~/github/ChronosFinance/chronos_finance/daily_incremental.log
```

---

## 4) 每 4 小时检查一次有没有增量（并按 cadence 触发）

推荐使用项目自带调度器：`chronos_finance/scripts/ingest_scheduler.sh`。  
该脚本会读取数据集 cadence 与本地状态文件，只触发“到时间”的增量任务，天然适合“每 4 小时跑一次看看有没有增量”。

### 4.1 先手工验证

```bash
cd ~/github/ChronosFinance
bash chronos_finance/scripts/ingest_scheduler.sh
```

若只想看哪些数据集到点，不实际触发：

```bash
cd ~/github/ChronosFinance
INGEST_SCHED_DRY_RUN=1 bash chronos_finance/scripts/ingest_scheduler.sh
```

### 4.2 配置 cron（每 4 小时）

编辑 crontab：

```bash
crontab -e
```

加入：

```cron
0 */4 * * * cd ~/github/ChronosFinance && bash chronos_finance/scripts/ingest_scheduler.sh >> ~/github/ChronosFinance/chronos_finance/ingest_scheduler.log 2>&1
```

查看日志：

```bash
tail -f ~/github/ChronosFinance/chronos_finance/ingest_scheduler.log
```

---

## 5) 建议的服务器最小配置（可直接用）

如果你希望“每日固定 + 每 4 小时检查”同时存在，建议 crontab 配置如下：

```cron
# 每天晚间跑一次增量
10 22 * * * cd ~/github/ChronosFinance && bash chronos_finance/scripts/daily_incremental_sync.sh >> ~/github/ChronosFinance/chronos_finance/daily_incremental.log 2>&1

# 每 4 小时检查 cadence 到点的数据集
0 */4 * * * cd ~/github/ChronosFinance && bash chronos_finance/scripts/ingest_scheduler.sh >> ~/github/ChronosFinance/chronos_finance/ingest_scheduler.log 2>&1
```

> 两者并存是安全的：增量任务是幂等 upsert 设计，调度器本身也有状态控制。

如果你还要每天自动备份到 R2（固定文件名，仅变更才覆盖），再加一条：

```cron
20 22 * * * cd ~/github/ChronosFinance && bash scripts/backup_to_r2_latest.sh >> ~/github/ChronosFinance/backups/backup_to_r2.log 2>&1
```

---

## 6) 常用排错命令

```bash
docker compose ps
docker compose logs --since=10m api-write
docker compose logs --since=10m api-read
curl -s "http://localhost:8004/api/v1/ingest/runs?limit=50" | python3 -m json.tool
curl -s "http://localhost:8003/api/v1/stats/sync-progress" | python3 -m json.tool
```

