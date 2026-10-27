# dsh-memory-journal

[English](README.md) | [中文](README.zh.md)

Lightweight journal-style long-term memory for DeepSeek Harness. Every
conversation automatically carries `SOUL.md` (persona), `USER.md`
(preferences), `MEMORY.md` (long-term facts), and today's diary. The model
is nudged to write tonight's diary and promote anything worth keeping into
`MEMORY.md`, and to write a weekly journal reviewing that week's diaries.
Explicit search/recall tools are only meant to be called when the user
clearly says "remember" or "recall" something.

Not an official DeepSeek plugin; inclusion/use implies no endorsement or
support commitment.

## Two packages

DeepSeek Harness's plugin system requires forced system-prompt injection and
host-side web UI to run in-process (Cordis's `ctx.systemPrompt`,
`ctx.webServer`), while model-callable recall/write tools can be wired in
through the language-agnostic MCP protocol instead. So:

- **[js-shell/](js-shell)** — a thin Cordis plugin. Seeds and injects
  `SOUL.md`/`USER.md`/`MEMORY.md`/today's diary into every system prompt,
  and exposes a loopback-only HTTP API to view/edit them.
- **[py-mcp/](py-mcp)** — a standalone Python MCP server exposing
  `memory_search`/`memory_get`/`memory_write`/`memory_weeks_missing_journal`,
  wired in through DSH's generic `@deepseek-ai/dsh-mcp-client` bridge. No
  Cordis/JS code.

Both share one on-disk directory (default `~/.dsh-memory-journal/`) and
don't depend on each other's runtime.

## Storage layout

```
~/.dsh-memory-journal/
├─ SOUL.md                      # persona — seeded with a real starting persona
├─ USER.md                      # user preferences — seeded with a skeleton
├─ MEMORY.md                    # long-term facts — seeded with a skeleton
└─ memory/
   ├─ 2026-10/2026-10-27.md     # tonight's diary
   └─ weekly/2026-W43.md        # weekly journal
```

All plain Markdown — open and edit directly. `SOUL.md`/`USER.md`/`MEMORY.md`
are created with starter content the moment the plugin is mounted, not
lazily. `SOUL.md`'s default persona is adapted from the
[dsh-persona-dafeiyu](https://github.com/huaizhuanghub/dsh-persona-dafeiyu)
plugin (MIT License).

## Install

```sh
cd js-shell && npm install -g dsh-memory-journal   # or: npm link
cd py-mcp && pip install dsh-memory-journal          # or: pip install -e .
```

Then enable it via [`examples/dsh-memory-journal.cordis.yml`](examples/dsh-memory-journal.cordis.yml):

```sh
dsh web --patch "$PWD/examples/dsh-memory-journal.cordis.yml"
```

`enabled: false` by default — turn it on per workspace/session. Both
packages must point at the same directory: js-shell's `dataDir` config field
and py-mcp's `DSH_MEMORY_JOURNAL_DATA_DIR` env var (both default to
`~/.dsh-memory-journal` when unset).

## Known limitations

- Nightly diary / weekly journal nudges are reactive, not a real scheduler —
  they only fire the next time someone talks to it.
- User-edit detection only covers edits made through js-shell's own HTTP
  API, not direct file edits.
- No settings-page UI yet, only the raw HTTP API.
- No multi-contact isolation — everyone sharing a DSH instance shares the
  same memory, by design.
- `MEMORY.md` is never auto-pruned; only the injected copy is truncated.

See [`js-shell/README.md`](js-shell/README.md) and
[`py-mcp/README.md`](py-mcp/README.md) for package-level detail.

## License

MIT
