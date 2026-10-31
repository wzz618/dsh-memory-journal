"""Offline tests for the MCP tool wrappers — no real DSH runtime required."""

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from dsh_memory_journal import server


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    """Points the lazy store at a throwaway directory for every test. The
    directory must not exist yet, or the starter files are not seeded."""
    monkeypatch.setenv("DSH_MEMORY_JOURNAL_DATA_DIR", str(tmp_path / "data"))
    server._store.cache_clear()
    yield
    server._store.cache_clear()


def test_get_returns_seeded_soul() -> None:
    assert "大肥鱼" in server.memory_get("soul")


def test_get_unknown_target_reports_valid_targets() -> None:
    with pytest.raises(ToolError) as caught:
        server.memory_get("not-a-real-target")
    message = str(caught.value)
    assert "not-a-real-target" in message
    assert "daily:YYYY-MM-DD" in message


def test_get_invalid_calendar_date_names_the_target() -> None:
    with pytest.raises(ToolError) as caught:
        server.memory_get("daily:2026-13-40")
    assert "daily:2026-13-40" in str(caught.value)


def test_get_iso_week_out_of_range_names_the_target() -> None:
    with pytest.raises(ToolError) as caught:
        server.memory_get("weekly:2026-W99")
    assert "weekly:2026-W99" in str(caught.value)


def test_write_reports_unknown_mode() -> None:
    with pytest.raises(ToolError) as caught:
        server.memory_write("memory", "x", mode="bogus")
    assert "bogus" in str(caught.value)


def test_write_then_search_round_trip() -> None:
    assert server.memory_write("memory", "用户喜欢喝拿铁") == {"ok": True}
    hits = server.memory_search("拿铁")
    assert [hit["text"] for hit in hits] == ["用户喜欢喝拿铁"]


def test_write_daily_then_read_back() -> None:
    server.memory_write("daily", "今天做了 MCP 测试")
    assert server.memory_get("daily") == "今天做了 MCP 测试\n"


def test_no_directory_until_the_first_tool_call(tmp_path, monkeypatch) -> None:
    """Importing the module stays inert; the store opens on first use."""
    target = tmp_path / "untouched"
    monkeypatch.setenv("DSH_MEMORY_JOURNAL_DATA_DIR", str(target))
    server._store.cache_clear()
    assert not target.exists()
    assert server.memory_get("soul")
    assert (target / "SOUL.md").exists()
