"""MCP server exposing explicit memory recall/write/journal tools.

Day-to-day context (SOUL.md/USER.md/MEMORY.md/today's diary on every turn) is
handled by the companion js-shell Cordis plugin, not here. These tools are
for the model to call only when the user explicitly asks to remember or
recall something, or when writing tonight's diary/promoting facts into
MEMORY.md/writing a weekly journal — see each tool's docstring, which is what
the model actually reads.
"""
from __future__ import annotations

from functools import lru_cache

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from .store import MemoryStore

mcp = MCPServer("dsh-memory-journal")


@lru_cache(maxsize=1)
def _store() -> MemoryStore:
    """Opens the store on first tool call, so importing this module — which the
    MCP bridge does at every DSH boot — never creates or seeds a data directory."""
    return MemoryStore()


@mcp.tool()
def memory_search(query: str) -> list[dict]:
    """在 MEMORY.md 和所有日记（memory/YYYY-MM/YYYY-MM-DD.md）里做不区分大小写的子串检索。

    仅当用户明确要求"回想"/"查一下之前"某件事时才调用；日常对话的长期记忆已经
    由 SOUL.md/USER.md/MEMORY.md/今天的日记自动带入上下文，不需要为每轮对话都
    调用本工具。

    返回命中的 {file, line, text} 列表。
    """
    return _store().search(query)


@mcp.tool()
def memory_get(target: str) -> str:
    """读取一个记忆文件的全文。

    target 取值：
    - "soul" / "user" / "memory"：对应 SOUL.md / USER.md / MEMORY.md
    - "daily"：今天的日记；"daily:YYYY-MM-DD"：指定日期的日记
    - "weekly"：本周的周记；"weekly:YYYY-Www"：指定 ISO 周（例如 "2026-W43"）

    target 写错时，工具会返回一条列出合法取值的错误信息。
    """
    try:
        return _store().get(target)
    except ValueError as error:
        raise ToolError(str(error)) from error


@mcp.tool()
def memory_write(target: str, content: str, mode: str = "append") -> dict:
    """写入一条记忆。

    调用时机：
    - 用户明确要求"记住"某事时，写入 target="memory"。
    - 每天晚上（如果还没写过今天的日记）：先用 memory_get(target="daily")
      确认还没写，再把今天发生的事写成日记追加到 target="daily"（格式见
      examples/diary.example.md），同时把其中值得长期记住的条目另外用
      target="memory" 追加一份——这两步是同一个晚上的流程，不要只做一半。
    - 每周（如果还没写过上周的周记）：先用 memory_get(target="weekly:YYYY-Www")
      读一遍该周每天的日记，再用 mode="replace" 写一份周记到
      target="weekly:YYYY-Www"。

    mode 为 "append"（默认，追加一行/一段）或 "replace"（整篇覆盖，通常用于
    写周记全文）。

    target 或 mode 写错时，工具会返回一条列出合法取值的错误信息。
    """
    try:
        _store().write(target, content, mode)
    except ValueError as error:
        raise ToolError(str(error)) from error
    return {"ok": True}


@mcp.tool()
def memory_weeks_missing_journal() -> list[str]:
    """列出哪些已经结束的 ISO 周（YYYY-Www）已经有日记但还没有周记，供决定是否要补一份。"""
    return _store().weeks_missing_journal()


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
