"""Offline tests for MemoryStore — no real MCP/dsh runtime required."""
from __future__ import annotations

import os
import threading
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

from dsh_memory_journal import store as store_module
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


def _legacy_home(tmp_path: Path, monkeypatch) -> Path:
    """Points Path.home() at a temp home holding a pre-0.1.0 data directory."""
    home = tmp_path / "home"
    legacy = home / ".dsh-memory-journal"
    (legacy / "memory" / "2026-10").mkdir(parents=True)
    (legacy / "SOUL.md").write_text("旧版本的人设", encoding="utf-8")
    (legacy / "memory" / "2026-10" / "2026-10-05.md").write_text("# 旧日记\n", encoding="utf-8")
    (legacy / ".write.lock").mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("DSH_MEMORY_JOURNAL_DATA_DIR", raising=False)
    monkeypatch.delenv("DSH_HOME", raising=False)
    return home


def test_migrates_the_legacy_default_directory(tmp_path: Path, monkeypatch) -> None:
    home = _legacy_home(tmp_path, monkeypatch)

    store = MemoryStore()

    assert store.data_dir == home / ".dsh" / "storages" / "dsh-memory-journal"
    assert store.get("soul") == "旧版本的人设"
    assert store.get("daily:2026-10-05") == "# 旧日记\n"
    assert not (store.data_dir / ".write.lock").exists(), "lock directories are not memory content"
    assert (home / ".dsh-memory-journal" / "SOUL.md").exists(), "the legacy directory stays intact"


def test_migration_never_overwrites_existing_files(tmp_path: Path, monkeypatch) -> None:
    home = _legacy_home(tmp_path, monkeypatch)
    target = home / ".dsh" / "storages" / "dsh-memory-journal"
    target.mkdir(parents=True)
    (target / "SOUL.md").write_text("新版本已经有的内容", encoding="utf-8")

    store = MemoryStore()

    assert store.get("soul") == "新版本已经有的内容"
    assert store.get("daily:2026-10-05") == "# 旧日记\n"


def test_explicit_data_dir_is_not_migrated(tmp_path: Path, monkeypatch) -> None:
    _legacy_home(tmp_path, monkeypatch)

    store = MemoryStore(data_dir=tmp_path / "explicit")

    assert "旧版本的人设" not in store.get("soul")


def test_env_override_is_not_migrated(tmp_path: Path, monkeypatch) -> None:
    _legacy_home(tmp_path, monkeypatch)
    override = tmp_path / "override"
    monkeypatch.setenv("DSH_MEMORY_JOURNAL_DATA_DIR", str(override))

    store = MemoryStore()

    assert store.data_dir == override.resolve()
    assert "旧版本的人设" not in store.get("soul")


def test_concurrent_appends_keep_every_line(store: MemoryStore) -> None:
    def worker(tag: str) -> None:
        for index in range(5):
            store.write("memory", f"{tag}-{index}")

    threads = [threading.Thread(target=worker, args=(f"t{number}",)) for number in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    content = store.get("memory")
    missing = [
        f"t{number}-{index}"
        for number in range(8)
        for index in range(5)
        if f"t{number}-{index}" not in content
    ]
    assert missing == []


def test_stale_write_lock_is_reclaimed(store: MemoryStore) -> None:
    lock = store.data_dir / ".write.lock"
    lock.mkdir()
    stale = time.time() - 60
    os.utime(lock, (stale, stale))

    store.write("memory", "仍然能写")

    assert "仍然能写" in store.get("memory")
    assert not lock.exists()


def test_busy_write_lock_reports_a_readable_error(store: MemoryStore, monkeypatch) -> None:
    monkeypatch.setattr(store_module, "_LOCK_WAIT_SECONDS", 0.05)
    (store.data_dir / ".write.lock").mkdir()

    with pytest.raises(TimeoutError) as caught:
        store.write("memory", "x")

    assert "请稍后重试" in str(caught.value)
