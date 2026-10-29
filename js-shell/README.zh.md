# dsh-memory-journal（宿主插件）

[English](README.md) | 中文

给 DeepSeek Harness 用的轻量 Cordis 插件。把长期记忆（`SOUL.md`、
`USER.md`、`MEMORY.md`、今天的日记）自动注入每次对话的 system prompt，
并提供 loopback-only 的 HTTP API 查看/编辑这些文件。显式的记忆检索/
写入/日记工具由配套的 [py-mcp](../py-mcp) MCP server 提供，不在这里。

不是 DeepSeek 官方插件。

## 安装

```sh
npm install -g dsh-memory-journal
```

通过 overlay 启用，例如本仓库的
[`examples/dsh-memory-journal.cordis.yml`](../examples/dsh-memory-journal.cordis.yml)：

```sh
dsh web --patch "$PWD/examples/dsh-memory-journal.cordis.yml"
```

`enabled: true` 只在 `scopes.json` 第一次创建时用作全局默认值（默认到处
都是开的）；之后是否注入由 `scopes.json` 自己决定（见下），可以在
`cordis.patch.yml` 里改，也可以从 UI 上改。

## 它做什么

- 插件挂载时立即生成 `SOUL.md`/`USER.md`/`MEMORY.md` 的起始内容。
- 把这三个文件加上今天的日记注入 system prompt，顺序为 prompt 缓存稳定性
  设计（稳定的文件在前，日记放最后）。
- 按 `scopes.json`（插件自己维护的小型存储，会话 > 工作区 > 全局，不是
  Cordis config）解析这次请求是否真的要注入，取值依据是当前 agent 的
  `session.header.id`/`.cwd`。
- 日记/周记缺失时，通过注入文本提醒模型补上——没有真正的定时器，只在下次
  有人说话时才会被动触发。
- 在输入框下方显示一个 📓 状态条（`conversation.composer.dock`），可以
  切换全局/工作区/会话各自的开关。
- `GET`/`POST /api/dsh-memory-journal/file?name=<SOUL.md|USER.md|MEMORY.md>`
  和 `POST /api/dsh-memory-journal/scope`（仅限本机）。

完整图景（包括配套的 MCP server 和已知限制）见[仓库 README](../README.md)。

## License

MIT
