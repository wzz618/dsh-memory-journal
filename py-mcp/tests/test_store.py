"""Offline tests for MemoryStore — no real MCP/dsh runtime required."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from dsh_memory_journal.store import MemoryStore


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    return MemoryStore(data_dir=tmp_path)


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


def test_dreams_entry_over_200_chars_rejected(store: MemoryStore) -> None:
    with pytest.raises(ValueError):
        store.write("dreams", "x" * 201)


def test_dreams_entry_accepts_200_chars(store: MemoryStore) -> None:
    store.write("dreams", "x" * 200)
    assert "x" * 200 in store.get("dreams")


def test_daily_note_uses_today(store: MemoryStore) -> None:
    store.write("daily", "今天学到了新东西")
    today = date.today().isoformat()
    month_dir = store.data_dir / "memory" / today[:7]
    assert (month_dir / f"{today}.md").exists()


def test_daily_note_explicit_date(store: MemoryStore) -> None:
    store.write("daily:2026-01-15", "补记一条")
    assert (store.data_dir / "memory" / "2026-01" / "2026-01-15.md").exists()
    assert "补记一条" in store.get("daily:2026-01-15")


def test_search_finds_substring_case_insensitive(store: MemoryStore) -> None:
    store.write("memory", "用户喜欢 Lapsang 红茶")
    results = store.search("lapsang")
    assert len(results) == 1
    assert "Lapsang" in results[0]["text"]


def test_search_empty_query_returns_nothing(store: MemoryStore) -> None:
    store.write("memory", "some content")
    assert store.search("   ") == []


def test_months_missing_review(store: MemoryStore) -> None:
    store.write("daily", "随便记一下")
    today = date.today()
    label = f"{today.year:04d}-{today.month:02d}"

    missing = store.months_missing_review()
    assert label in missing

    store.write(f"review:{label}", "本月回顾全文", mode="replace")
    assert store.months_missing_review() == []


def test_months_missing_review_ignores_empty_month_dir(store: MemoryStore) -> None:
    (store.data_dir / "memory" / "2026-02").mkdir(parents=True)
    assert store.months_missing_review() == []
