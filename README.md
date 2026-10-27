# dsh-memory-journal

日记式长期记忆，给 DeepSeek Harness 用。每次对话自动带上 `USER.md`/`MEMORY.md`，
日记按月归档，月底生成月度回顾和一条 200 字以内的 `DREAMS.md` 小结。只有用户
明确说"记住"/"回想"时，模型才会调用精确检索/写入工具。

这不是 DeepSeek 官方插件；收录/使用不代表任何认可或支持承诺。

## 为什么是两个包

DSH 的 Cordis 插件体系要求"强制注入 system prompt"和"宿主态 Web UI"必须跑在
Cordis 的 in-process JS 里（`ctx.systemPrompt`、`ctx.webServer`），而"模型主动
调用的检索/写入工具"可以通过语言无关的 MCP 协议接入（deepseek-harness 仓库的
`docs/user/guide/mcp-memory.md` 收录的 Memorix / MCP Reference Memory / Engram
都是这个路径）。所以：

- **`js-shell/`**：极薄的 Cordis 插件。只做两件事——把 `USER.md`+`MEMORY.md`
  强制注入每次对话的 system prompt，以及提供一个 loopback-only 的 HTTP API
  用来查看/编辑这几个记忆文件。
- **`py-mcp/`**：一个标准 MCP server（Python），暴露 `memory_search` /
  `memory_get` / `memory_write` / `memory_months_missing_review` 四个工具，
  通过 DSH 通用的 `@deepseek-ai/dsh-mcp-client` 桥接接入，没有写任何 JS/Cordis
  代码。

两边共享同一个磁盘目录（默认 `~/.dsh-memory-journal/`），互不依赖对方的运行时。

## 存储结构

```
~/.dsh-memory-journal/
├─ USER.md
├─ MEMORY.md
├─ DREAMS.md                 # 每条 ≤200 字，按月追加
└─ memory/
   └─ 2026-10/
      ├─ 2026-10-26.md
      └─ review.md           # 月度回顾，缺失时 js-shell 会在注入文本里提示模型去生成
```

全部是人可以直接打开看的纯 Markdown 文件，没有隐藏的索引/数据库。

## 安装

```sh
# js-shell：提供 Cordis 插件本体
cd js-shell && npm link   # 或 npm install -g dsh-memory-journal（发布后）

# py-mcp：提供 memory_search/memory_get/memory_write 等工具
cd py-mcp && pip install -e .   # 或 pip install dsh-memory-journal（发布后）
```

然后把 [`examples/dsh-memory-journal.cordis.yml`](examples/dsh-memory-journal.cordis.yml)
传给 DSH：

```sh
dsh web --patch "$PWD/examples/dsh-memory-journal.cordis.yml"
```

要长期生效，把其中的两条 `insert` 合并进 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
或 `$DSH_HOME/cordis.patch.yml`。

**默认 `enabled: false`。** 装完之后必须显式对你要用的那个 workspace/会话打开，
否则看起来就是"完全没生效"——这是故意的，本插件不会对任何特定上游插件（比如
某个 IM 接入插件）做特殊判断，参见下面「已知限制」。

两个包的 `dataDir` 必须指向同一个目录：js-shell 用 config 字段 `dataDir`（留空
则用 `~/.dsh-memory-journal`），py-mcp 只认环境变量 `DSH_MEMORY_JOURNAL_DATA_DIR`
（同样留空则用 `~/.dsh-memory-journal`）。只要都不覆盖，两边默认就是一致的；
一旦要覆盖，两边都要改成同一个路径。

## Config（js-shell，参见 [`examples/config.example.yml`](examples/config.example.yml)）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `false` | 是否对当前作用域启用注入 |
| `order` | `0` | system prompt 段落顺序 |
| `injectionBudgetChars` | `4000` | 每次注入的字符预算；超出只截断注入副本，磁盘原文不变 |
| `dailyNotesLookbackDays` | `2` | 保留字段，当前版本尚未接入 |
| `dataDir` | `''` | 记忆目录，留空用默认路径 |

## 验证

1. 会话 A："记住我的验证用茶是 lapsang-\<随便写个后缀\>"，确认模型调用了
   `memory_write` 并返回成功。
2. 不复制上下文，新建会话 B："我的验证用茶是什么？查一下记忆。"，确认模型
   调用了 `memory_search` 并答对。
3. 打开任意会话，确认回复前已经读到了 `USER.md`/`MEMORY.md` 的内容（不需要
   显式要求"查记忆"）——这是 js-shell 强制注入的部分，和上面两步的"显式工具
   调用"是两条不同的路径。

## 已知限制

- **只检测"通过 js-shell 设置页/HTTP API 编辑"产生的用户改动。** 用户编辑
  后的提醒（"用户修改了 MEMORY.md"）靠 js-shell 自己的 `/api/.../file` 保存
  入口在内存里打标记实现，不落盘、不跨进程同步。如果用户直接用文本编辑器
  改磁盘上的 `.md` 文件，这条路径不会被检测到——故意不做，避免引入哈希/状态
  同步的复杂度。
- **没有设置页 UI。** `js-shell/lib/client.js` 目前是空壳；查看/编辑只能走
  loopback HTTP API（`GET`/`POST /api/dsh-memory-journal/file?name=MEMORY.md`）。
  要做真正的设置页，需要先研究 `@deepseek-ai/dsh-client-ui-renderer` 的真实
  注册 API。
- **不做多联系人隔离。** 所有调用方共享同一份 `USER.md`/`MEMORY.md`——这是
  确认过的设计取舍，不是疏漏。如果你的 DSH 实例通过某个 IM 插件桥接多个不同
  的人，他们会看到同一份记忆。
- **`MEMORY.md` 永不自动裁剪。** 照抄实际做法：磁盘原文只增不减，只有注入
  时的副本会按 `injectionBudgetChars` 截断（保留最新内容）。文件会无限增长，
  需要精简时只能手动编辑或让模型改写。
- **没有跨进程锁。** 模型通过 `memory_write` 写入和用户通过设置页 API 编辑
  可能同时发生；两边都用"临时文件+rename"原子写，不会损坏文件，但没有真正
  的冲突合并，后写的覆盖先写的。
- **`dailyNotesLookbackDays` 尚未接入。** 新会话目前不会自动多带最近几天的
  日记，只有 `USER.md`/`MEMORY.md` 会被注入。
- **兼容性矩阵尚未填写。** 还没有针对真实 DSH 发布版做过兼容性测试，
  `package.json` 里暂时没有 `dsh.compatibility.dshReleases` 表。发布前需要
  补上。

## 开发

```sh
cd js-shell && npm test   # 离线验证，不需要真实 dsh 运行时
cd py-mcp && pip install -e ".[dev]" && pytest -q
```

## License

MIT
