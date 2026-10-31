"""End-to-end tests that speak the real MCP protocol to the server over stdio.

Spawns `python -m dsh_memory_journal.server` as a child process and drives it
with the MCP client, so these cover the tool schema, the transport wiring, and
the text the model actually reads — not just the store functions.
"""

import asyncio
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
TIMEOUT_SECONDS = 30


def text_of(result) -> str:
    return "\n".join(getattr(block, "text", repr(block)) for block in result.content)


async def call_tools(data_dir: Path):
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "dsh_memory_journal.server"],
        env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(SRC_DIR), "DSH_MEMORY_JOURNAL_DATA_DIR": str(data_dir)},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), TIMEOUT_SECONDS)
            names = sorted(tool.name for tool in (await session.list_tools()).tools)
            assert names == [
                "memory_get",
                "memory_search",
                "memory_weeks_missing_journal",
                "memory_write",
            ]

            written = await session.call_tool(
                "memory_write", {"target": "memory", "content": "用户喜欢喝拿铁"}
            )
            assert written.is_error is False
            assert "ok" in text_of(written)

            found = await session.call_tool("memory_search", {"query": "拿铁"})
            assert found.is_error is False
            assert "用户喜欢喝拿铁" in text_of(found)

            soul = await session.call_tool("memory_get", {"target": "soul"})
            assert soul.is_error is False
            assert "大肥鱼" in text_of(soul)

            bad_target = await session.call_tool("memory_get", {"target": "nope"})
            assert bad_target.is_error is True
            assert "daily:YYYY-MM-DD" in text_of(bad_target)

            bad_week = await session.call_tool("memory_get", {"target": "weekly:2026-W99"})
            assert bad_week.is_error is True
            assert "weekly:2026-W99" in text_of(bad_week)

            bad_mode = await session.call_tool(
                "memory_write", {"target": "memory", "content": "x", "mode": "bogus"}
            )
            assert bad_mode.is_error is True
            assert "append" in text_of(bad_mode)


def test_server_over_stdio(tmp_path: Path) -> None:
    asyncio.run(call_tools(tmp_path))
