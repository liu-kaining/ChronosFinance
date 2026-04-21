"""Tool definitions for the AI assistant."""

from __future__ import annotations

from typing import Any

from ai.llm.base import ToolDefinition


# Tool input schemas (JSON Schema format)

PRICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol (e.g., 'AAPL', 'MSFT')",
        },
        "limit": {
            "type": "integer",
            "description": "Number of recent price bars to return",
            "default": 30,
        },
    },
    "required": ["symbol"],
}

FINANCIALS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
        "category": {
            "type": "string",
            "enum": ["income_statement", "balance_sheet", "cash_flow_statement"],
            "description": "Type of financial statement",
        },
        "period": {
            "type": "string",
            "enum": ["annual", "quarter"],
            "default": "annual",
        },
        "limit": {
            "type": "integer",
            "default": 5,
        },
    },
    "required": ["symbol", "category"],
}

EARNINGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
        "limit": {
            "type": "integer",
            "default": 8,
        },
    },
    "required": ["symbol"],
}

INSIDER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
        "limit": {
            "type": "integer",
            "default": 20,
        },
    },
    "required": ["symbol"],
}

ANALYST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
        "limit": {
            "type": "integer",
            "default": 20,
        },
    },
    "required": ["symbol"],
}

SEC_FILINGS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
        "limit": {
            "type": "integer",
            "default": 20,
        },
    },
    "required": ["symbol"],
}

INVENTORY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Stock ticker symbol",
        },
    },
    "required": ["symbol"],
}

UNIVERSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol_prefix": {
            "type": "string",
            "description": "Prefix to filter symbols (e.g., 'AAP')",
        },
        "sector": {
            "type": "string",
            "description": "Filter by sector",
        },
        "limit": {
            "type": "integer",
            "default": 20,
        },
    },
    "required": [],
}

MACRO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "series_id": {
            "type": "string",
            "description": "Macro series ID (optional, returns all if not provided)",
        },
        "limit": {
            "type": "integer",
            "default": 100,
        },
    },
    "required": [],
}

COMPUTE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "expression": {
            "type": "string",
            "description": "Mathematical expression to evaluate (e.g., '100 * 1.05 ^ 10')",
        },
    },
    "required": ["expression"],
}


# Tool definitions

TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="get_price",
        description="Get historical daily price data (OHLCV) for a stock. Use this to analyze price trends, calculate returns, or check recent trading activity.",
        input_schema=PRICE_SCHEMA,
    ),
    ToolDefinition(
        name="get_financials",
        description="Get financial statement data (income statement, balance sheet, or cash flow). Use this to analyze profitability, leverage, liquidity, or cash flows.",
        input_schema=FINANCIALS_SCHEMA,
    ),
    ToolDefinition(
        name="get_earnings",
        description="Get earnings calendar data with EPS and revenue estimates vs actuals. Use this to analyze earnings surprises and trends.",
        input_schema=EARNINGS_SCHEMA,
    ),
    ToolDefinition(
        name="get_insider_trades",
        description="Get recent insider trading activity for a stock. Use this to see what company insiders are buying or selling.",
        input_schema=INSIDER_SCHEMA,
    ),
    ToolDefinition(
        name="get_analyst_estimates",
        description="Get analyst price targets and consensus estimates. Use this to understand Wall Street expectations.",
        input_schema=ANALYST_SCHEMA,
    ),
    ToolDefinition(
        name="get_sec_filings",
        description="Get SEC filing metadata (10-K, 10-Q, 8-K, etc.). Use this to find regulatory filings.",
        input_schema=SEC_FILINGS_SCHEMA,
    ),
    ToolDefinition(
        name="get_inventory",
        description="Get data inventory for a symbol - what data is available and its coverage. Use this to check data availability before analysis.",
        input_schema=INVENTORY_SCHEMA,
    ),
    ToolDefinition(
        name="search_symbols",
        description="Search for stock symbols by prefix or sector. Use this to find tickers matching certain criteria.",
        input_schema=UNIVERSE_SCHEMA,
    ),
    ToolDefinition(
        name="get_macro",
        description="Get macroeconomic series data (treasury yields, CPI, GDP, etc.). Use this for macro context.",
        input_schema=MACRO_SCHEMA,
    ),
    ToolDefinition(
        name="compute",
        description="Evaluate a mathematical expression. Use this for calculations like compound growth, ratios, or percentages.",
        input_schema=COMPUTE_SCHEMA,
    ),
]


def get_tool_by_name(name: str) -> ToolDefinition | None:
    """Get a tool definition by name."""
    for tool in TOOLS:
        if tool.name == name:
            return tool
    return None
