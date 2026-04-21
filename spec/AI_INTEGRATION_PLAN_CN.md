# ChronosFinance AI 能力接入方案 V1 (2026-04)

**目标**：给 ChronosFinance 平台接入专业的 AI 能力，覆盖助手、摘要、分析、研究四类场景，面向未来的 Agent 化预留架构。

---

## 0. 用户决策（已确认）

| 项 | 选择 |
|---|---|
| 部署位置 | **独立容器 `chronos_ai/`**（与 `chronos_finance` / `chronos_web` 平级） |
| LLM 模型 | **多模型可切换**（Claude / OpenAI 兼容 / 国产通过适配层统一） |
| 数据访问 | **Tool Calling + MCP Server 双轨**（内部用 Tool Calling，对外导出 MCP） |
| MVP 功能 | 4 项全做：右侧抽屉聊天 (Cmd+J) + 图表智能注释 ✨ + 单股研究报告 + 自然语言筛股 ⌘K |

---

## 1. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│                      chronos_web (React)                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐   │
│  │ Cmd+J Chat   │  │ ✨ Chart Ann. │  │ AI Research Tab  │   │
│  └──────┬───────┘  └───────┬───────┘  └────────┬─────────┘   │
│         └──────────────────┴───────────────────┘             │
│                          ↓ SSE                                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ↓ (nginx /api/ai/ proxy)
┌──────────────────────────────────────────────────────────────┐
│             chronos_ai  (FastAPI + LLM Gateway)               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  API Layer  /api/ai/chat, /annotate, /research, /screen│  │
│  └──────────────────────────┬─────────────────────────────┘  │
│  ┌──────────────────────────▼─────────────────────────────┐  │
│  │  Orchestrator / Agent Loop                              │  │
│  │  (system prompt + tool use + streaming)                 │  │
│  └─────┬───────────────────────────┬───────────────────────┘  │
│        │                           │                          │
│  ┌─────▼───────┐           ┌───────▼─────────┐                │
│  │ LLM Adapter │           │  Tool Registry  │                │
│  │  - Claude   │           │  (JSON schema + │                │
│  │  - OpenAI   │           │   handler)      │                │
│  │  - DeepSeek │           └───────┬─────────┘                │
│  │  - Qwen     │                   │                          │
│  └─────────────┘                   │                          │
└────────────────────────────────────┼──────────────────────────┘
                                     │
                                     ↓  HTTP
┌──────────────────────────────────────────────────────────────┐
│                chronos_finance  (FastAPI, 现有)               │
│   /api/v1/data/*   /api/v1/library/*   /api/v1/data/macro/*  │
└──────────────────────────────────────────────────────────────┘

# 同时
┌──────────────────────────────────────────────────────────────┐
│   MCP Server (python-mcp-sdk) 导出同一套 Tool Registry        │
│   stdio 或 SSE transport                                      │
│   供 Claude Desktop / Cursor / 其他 MCP 客户端直连            │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：
1. **Tool Registry 是单一数据源**：一份工具定义同时喂给内部 LLM 和外部 MCP
2. **chronos_ai 不直接读数据库**，只通过 HTTP 调 chronos_finance，保持权责单一
3. **LLM Adapter 薄薄一层**，业务代码与模型厂商解耦
4. **SSE 流式是标配**，所有对话接口都要流式

---

## 2. 目录结构

```
chronos_ai/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
├── app/
│   ├── main.py                     # FastAPI 入口 + SSE + CORS
│   ├── core/
│   │   ├── config.py               # pydantic-settings
│   │   ├── logging.py
│   │   └── sse.py                  # SSE 事件格式封装
│   │
│   ├── llm/                        # 🔑 LLM 适配层
│   │   ├── __init__.py
│   │   ├── base.py                 # LLMProvider ABC, Message, ToolCall, Event
│   │   ├── types.py                # ChatRequest / StreamEvent 统一类型
│   │   ├── anthropic_provider.py   # Claude
│   │   ├── openai_provider.py      # OpenAI / DeepSeek / Kimi / OpenAI-compat
│   │   ├── dashscope_provider.py   # 通义千问
│   │   ├── zhipu_provider.py       # 智谱 GLM
│   │   └── factory.py              # provider_from_env() 工厂
│   │
│   ├── tools/                      # 🔑 工具注册表（同时给 LLM + MCP 用）
│   │   ├── __init__.py             # auto-register, list_tools(), call_tool()
│   │   ├── registry.py             # Tool dataclass + 注册装饰器
│   │   ├── universe_tools.py       # search_universe / get_inventory
│   │   ├── price_tools.py          # get_prices / get_latest_price
│   │   ├── financial_tools.py      # get_financials / compare_peers
│   │   ├── event_tools.py          # get_events / get_insider
│   │   ├── macro_tools.py          # get_macro_series / treasury_curve
│   │   ├── analyst_tools.py        # get_analyst_estimates
│   │   ├── sec_tools.py            # get_sec_filing_outline
│   │   └── compute_tools.py        # 纯计算：MA/RSI/correlation/growth_rate
│   │
│   ├── agents/                     # 高层编排
│   │   ├── base.py                 # AgentRunner: 循环 tool_use 直到完成
│   │   ├── chat_agent.py           # 通用对话
│   │   ├── annotator.py            # 图表注释（单轮，结构化输出）
│   │   ├── researcher.py           # 单股研究报告（多步，分段流式）
│   │   └── screener.py             # 自然语言筛股
│   │
│   ├── prompts/                    # 提示词集中管理
│   │   ├── base_system.py          # 通用系统提示词
│   │   ├── chart_annotator.py      # 图表注释提示词
│   │   ├── researcher.py           # 研究报告大纲提示词
│   │   └── screener.py             # 筛股提示词
│   │
│   ├── api/                        # HTTP 接口
│   │   ├── chat.py                 # POST /api/ai/chat   (SSE)
│   │   ├── annotate.py             # POST /api/ai/annotate  (SSE or sync)
│   │   ├── research.py             # POST /api/ai/research  (SSE, 长任务)
│   │   ├── screen.py               # POST /api/ai/screen    (SSE)
│   │   └── models.py               # GET /api/ai/models  可用模型列表
│   │
│   ├── services/
│   │   ├── chronos_client.py       # httpx 封装 chronos_finance 调用
│   │   ├── cache.py                # 工具结果缓存（内存或 Redis）
│   │   └── rate_limit.py           # 按用户/IP 限流（预埋）
│   │
│   ├── observability/
│   │   └── ai_runs.py              # 记录每次 LLM 调用（prompt/tokens/cost）
│   │
│   └── mcp/                        # 🔑 MCP Server 导出
│       ├── server.py               # 把 tools/ 注册表包装成 MCP Server
│       └── __main__.py             # python -m app.mcp  运行 stdio MCP
│
└── tests/
```

---

## 3. Tool Registry 设计（核心）

### 3.1 统一 Tool 定义

```python
# chronos_ai/app/tools/registry.py
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

@dataclass(frozen=True)
class Tool:
    name: str                          # 全局唯一，snake_case
    description: str                   # 给 LLM 看的，中英文都行但英文准确性高
    input_schema: dict[str, Any]       # JSON Schema（符合 Claude / OpenAI / MCP 规范）
    handler: Callable[..., Awaitable[Any]]
    tags: list[str] = None             # 分组（price/financial/event/compute）
    cacheable: bool = True
    cache_ttl_seconds: int = 300

_REGISTRY: dict[str, Tool] = {}

def register_tool(tool: Tool) -> None:
    _REGISTRY[tool.name] = tool

def list_tools(tags: list[str] | None = None) -> list[Tool]:
    if tags is None: return list(_REGISTRY.values())
    return [t for t in _REGISTRY.values() if t.tags and set(tags) & set(t.tags)]

async def call_tool(name: str, arguments: dict) -> Any:
    tool = _REGISTRY.get(name)
    if not tool:
        raise KeyError(f"unknown tool: {name}")
    return await tool.handler(**arguments)
```

### 3.2 工具示例

```python
# chronos_ai/app/tools/financial_tools.py
from app.services.chronos_client import get_client
from .registry import Tool, register_tool

async def _get_financials(symbol: str, category: str, period: str = "annual", limit: int = 12):
    cli = get_client()
    return await cli.get(
        f"/api/v1/library/symbols/{symbol.upper()}/static",
        params={"category": category, "period": period, "limit": limit},
    )

register_tool(Tool(
    name="get_financials",
    description=(
        "Get annual or quarterly financial statements for a US-listed stock. "
        "Available categories: income_statement_annual, balance_sheet_annual, "
        "cash_flow_annual, metrics_annual, ratios_annual."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "Ticker like NVDA, AAPL"},
            "category": {
                "type": "string",
                "enum": [
                    "income_statement_annual", "balance_sheet_annual",
                    "cash_flow_annual", "metrics_annual", "ratios_annual",
                ],
            },
            "period": {"type": "string", "enum": ["annual", "quarter"], "default": "annual"},
            "limit": {"type": "integer", "default": 12, "maximum": 40},
        },
        "required": ["symbol", "category"],
    },
    handler=_get_financials,
    tags=["financial"],
    cacheable=True,
    cache_ttl_seconds=900,
))
```

### 3.3 MVP 工具清单（覆盖 4 个场景够用）

| 工具 | 说明 | 来源 API |
|---|---|---|
| `search_universe` | 按 sector/industry/market_cap/关键字筛选股票 | `/api/v1/data/universe` |
| `get_symbol_inventory` | 单股数据库覆盖情况 | `/api/v1/data/symbols/{s}/inventory` |
| `get_prices` | 日线 OHLCV | `/api/v1/library/symbols/{s}/prices` |
| `get_latest_price` | 最新价+涨跌（新后端端点） | 需新加 |
| `get_financials` | 财务报表 | `/api/v1/library/symbols/{s}/static` |
| `get_earnings` | 财报日历 | `/api/v1/library/symbols/{s}/earnings` |
| `get_corporate_actions` | 分红/拆股 | 同上 |
| `get_insider_trades` | 内幕交易 | 同上 |
| `get_analyst_estimates` | 分析师预期 | 同上 |
| `get_sec_filing_outline` | SEC 10-K 章节大纲 | 同上 + 只返顶层 keys |
| `get_macro_series` | 宏观序列 | `/api/v1/data/macro/series/{id}` |
| `get_treasury_curve` | 国债曲线 | 需新加 |
| `get_freshness` | 数据新鲜度 | `/api/v1/data/freshness/symbol/{s}` |
| `compute_ma` | 移动均线 | 纯计算 |
| `compute_rsi` | RSI | 纯计算 |
| `compute_returns` | 收益率（绝对/年化/超额） | 纯计算 |
| `compute_correlation` | 相关系数（两个 symbol 或 series） | 纯计算 |
| `compute_growth_rate` | 复合增长率 | 纯计算 |
| `compare_peers` | 多股 KPI 并排 | 组合调用 |

---

## 4. LLM 适配层设计

### 4.1 统一接口

```python
# chronos_ai/app/llm/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Literal

@dataclass
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict]        # 支持多模态 block
    tool_call_id: str | None = None  # role=tool 时用
    tool_calls: list[dict] | None = None  # role=assistant 时用

@dataclass
class StreamEvent:
    """统一的流式事件格式（灵感来自 Anthropic SDK）"""
    type: Literal[
        "message_start", "text_delta", "tool_use_start",
        "tool_use_input_delta", "tool_use_end",
        "message_end", "error"
    ]
    data: dict | str

class LLMProvider(ABC):
    @abstractmethod
    async def stream(
        self,
        messages: list[Message],
        system: str | None = None,
        tools: list[dict] | None = None,   # JSON schema list
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> AsyncIterator[StreamEvent]: ...

    @abstractmethod
    def tool_result_message(self, tool_call_id: str, result: Any) -> Message: ...
```

### 4.2 工厂

```python
# chronos_ai/app/llm/factory.py
from app.core.config import get_settings

def get_provider(name: str | None = None) -> LLMProvider:
    s = get_settings()
    name = name or s.LLM_PROVIDER  # env
    match name:
        case "anthropic": return AnthropicProvider(s.ANTHROPIC_API_KEY)
        case "openai":    return OpenAIProvider(s.OPENAI_API_KEY, s.OPENAI_BASE_URL)
        case "deepseek":  return OpenAIProvider(s.DEEPSEEK_API_KEY, "https://api.deepseek.com/v1")
        case "kimi":      return OpenAIProvider(s.KIMI_API_KEY, "https://api.moonshot.cn/v1")
        case "dashscope": return DashScopeProvider(s.DASHSCOPE_API_KEY)
        case "zhipu":     return ZhipuProvider(s.ZHIPU_API_KEY)
        case _: raise ValueError(f"unknown provider: {name}")
```

### 4.3 环境变量

```env
LLM_PROVIDER=anthropic          # 默认
LLM_MODEL=claude-opus-4-5-20251101
LLM_FALLBACK_PROVIDER=deepseek  # 可选，主失败时切备用

ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=https://api.anthropic.com

OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1

DEEPSEEK_API_KEY=...
DASHSCOPE_API_KEY=...
ZHIPU_API_KEY=...

# 可选：默认路由策略
LLM_ROUTE_SIMPLE=deepseek-chat   # 图表注释等短任务
LLM_ROUTE_HEAVY=claude-opus      # 研究报告等长任务
```

---

## 5. Agent 编排（Tool Use 循环）

```python
# chronos_ai/app/agents/base.py
async def run_with_tools(
    provider: LLMProvider,
    messages: list[Message],
    system: str,
    tools: list[Tool],
    max_turns: int = 8,
) -> AsyncIterator[StreamEvent]:
    """
    通用 ReAct 循环：
    1. 发送 messages + tools 给 LLM
    2. 若 LLM 要求 tool_use，执行并把 result 追加为 role=tool 消息
    3. 重复直到 LLM 输出 stop_reason=end_turn 或达 max_turns
    每一步的 text_delta / tool_use_start / tool_result 都 yield 给调用方
    """
    for turn in range(max_turns):
        tool_calls_buffer = []
        async for ev in provider.stream(
            messages, system=system,
            tools=[t.input_schema_for_provider() for t in tools],
        ):
            yield ev
            if ev.type == "tool_use_end":
                tool_calls_buffer.append(ev.data)
            if ev.type == "message_end" and ev.data.get("stop_reason") == "end_turn":
                return
        # 执行所有 tool calls
        for call in tool_calls_buffer:
            try:
                result = await call_tool(call["name"], call["arguments"])
                tool_msg = provider.tool_result_message(call["id"], result)
            except Exception as e:
                tool_msg = provider.tool_result_message(call["id"], {"error": str(e)})
            messages.append(tool_msg)
            yield StreamEvent("tool_result", {"id": call["id"], "result_preview": str(result)[:200]})
```

---

## 6. 四大 MVP 能力的实现方案

### 6.1 右侧抽屉全局聊天 (Cmd+J)

- **API**：`POST /api/ai/chat` (SSE)
- **入参**：`{ session_id, messages, context: { current_symbol, current_view } }`
- **系统提示词**：注入当前页面上下文（"用户正在查看 NVDA 的财务页，请默认以 NVDA 为主语"）
- **工具**：给全部工具（让 AI 自己决定调用哪个）
- **前端**：Cmd+J 召唤 `<ChatDrawer>` 组件（shadcn Sheet），支持 markdown 渲染、代码块、表格、链接可点击跳转页面

### 6.2 图表智能注释 ✨

- **API**：`POST /api/ai/annotate` (短任务，SSE 或同步)
- **入参**：`{ chart_type: "price|financials|events|analyst", symbol, series_summary: [...] }`
- 前端把**当前图表渲染用的数据**直接打包发过去（省掉 AI 重新拉数据）
- **系统提示词**：要求 1-3 句、专业口吻、包含一个关键数字
- **模型**：走便宜模型（DeepSeek / Claude Haiku），因为高频调用
- **前端**：每个 `<ChartCard>` 的 `actions` 区有 ✨ 图标，点击出现打字机动画

### 6.3 单股研究报告

- **API**：`POST /api/ai/research/{symbol}` (长任务，SSE 分段流)
- **流程**（Agent 多步）：
  1. 拉公司基础信息
  2. 拉 5 年财务关键数据
  3. 拉最近 8 个季度 earnings 实际 vs 预期
  4. 拉最近公司行为和内幕
  5. 拉分析师一致预期
  6. （可选）拉 peers 做对比
  7. 生成分段报告（公司概览 / 业绩趋势 / 风险 / 估值 / 结论）
- **前端**：单股页新 tab `AI Research`，点击 "Generate" 后流式渲染 markdown，完成后可"保存"为 `ai_reports` 表（预埋）
- **模型**：走强模型（Claude Opus / GPT-5）

### 6.4 自然语言筛股 ⌘K

- **API**：`POST /api/ai/screen` (SSE)
- **入参**：`{ query: "ROE>20% 的 AI 芯片股" }`
- **Agent 行为**：
  1. LLM 解析意图 → 产出结构化筛选条件
  2. 调 `search_universe` 获取候选集
  3. 对候选股调 `get_financials` 过滤 ROE
  4. 排序、取 top N、返回
- **前端**：⌘K 面板接入（cmdk 库），AI 模式开关，结果可直接点击跳转到单股页

---

## 7. MCP Server 并行导出

```python
# chronos_ai/app/mcp/server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from app.tools import list_tools, call_tool

app = Server("chronos-finance")

@app.list_tools()
async def list_mcp_tools():
    return [
        {"name": t.name, "description": t.description, "inputSchema": t.input_schema}
        for t in list_tools()
    ]

@app.call_tool()
async def mcp_call_tool(name: str, arguments: dict):
    result = await call_tool(name, arguments)
    return [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]

if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(app))
```

运行方式：
```bash
# 用户电脑的 Claude Desktop 配置
{
  "mcpServers": {
    "chronos-finance": {
      "command": "python",
      "args": ["-m", "app.mcp"],
      "env": {"CHRONOS_API_URL": "http://localhost:8000"}
    }
  }
}
```

这样用户在 Claude Desktop / Cursor 里就能说 "查一下 NVDA 最新 ROE 和同行比如何"。

---

## 8. 数据模型（AI 元数据，可选）

在 `chronos_finance` 新增两张表（或在 `chronos_ai` 自己的 Redis 里）：

```sql
-- AI 会话
CREATE TABLE ai_sessions (
  id UUID PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI 消息
CREATE TABLE ai_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES ai_sessions(id),
  role TEXT,
  content JSONB,       -- 包含 text 或 tool_use 块
  tokens_in INT,
  tokens_out INT,
  model TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI 研究报告（持久化）
CREATE TABLE ai_reports (
  id UUID PRIMARY KEY,
  symbol TEXT,
  model TEXT,
  prompt_version TEXT,
  content_md TEXT,
  evidence JSONB,       -- 引用的 tool call 记录
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

MVP 阶段可以先只做内存/Redis 会话，暂不建表。

---

## 9. Docker 编排更新

`docker-compose.yml`:

```yaml
services:
  db: ...
  api:
    build: ./chronos_finance
    environment:
      - CORS_ALLOW_ORIGINS=http://localhost:3000,http://web,http://ai
    ports: ["8000:8000"]

  ai:
    build: ./chronos_ai
    ports: ["8100:8100"]
    depends_on: [api]
    environment:
      - CHRONOS_API_URL=http://api:8000
      - LLM_PROVIDER=anthropic
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}

  web:
    build: ./chronos_web
    ports: ["3000:80"]
    depends_on: [api, ai]
    # nginx.conf 内部：
    #   /api/      → http://api:8000
    #   /api/ai/   → http://ai:8100
```

---

## 10. 前端集成要点

### 10.1 通用 useAI Hook

```ts
// chronos_web/src/hooks/useAI.ts
export function useAIStream(endpoint: string) {
  const [content, setContent] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [done, setDone] = useState(false);
  const start = async (body: any) => {
    const res = await fetch(endpoint, {
      method: "POST", body: JSON.stringify(body),
      headers: {"Content-Type": "application/json"},
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // 解析 SSE: data: {"type":"text_delta","text":"..."}
    ...
  };
  return { content, toolCalls, done, start };
}
```

### 10.2 三个核心组件

- `<ChatDrawer />` — 右侧抽屉，shadcn Sheet + cmdk
- `<ChartAnnotation chart="price" symbol="NVDA" data={...} />` — 图表右上角 ✨
- `<AIResearchPanel symbol="NVDA" />` — 单股页的 tab

### 10.3 ⌘K 面板扩展

现有的 Cmd+K 搜索加一个"AI 模式"开关：普通模式按前缀搜 symbol，AI 模式输入自然语言调 `/api/ai/screen`。

---

## 11. 成本与可观测性

- **Token 统计**：每次 LLM 调用记录 `tokens_in/out` + 单价 → 日账单
- **工具调用缓存**：同 symbol 的 inventory 5 分钟不重复拉
- **模型路由**：默认配置让短任务（注释）走便宜模型
- **限流**（预埋）：IP / session 级，每小时 token 上限
- **日志**：`app/observability/ai_runs.py` 把每次调用链写到结构化日志

---

## 12. 实施里程碑（与前端升级合并）

| 阶段 | 内容 |
|---|---|
| M1 | 前端脚手架 + Docker 接入 + CORS（前端升级 M1） |
| M2 | 前端单股页核心（K 线、财务、事件、分析师） |
| **M2.5** | **chronos_ai 脚手架 + LLM 适配层 + 3 个最常用工具 + 最简 chat API** |
| M3 | 前端全局工作台 |
| **M3.5** | **图表注释 ✨ + 右侧抽屉聊天 Cmd+J（接入第 1 批工具 10 个）** |
| M4 | 前端辅助页 + Peers |
| **M4.5** | **单股研究报告 + 自然语言筛股 ⌘K（接入全部工具）** |
| M5 | **MCP Server 导出 + 会话持久化 + 成本监控面板** |

数字小数点（M2.5 等）表示 AI 功能插队进前端开发，保证前端每阶段交付后都能立刻体验到 AI。

---

## 附录 A：安全性

- **Prompt Injection 防护**：所有 tool 返回的数据不作为 system 指令拼接，永远作为 user / tool content 块
- **Tool 参数校验**：handler 层严格校验 symbol 格式、limit 上限，防止 LLM 构造恶意参数
- **SQL 不让 LLM 直接写**：所有数据访问都通过预定义工具
- **API Key 只在 chronos_ai 容器内**：前端永远看不到 LLM API Key
- **速率限制**：按 IP/Session 限制

## 附录 B：未来扩展

- **向量检索**：Postgres pgvector 扩展 + 新闻/10-K 段落 embedding，加 `semantic_search` 工具
- **自动生成的 Dashboard**：AI 根据用户问题动态生成图表配置（JSON）→ 前端渲染
- **Agent 规划器**：复杂任务先 plan 再 execute，可中断/恢复
- **用户历史偏好学习**：记住用户关注的股票、偏好的指标
- **Voice 交互**：录音 → Whisper → AI → TTS，做成"对话式终端"
- **自定义 Agent 工作流**：用户可拖拽工具节点构建自己的研究流程（Langflow 风）
