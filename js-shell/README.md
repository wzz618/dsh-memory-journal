# dsh-memory-journal (host plugin)

[English](README.md) | [中文](README.zh.md)

A thin Cordis plugin for DeepSeek Harness. Injects long-term memory
(`SOUL.md`, `USER.md`, `MEMORY.md`, today's diary) into every system prompt,
and exposes a loopback-only HTTP API to view/edit those files. Explicit
recall/write/journal tools live in the companion [py-mcp](../py-mcp) MCP
server, not here.

Not an official DeepSeek plugin.

## Install

```sh
npm install -g dsh-memory-journal
```

Enable it through an overlay, e.g. the repo's
[`examples/dsh-memory-journal.cordis.yml`](../examples/dsh-memory-journal.cordis.yml):

```sh
dsh web --patch "$PWD/examples/dsh-memory-journal.cordis.yml"
```

`enabled: true` only seeds `scopes.json`'s initial global default the
first time it's created (memory is on everywhere by default); after that,
injection is governed by `scopes.json` itself (see below), editable in
`cordis.patch.yml` or from the UI.

## What it does

- Seeds `SOUL.md`/`USER.md`/`MEMORY.md` with starter content as soon as the
  plugin is mounted.
- Injects them plus today's diary into the system prompt, ordered for
  prompt-cache stability (stable files first, the diary last).
- Resolves whether injection is actually on for a given turn from
  `scopes.json` — a small store this plugin owns (session overrides
  workspace overrides global), not Cordis config — keyed by the current
  agent's `session.header.id`/`.cwd`.
- Nudges the model, through the injected text, to write tonight's diary and
  this week's journal when missing — there is no real scheduler, this only
  fires on the next turn someone talks to it.
- Shows a 📓 status chip under the composer (`conversation.composer.dock`)
  with on/off toggles for global/workspace/session.
- Adds a "Memory" page to the Web client's Settings dialog
  (`settings.section`) for browsing every diary/weekly entry that exists
  (newest month/year expanded, a missing current day/week shown as a
  clickable placeholder) and `MEMORY.md`/`SOUL.md`/`USER.md`, with in-place
  view/edit toggling for every one of them.
- `GET /api/dsh-memory-journal/entries` lists every existing diary/weekly
  entry (date or ISO week label plus mtime), for the settings page's list.
- `GET`/`POST /api/dsh-memory-journal/file?target=<soul|user|memory|daily:YYYY-MM-DD|weekly:YYYY-Www>`
  reads or writes one file by the same target vocabulary py-mcp's
  `MemoryStore` uses. `POST` takes `{ target, content, expectedMtimeMs }`:
  `expectedMtimeMs` must be the mtime the caller last read for that target
  (or `null` for one that didn't exist yet) — a save is rejected with `409`
  if the file changed on disk since, instead of silently overwriting a
  concurrent write (e.g. from the MCP server).
- `POST /api/dsh-memory-journal/scope` (loopback only, same as above).

See the [repo README](../README.md) for the full picture, including the
companion MCP server and known limitations.

## License

MIT
