"""MCP server exposing explicit memory recall/write/review tools.

Day-to-day context (USER.md/MEMORY.md on every turn) is handled by the
companion js-shell Cordis plugin, not here. These tools are for the model to
call only when the user explicitly asks to remember or recall something, or
when generating a monthly review/DREAMS.md entry — see each tool's docstring,
which is what the model actually reads.
"""
from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .store import MemoryStore

mcp = MCPServer("dsh-memory-journal")
_store = MemoryStore()


@mcp.tool()
def memory_search(query: str) -> list[dict]:
    """在 MEMORY.md 和所有日记（memory/YYYY-MM/YYYY-MM-DD.md）里做不区分大小写的子串检索。

    仅当用户明确要求"回想"/"查一下之前"某件事时才调用；日常对话的长期记忆已经
    由 USER.md/MEMORY.md 自动带入上下文，不需要为每轮对话都调用本工具。

    返回命中的 {file, line, text} 列表。
    """
    return _store.search(query)


@mcp.tool()
def memory_get(target: str) -> str:
    """读取一个记忆文件的全文。

    target 取值：
    - "user" / "memory" / "dreams"：对应 USER.md / MEMORY.md / DREAMS.md
    - "daily"：今天的日记；"daily:YYYY-MM-DD"：指定日期的日记
    - "review:YYYY-MM"：指定月份的月度回顾
    """
    return _store.get(target)


@mcp.tool()
def memory_write(target: str, content: str, mode: str = "append") -> dict:
    """写入一条记忆。

    仅当用户明确要求"记住"某事，或在生成月度回顾/DREAMS.md 小结时调用。

    target 取值同 memory_get。mode 为 "append"（默认，追加一行/一段）或
    "replace"（整篇覆盖，通常用于写入月度回顾全文）。写入 target="dreams" 时，
    content 会被当作一条新的日记小结追加，超过 200 字会被拒绝（返回
    {"ok": false, "error": ...}，不会静默截断，请自行精简后重试）。
    """
    try:
        _store.write(target, content, mode)
        return {"ok": True}
    except ValueError as error:
        return {"ok": False, "error": str(error)}


@mcp.tool()
def memory_months_missing_review() -> list[str]:
    """列出哪些月份（YYYY-MM）已经有日记但还没有月度回顾，供决定是否要补一份。"""
    return _store.months_missing_review()


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
