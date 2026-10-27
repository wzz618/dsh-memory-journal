"""Markdown-backed storage for dsh-memory-journal.

Layout under the resolved data directory:
    USER.md
    MEMORY.md
    DREAMS.md
    memory/YYYY-MM/YYYY-MM-DD.md
    memory/YYYY-MM/review.md

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

DREAM_ENTRY_MAX_CHARS = 200

_DAILY_TARGET = re.compile(r"daily:(\d{4})-(\d{2})-(\d{2})")
_REVIEW_TARGET = re.compile(r"review:(\d{4})-(\d{2})")


def resolve_data_dir() -> Path:
    override = os.environ.get("DSH_MEMORY_JOURNAL_DATA_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".dsh-memory-journal"


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


class MemoryStore:
    """Reads and writes the Markdown memory files for one data directory."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or resolve_data_dir()

    def _user_path(self) -> Path:
        return self.data_dir / "USER.md"

    def _memory_path(self) -> Path:
        return self.data_dir / "MEMORY.md"

    def _dreams_path(self) -> Path:
        return self.data_dir / "DREAMS.md"

    def _month_dir(self, year: int, month: int) -> Path:
        return self.data_dir / "memory" / f"{year:04d}-{month:02d}"

    def _daily_path(self, day: date) -> Path:
        return self._month_dir(day.year, day.month) / f"{day.isoformat()}.md"

    def _review_path(self, year: int, month: int) -> Path:
        return self._month_dir(year, month) / "review.md"

    def _resolve_target_path(self, target: str) -> Path:
        if target == "user":
            return self._user_path()
        if target == "memory":
            return self._memory_path()
        if target == "dreams":
            return self._dreams_path()
        if target == "daily":
            return self._daily_path(date.today())
        daily_match = _DAILY_TARGET.fullmatch(target)
        if daily_match:
            year, month, day = (int(part) for part in daily_match.groups())
            return self._daily_path(date(year, month, day))
        review_match = _REVIEW_TARGET.fullmatch(target)
        if review_match:
            year, month = (int(part) for part in review_match.groups())
            return self._review_path(year, month)
        raise ValueError(
            f"unknown memory target: {target!r} "
            "(expected one of: user, memory, dreams, daily, daily:YYYY-MM-DD, review:YYYY-MM)"
        )

    def get(self, target: str) -> str:
        return _read(self._resolve_target_path(target))

    def write(self, target: str, content: str, mode: str = "append") -> None:
        path = self._resolve_target_path(target)

        if target == "dreams":
            entry = content.strip()
            if len(entry) > DREAM_ENTRY_MAX_CHARS:
                raise ValueError(
                    f"dreams entry must be at most {DREAM_ENTRY_MAX_CHARS} characters, got {len(entry)}"
                )
            _append(path, f"- {date.today().isoformat()} {entry}")
            return

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

    def months_missing_review(self) -> list[str]:
        memory_root = self.data_dir / "memory"
        if not memory_root.is_dir():
            return []
        missing = []
        for month_dir in sorted(memory_root.iterdir()):
            if not month_dir.is_dir():
                continue
            has_daily_notes = any(p.name != "review.md" for p in month_dir.glob("*.md"))
            if has_daily_notes and not (month_dir / "review.md").exists():
                missing.append(month_dir.name)
        return missing
