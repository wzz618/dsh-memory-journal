"""Offline tests for MemoryStore — no real MCP/dsh runtime required."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from dsh_memory_journal.store import MemoryStore


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    return MemoryStore(data_dir=tmp_path)


def test_seeds_all_three_files_on_first_use(store: MemoryStore) -> None:
    assert "大肥鱼" in store.get("soul")
    assert "用户档案" in store.get("user")
    assert "长期记忆" in store.get("memory")


def test_seed_never_overwrites_existing_content(tmp_path: Path) -> None:
    (tmp_path / "SOUL.md").write_text("已经有真实人设了", encoding="utf-8")
    store = MemoryStore(data_dir=tmp_path)
    assert store.get("soul") == "已经有真实人设了"
    # USER.md/MEMORY.md still get their own starter content independently.
    assert "用户档案" in store.get("user")


def test_write_and_get_memory_appends(store: MemoryStore) -> None:
    store.write("memory", "用户喜欢喝拿铁")
    store.write("memory", "用户的生日是 3 月 5 日")
    content = store.get("memory")
    assert "用户喜欢喝拿铁" in content
    assert "用户的生日是 3 月 5 日" in content


def test_write_replace_overwrites(store: MemoryStore) -> None:
    store.write("memory", "第一行")
    store.write("memory", "整体替换", mode="replace")
    assert store.get("memory").strip() == "整体替换"


def test_write_unknown_mode_rejected(store: MemoryStore) -> None:
    with pytest.raises(ValueError):
        store.write("memory", "x", mode="bogus")


def test_unknown_target_rejected(store: MemoryStore) -> None:
    with pytest.raises(ValueError):
        store.get("not-a-real-target")


def test_daily_note_uses_today(store: MemoryStore) -> None:
    store.write("daily", "今天学到了新东西")
    today = date.today().isoformat()
    month_dir = store.data_dir / "memory" / today[:7]
    assert (month_dir / f"{today}.md").exists()


def test_daily_note_explicit_date(store: MemoryStore) -> None:
    store.write("daily:2026-01-15", "补记一条")
    assert (store.data_dir / "memory" / "2026-01" / "2026-01-15.md").exists()
    assert "补记一条" in store.get("daily:2026-01-15")


def test_weekly_journal_current_week(store: MemoryStore) -> None:
    iso_year, iso_week, _ = date.today().isocalendar()
    store.write("weekly", "本周回顾", mode="replace")
    label = f"{iso_year:04d}-W{iso_week:02d}"
    assert (store.data_dir / "memory" / "weekly" / f"{label}.md").exists()
    assert store.get(f"weekly:{label}") == "本周回顾"


def test_search_finds_substring_case_insensitive(store: MemoryStore) -> None:
    store.write("memory", "用户喜欢 Lapsang 红茶")
    results = store.search("lapsang")
    assert len(results) == 1
    assert "Lapsang" in results[0]["text"]


def test_search_empty_query_returns_nothing(store: MemoryStore) -> None:
    store.write("memory", "some content")
    assert store.search("   ") == []


def test_weeks_missing_journal_excludes_current_week(store: MemoryStore) -> None:
    store.write("daily", "今天随便记一下")
    assert store.weeks_missing_journal() == []


def test_weeks_missing_journal_reports_completed_week(store: MemoryStore) -> None:
    last_week_day = date.today() - timedelta(days=14)
    store.write(f"daily:{last_week_day.isoformat()}", "两周前的某一天")
    iso_year, iso_week, _ = last_week_day.isocalendar()
    label = f"{iso_year:04d}-W{iso_week:02d}"

    assert label in store.weeks_missing_journal()

    store.write(f"weekly:{label}", "补写的周记", mode="replace")
    assert label not in store.weeks_missing_journal()
