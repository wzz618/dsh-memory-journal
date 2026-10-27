# dsh-memory-journal

[English](README.md) | 中文

给 DeepSeek Harness 用的轻量日记式长期记忆。每次对话自动带上 `SOUL.md`
（人设）、`USER.md`（用户偏好）、`MEMORY.md`（长期记忆）和今天的日记。
模型会被提醒写今晚的日记、把值得记住的内容晋升进 `MEMORY.md`，并每周写
一篇周记回顾当周的日记。显式的检索/回想工具只在用户明确说"记住"/"回想"
时才该调用。

不是 DeepSeek 官方插件；收录/使用不代表任何认可或支持承诺。

## 为什么是两个包

DSH 的插件体系要求"强制注入 system prompt"和"宿主态 Web UI"必须跑在
Cordis 的 in-process 里（`ctx.systemPrompt`、`ctx.webServer`），而"模型
主动调用的检索/写入工具"可以通过语言无关的 MCP 协议接入。所以：

- **[js-shell/](js-shell)**：极薄的 Cordis 插件。生成并注入
  `SOUL.md`/`USER.md`/`MEMORY.md`/今天的日记，提供 loopback-only 的 HTTP
  API 查看/编辑。
- **[py-mcp/](py-mcp)**：独立的 Python MCP server，暴露
  `memory_search`/`memory_get`/`memory_write`/`memory_weeks_missing_journal`，
  通过 DSH 通用的 `@deepseek-ai/dsh-mcp-client` 桥接接入，不含任何
  Cordis/JS 代码。

两边共享同一个磁盘目录（默认 `~/.dsh-memory-journal/`），互不依赖对方的
运行时。

## 存储结构

```
~/.dsh-memory-journal/
├─ SOUL.md                      # 人设——装完即生成真实的起始人设
├─ USER.md                      # 用户偏好——装完即生成骨架
├─ MEMORY.md                    # 长期记忆——装完即生成骨架
├─ scopes.json                  # 全局/工作区/会话各自的开关——插件自己管理，不是 Cordis config
└─ memory/
   ├─ 2026-10/2026-10-27.md     # 今晚的日记
   └─ weekly/2026-W43.md        # 周记
```

全部是纯 Markdown，可以直接打开编辑。`SOUL.md`/`USER.md`/`MEMORY.md` 在
插件挂载的那一刻就生成起始内容，不是等到第一次读取才惰性创建。`SOUL.md`
的默认人设改编自
[dsh-persona-dafeiyu](https://github.com/huaizhuanghub/dsh-persona-dafeiyu)
插件（MIT 协议）。

## 安装

```sh
cd js-shell && npm install -g dsh-memory-journal   # 或 npm link
cd py-mcp && pip install dsh-memory-journal          # 或 pip install -e .
```

然后通过 [`examples/dsh-memory-journal.cordis.yml`](examples/dsh-memory-journal.cordis.yml) 启用：

```sh
dsh web --patch "$PWD/examples/dsh-memory-journal.cordis.yml"
```

`enabled: false` 只在 `scopes.json` 第一次创建时用作全局默认值——此后
是否注入由 `scopes.json` 自己决定（会话 > 工作区 > 全局），不再看这个
静态字段。可以在输入框下方的状态条（📓）上切换，也可以直接
`POST /api/dsh-memory-journal/scope`。两个包必须指向同一个目录：
js-shell 的 `dataDir` config 字段和 py-mcp 的
`DSH_MEMORY_JOURNAL_DATA_DIR` 环境变量（都不设置时默认是
`~/.dsh-memory-journal`）。

## 已知限制

- 日记/周记的提醒是被动触发，不是真正的定时器——只在下次有人说话时才会
  检查。
- 用户编辑检测只覆盖通过 js-shell 自己的 HTTP API 做的编辑，不包括直接
  改磁盘文件。
- 还没有查看/编辑 SOUL.md/USER.md/MEMORY.md/日记的设置页，目前只有
  composer dock 的开关和裸的 HTTP API。
- 不做多联系人隔离——同一个 DSH 实例的所有人共享同一份记忆，这是故意的
  设计取舍。
- `MEMORY.md` 永不自动裁剪，只有注入的副本会被截断。
- composer dock 还没在真实浏览器里视觉验证过（这个环境没有 GUI）——请在
  真实的 `dsh web` 里确认一遍。

更详细的内容见 [`js-shell/README.zh.md`](js-shell/README.zh.md) 和
[`py-mcp/README.zh.md`](py-mcp/README.zh.md)。

## License

MIT
