"""Base agent with tool use loop (ReAct pattern)."""

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any, AsyncIterator

from ai.core.sse import (
    error_event,
    message_end_event,
    message_start_event,
    text_delta_event,
    tool_result_event,
    tool_use_input_delta_event,
    tool_use_start_event,
)
from ai.llm.base import Message, ToolCall
from ai.llm import get_llm_provider
from ai.tools import get_tool_registry


def _build_system_prompt() -> str:
    today = date.today().isoformat()
    return f"""You are Chronos, an AI financial analyst assistant for ChronosFinance.

Today's date: {today}

You have access to financial data for US stocks including:
- Historical prices (OHLCV)
- Financial statements (income, balance sheet, cash flow)
- Earnings calendar and EPS estimates
- Insider trading activity
- Analyst price targets and estimates
- SEC filings (10-K, 10-Q, 8-K)
- Dividend and split history
- Market capitalization history
- DCF valuation models
- Macroeconomic indicators (treasury rates, CPI, GDP)
- Sector performance data

Important notes:
- Data may be delayed 1-2 days from real-time
- Always use tools to fetch actual data rather than relying on your training data
- Respond in the same language as the user (Chinese or English)
- When analyzing financials, consider trends over multiple periods
- Clearly state data limitations and uncertainties
- Be concise but thorough. Format numbers nicely (use K/M/B for large numbers, % for percentages)
"""


class Agent:
    """Base agent with tool use capabilities."""

    def __init__(self) -> None:
        self.llm = get_llm_provider()
        self.tools = get_tool_registry()
        self.max_iterations = 10

    async def run(self, messages: list[Message]) -> AsyncIterator[str]:
        """Run the agent with a conversation, yielding SSE events.

        This implements a ReAct-style loop:
        1. Send user message to LLM
        2. If LLM responds with tool calls, execute them and continue
        3. If LLM responds with text, stream it and finish
        """
        message_id = f"msg_{uuid.uuid4().hex[:12]}"
        yield message_start_event(message_id)

        # Build tools list
        tools = self.tools.list_tools()
        llm_tools = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in tools
        ] if tools else None

        conversation = list(messages)  # Copy
        iteration = 0

        while iteration < self.max_iterations:
            iteration += 1

            # Accumulate response from LLM
            text_content = ""
            tool_calls: list[ToolCall] = []
            current_tool_input = ""
            current_tool_id: str | None = None
            current_tool_name: str | None = None

            try:
                async for chunk in self.llm.stream(
                    conversation,
                    tools=tools if llm_tools else None,
                    system_prompt=_build_system_prompt(),
                ):
                    if chunk.type == "text_delta" and chunk.text:
                        text_content += chunk.text
                        yield text_delta_event(chunk.text)

                    elif chunk.type == "tool_use_start":
                        current_tool_id = chunk.tool_id
                        current_tool_name = chunk.tool_name
                        current_tool_input = ""
                        if current_tool_id and current_tool_name:
                            yield tool_use_start_event(current_tool_id, current_tool_name)

                    elif chunk.type == "tool_use_input_delta" and chunk.tool_input_delta:
                        current_tool_input += chunk.tool_input_delta
                        if current_tool_id:
                            yield tool_use_input_delta_event(current_tool_id, chunk.tool_input_delta)

                    elif chunk.type == "message_end":
                        # Parse completed tool input
                        if current_tool_id and current_tool_name and current_tool_input:
                            try:
                                args = json.loads(current_tool_input)
                                tool_calls.append(ToolCall(
                                    id=current_tool_id,
                                    name=current_tool_name,
                                    input=args,
                                ))
                            except json.JSONDecodeError:
                                pass
                        # Reset
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_input = ""

            except Exception as e:
                yield error_event(f"LLM error: {e}")
                return

            # If there are tool calls, execute them and continue the loop
            if tool_calls:
                # Add assistant message with tool calls to conversation
                conversation.append(Message(
                    role="assistant",
                    content=text_content,
                    tool_calls=tool_calls,
                ))

                # Execute each tool call
                for tc in tool_calls:
                    result = await self.tools.execute(tc.name, tc.input)
                    yield tool_result_event(tc.id, result)

                    # Add tool result to conversation
                    conversation.append(Message(
                        role="tool",
                        content=json.dumps(result, ensure_ascii=False),
                        tool_call_id=tc.id,
                    ))

                # Continue loop for next LLM turn
                continue

            # No tool calls - we're done
            if text_content:
                # Add final assistant message to conversation
                conversation.append(Message(role="assistant", content=text_content))

            break

        yield message_end_event()


# Singleton
_agent: Agent | None = None


def get_agent() -> Agent:
    """Get the agent singleton."""
    global _agent
    if _agent is None:
        _agent = Agent()
    return _agent
