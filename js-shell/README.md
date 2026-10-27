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

`enabled: false` by default — turn it on per workspace/session in your
`cordis.patch.yml`.

## What it does

- Seeds `SOUL.md`/`USER.md`/`MEMORY.md` with starter content as soon as the
  plugin is mounted.
- Injects them plus today's diary into the system prompt, ordered for
  prompt-cache stability (stable files first, the diary last).
- Nudges the model, through the injected text, to write tonight's diary and
  this week's journal when missing — there is no real scheduler, this only
  fires on the next turn someone talks to it.
- `GET`/`POST /api/dsh-memory-journal/file?name=<SOUL.md|USER.md|MEMORY.md>`
  (loopback only) to view/edit.

See the [repo README](../README.md) for the full picture, including the
companion MCP server and known limitations.

## License

MIT
