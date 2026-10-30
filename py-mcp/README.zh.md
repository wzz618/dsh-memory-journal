# dsh-memory-journal（MCP server）

[English](README.md) | 中文

一个独立的 MCP server，给 dsh-memory-journal 插件提供显式的记忆工具：
`memory_search`、`memory_get`、`memory_write`、
`memory_weeks_missing_journal`。通过 DSH 通用的 `@deepseek-ai/dsh-mcp-client`
桥接接入，不含任何 Cordis/JS 代码。日常上下文自动注入由配套的
[js-shell](../js-shell) 负责，不在这里。

不是 DeepSeek 官方插件。

## 安装

```sh
pip install dsh-memory-journal
```

## 使用

只有用户明确要求"记住"/"回想"，或者要写今晚的日记/本周的周记时才该调用
这些工具——具体 `target` 取值（`soul`、`user`、`memory`、`daily`、
`daily:YYYY-MM-DD`、`weekly`、`weekly:YYYY-Www`）见每个工具自己的
docstring。

这个包和 js-shell 必须通过 `DSH_MEMORY_JOURNAL_DATA_DIR`（默认
`~/.dsh/storages/dsh-memory-journal`，在 `$DSH_HOME` 下）指向同一个目录。

完整图景见[仓库 README](../README.md)。

## License

MIT
