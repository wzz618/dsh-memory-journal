"""Markdown-backed storage for dsh-memory-journal.

Layout under the resolved data directory:
    SOUL.md                       identity/persona
    USER.md                       stable user preferences
    MEMORY.md                     long-term facts promoted from daily diaries
    memory/YYYY-MM/YYYY-MM-DD.md  nightly diary
    memory/weekly/YYYY-Www.md     weekly journal reviewing that week's diaries

SOUL.md/USER.md/MEMORY.md are all seeded with starter content (see
templates/) as soon as a MemoryStore for a given directory is created, not
lazily on first read.

No hash/provenance bookkeeping lives here on purpose: distinguishing a
model-driven write from a user edit is the js-shell half's job (it owns the
only user-facing edit path, the settings-page HTTP endpoint, and can mark
that in memory at the point of the edit). This module only reads and writes
plain files.
"""
from __future__ import annotations

import os
import re
from datetime import date
from pathlib import Path

_DAILY_TARGET = re.compile(r"daily:(\d{4})-(\d{2})-(\d{2})")
_WEEKLY_TARGET = re.compile(r"weekly:(\d{4})-W(\d{2})")

# Seed content lives as real files under templates/ (not inline string
# literals), kept byte-identical to the js-shell package's copy — see
# README for why each package carries its own copy, and for the SOUL.md
# template's attribution (adapted from the dsh-persona-dafeiyu plugin, MIT
# License).
_TEMPLATES_DIR = Path(__file__).parent / "templates"
_SEEDED_FILES = ("SOUL.md", "USER.md", "MEMORY.md")


def resolve_data_dir() -> Path:
    override = os.environ.get("DSH_MEMORY_JOURNAL_DATA_DIR")
    if override and override.strip():
        return Path(override).expanduser()
    # Same "$DSH_HOME/storages/<plugin>" layout dsh-persona-dafeiyu uses for
    # its own data, so every DSH plugin's files sit together under one home.
    # A blank DSH_HOME counts as unset, matching @deepseek-ai/dsh-home-paths'
    # resolveDshHome in the host half.
    dsh_home = os.environ.get("DSH_HOME")
    home = Path(dsh_home).expanduser() if dsh_home and dsh_home.strip() else Path.home() / ".dsh"
    return home / "storages" / "dsh-memory-journal"


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _append(path: Path, line: str) -> None:
    existing = _read(path)
    sep = "" if not existing or existing.endswith("\n") else "\n"
    _write_atomic(path, f"{existing}{sep}{line.rstrip()}\n")


def _iso_week_label(iso_year: int, iso_week: int) -> str:
    return f"{iso_year:04d}-W{iso_week:02d}"


class MemoryStore:
    """Reads and writes the Markdown memory files for one data directory."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or resolve_data_dir()
        self._seed_files_if_missing()

    def _seed_files_if_missing(self) -> None:
        """Writes SOUL.md/USER.md/MEMORY.md with starter content as soon as
        this data directory is seen (not lazily on first read), reading each
        file's template from templates/<file> next to this module. Never
        overwrites a file that already exists."""
        for name in _SEEDED_FILES:
            path = self.data_dir / name
            if not path.exists():
                _write_atomic(path, (_TEMPLATES_DIR / name).read_text(encoding="utf-8"))

    def _soul_path(self) -> Path:
        return self.data_dir / "SOUL.md"

    def _user_path(self) -> Path:
        return self.data_dir / "USER.md"

    def _memory_path(self) -> Path:
        return self.data_dir / "MEMORY.md"

    def _month_dir(self, year: int, month: int) -> Path:
        return self.data_dir / "memory" / f"{year:04d}-{month:02d}"

    def _daily_path(self, day: date) -> Path:
        return self._month_dir(day.year, day.month) / f"{day.isoformat()}.md"

    def _weekly_path(self, iso_year: int, iso_week: int) -> Path:
        return self.data_dir / "memory" / "weekly" / f"{_iso_week_label(iso_year, iso_week)}.md"

    def _resolve_target_path(self, target: str) -> Path:
        if target == "soul":
            return self._soul_path()
        if target == "user":
            return self._user_path()
        if target == "memory":
            return self._memory_path()
        if target == "daily":
            return self._daily_path(date.today())
        daily_match = _DAILY_TARGET.fullmatch(target)
        if daily_match:
            year, month, day = (int(part) for part in daily_match.groups())
            try:
                selected = date(year, month, day)
            except ValueError as error:
                raise ValueError(f"invalid date in target {target!r}: {error}") from error
            return self._daily_path(selected)
        if target == "weekly":
            iso_year, iso_week, _ = date.today().isocalendar()
            return self._weekly_path(iso_year, iso_week)
        weekly_match = _WEEKLY_TARGET.fullmatch(target)
        if weekly_match:
            iso_year, iso_week = (int(part) for part in weekly_match.groups())
            if not 1 <= iso_week <= 53:
                raise ValueError(f"ISO week out of range in target {target!r}: expected W01-W53")
            return self._weekly_path(iso_year, iso_week)
        raise ValueError(
            f"unknown memory target: {target!r} "
            "(expected one of: soul, user, memory, daily, daily:YYYY-MM-DD, weekly, weekly:YYYY-Www)"
        )

    def get(self, target: str) -> str:
        return _read(self._resolve_target_path(target))

    def write(self, target: str, content: str, mode: str = "append") -> None:
        path = self._resolve_target_path(target)
        if mode == "append":
            _append(path, content)
        elif mode == "replace":
            _write_atomic(path, content)
        else:
            raise ValueError(f"unknown write mode: {mode!r} (expected 'append' or 'replace')")

    def search(self, query: str) -> list[dict]:
        needle = query.strip().lower()
        if not needle:
            return []
        results = []
        for path in self._searchable_files():
            text = _read(path)
            if not text:
                continue
            for lineno, line in enumerate(text.splitlines(), start=1):
                if needle in line.lower():
                    results.append({
                        "file": str(path.relative_to(self.data_dir)),
                        "line": lineno,
                        "text": line.strip(),
                    })
        return results

    def _searchable_files(self) -> list[Path]:
        files = [self._memory_path()]
        memory_root = self.data_dir / "memory"
        if memory_root.is_dir():
            files.extend(sorted(memory_root.glob("*/*.md")))
        return files

    def weeks_missing_journal(self) -> list[str]:
        """Lists completed ISO weeks (YYYY-Www) that have at least one daily
        diary entry but no weekly journal yet — excludes the current,
        still-in-progress week."""
        today = date.today()
        current_iso_year, current_iso_week, _ = today.isocalendar()
        missing = []
        seen_weeks: set[tuple[int, int]] = set()
        memory_root = self.data_dir / "memory"
        if not memory_root.is_dir():
            return []
        for month_dir in memory_root.glob("*-*"):
            for daily_file in month_dir.glob("*.md"):
                try:
                    day = date.fromisoformat(daily_file.stem)
                except ValueError:
                    continue
                iso_year, iso_week, _ = day.isocalendar()
                if (iso_year, iso_week) == (current_iso_year, current_iso_week):
                    continue
                seen_weeks.add((iso_year, iso_week))
        for iso_year, iso_week in sorted(seen_weeks):
            if not self._weekly_path(iso_year, iso_week).exists():
                missing.append(_iso_week_label(iso_year, iso_week))
        return missing
