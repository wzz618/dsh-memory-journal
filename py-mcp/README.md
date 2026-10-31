# dsh-memory-journal (MCP server)

[English](README.md) | [中文](README.zh.md)

A standalone MCP server exposing explicit memory tools for the
dsh-memory-journal plugin: `memory_search`, `memory_get`, `memory_write`,
`memory_weeks_missing_journal`. Connects to DeepSeek Harness through the
generic `@deepseek-ai/dsh-mcp-client` bridge — no Cordis/JS code here.
Day-to-day context injection is handled by the companion
[js-shell](../js-shell) package, not here.

Not an official DeepSeek plugin.

## Install

```sh
pip install dsh-memory-journal
```

## Use

Call these tools only when the user explicitly asks to remember/recall
something, or when writing tonight's diary / this week's journal — each
tool's docstring documents the exact `target` values (`soul`, `user`,
`memory`, `daily`, `daily:YYYY-MM-DD`, `weekly`, `weekly:YYYY-Www`). A
malformed `target` or `mode` comes back as an error result naming the valid
values, so the model can retry without guessing. `mode="replace"` is accepted
only for `soul` and weekly journals — `user`, `memory`, and daily entries are
append-only, so a partial rewrite cannot silently drop the rest of the file.

This package and js-shell must point at the same data directory via
`DSH_MEMORY_JOURNAL_DATA_DIR` (default
`~/.dsh/storages/dsh-memory-journal`, under `$DSH_HOME`).

See the [repo README](../README.md) for the full picture.

## License

MIT
