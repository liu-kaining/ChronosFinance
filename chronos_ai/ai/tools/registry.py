"""Tool registry - executes tools by calling the Chronos Finance API."""

from __future__ import annotations

import json
import math
import re
from typing import Any

import httpx

from ai.core.config import settings

# Import tools
from .definitions import TOOLS, get_tool_by_name


class ToolRegistry:
    """Registry for executing tools via Chronos Finance API."""

    def __init__(self) -> None:
        self.base_url = settings.CHRONOS_API_BASE
        self.tools = {t.name: t for t in TOOLS}

    def list_tools(self):
        """Return all available tool definitions."""
        return list(self.tools.values())

    async def execute(self, name: str, arguments: dict[str, Any]) -> Any:
        """Execute a tool by name with given arguments.

        Args:
            name: Tool name (e.g., 'get_price')
            arguments: Tool input arguments

        Returns:
            Tool execution result (JSON-serializable)
        """
        if name not in self.tools:
            return {"error": f"Unknown tool: {name}"}

        try:
            if name == "get_price":
                return await self._get_price(**arguments)
            elif name == "get_financials":
                return await self._get_financials(**arguments)
            elif name == "get_earnings":
                return await self._get_earnings(**arguments)
            elif name == "get_insider_trades":
                return await self._get_insider(**arguments)
            elif name == "get_analyst_estimates":
                return await self._get_analyst(**arguments)
            elif name == "get_sec_filings":
                return await self._get_sec(**arguments)
            elif name == "get_inventory":
                return await self._get_inventory(**arguments)
            elif name == "search_symbols":
                return await self._search_symbols(**arguments)
            elif name == "get_macro":
                return await self._get_macro(**arguments)
            elif name == "compute":
                return await self._compute(**arguments)
            else:
                return {"error": f"Tool not implemented: {name}"}
        except Exception as e:
            return {"error": str(e)}

    async def _fetch(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """Fetch data from Chronos API."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{self.base_url}{path}"
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def _get_price(self, symbol: str, limit: int = 30) -> Any:
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/prices",
            {"limit": limit, "order": "desc"},
        )

    async def _get_financials(
        self,
        symbol: str,
        category: str,
        period: str = "annual",
        limit: int = 5,
    ) -> Any:
        # Category mapping
        category_map = {
            "income_statement": "income_statement_annual",
            "balance_sheet": "balance_sheet_annual",
            "cash_flow_statement": "cash_flow_statement_annual",
        }
        api_category = category_map.get(category, f"{category}_annual")
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/static",
            {"category": api_category, "period": period, "limit": limit},
        )

    async def _get_earnings(self, symbol: str, limit: int = 8) -> Any:
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/earnings",
            {"limit": limit},
        )

    async def _get_insider(self, symbol: str, limit: int = 20) -> Any:
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/insider",
            {"limit": limit},
        )

    async def _get_analyst(self, symbol: str, limit: int = 20) -> Any:
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/analyst-estimates",
            {"limit": limit},
        )

    async def _get_sec(self, symbol: str, limit: int = 20) -> Any:
        return await self._fetch(
            f"/api/v1/library/symbols/{symbol.upper()}/sec-filings",
            {"limit": limit},
        )

    async def _get_inventory(self, symbol: str) -> Any:
        return await self._fetch(
            f"/api/v1/data/symbols/{symbol.upper()}/inventory"
        )

    async def _search_symbols(
        self,
        symbol_prefix: str | None = None,
        sector: str | None = None,
        limit: int = 20,
    ) -> Any:
        params: dict[str, Any] = {"limit": limit}
        if symbol_prefix:
            params["symbol_prefix"] = symbol_prefix.upper()
        if sector:
            params["sector"] = sector
        return await self._fetch("/api/v1/data/universe", params)

    async def _get_macro(self, series_id: str | None = None, limit: int = 100) -> Any:
        if series_id:
            return await self._fetch(
                f"/api/v1/data/macro/series/{series_id}",
                {"limit": limit},
            )
        else:
            return await self._fetch("/api/v1/data/macro/series")

    async def _compute(self, expression: str) -> Any:
        """Safely evaluate a mathematical expression."""
        # Allow only safe characters
        if not re.match(r"^[\d\s+\-*/.()^%\w]+$", expression):
            return {"error": "Invalid expression - only numbers and operators allowed"}

        try:
            # Replace ^ with ** for exponentiation
            expr = expression.replace("^", "**")
            # Safe eval with limited namespace
            result = eval(expr, {"__builtins__": {}}, {"math": math})
            return {"expression": expression, "result": result}
        except Exception as e:
            return {"error": f"Failed to compute: {e}"}


# Singleton instance
_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Get the tool registry singleton."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry
