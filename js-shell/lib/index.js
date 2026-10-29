/**
 * dsh-memory-journal (js-shell): forces SOUL.md/USER.md/MEMORY.md and
 * today's diary into every system prompt assembly, and exposes a
 * loopback-only HTTP API for reading/editing the Markdown memory files.
 * Explicit recall/write/journal tools live in the companion py-mcp MCP
 * server, not here — this half only does what requires running inside the
 * Cordis process (systemPrompt injection, webServer).
 *
 * Injection order is deliberate for prompt-cache friendliness: SOUL.md (near
 * static) → USER.md (changes occasionally) → MEMORY.md (grows slowly) →
 * today's diary (changes most often, within a single day). The first three
 * are truncated from the tail (the kept head stays byte-identical as the
 * file grows, so a cached prefix survives); the diary is truncated from the
 * head instead, since it is already the last thing in the string and
 * keeping its most recent entries is more useful than keeping its oldest.
 *
 * Whether injection is actually on for a given turn is NOT read from the
 * static `config.enabled` after first run — it's resolved from scopes.json
 * (session overrides workspace overrides global), a small mutable store
 * this plugin owns itself, mirroring dsh-persona-dafeiyu's own
 * global/workspace/session persona scoping. `config.enabled` only seeds
 * scopes.json's initial global default the first time it's created.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SECTION_NAME = 'memory-journal:context'
const NUMBER_FIELDS = ['order', 'injectionBudgetChars', 'nightHour']
const TRACKED_FILES = ['SOUL.md', 'USER.md', 'MEMORY.md']

// Addressing used by the /file and /entries HTTP API, deliberately the same
// target vocabulary py-mcp's MemoryStore uses (soul/user/memory/daily:.../
// weekly:...) so the two halves of this plugin never drift into two
// different naming schemes for the same files.
const SIMPLE_TARGETS = { soul: 'SOUL.md', user: 'USER.md', memory: 'MEMORY.md' }

// Seed content lives as real files under templates/ (not inline string
// literals) so it can be opened and edited directly. SOUL.md's default
// persona text there is adapted from the dsh-persona-dafeiyu plugin (MIT
// License) — see README for attribution.
const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url))

const FALLBACK_CONFIG = {
  '~standard': {
    version: 1,
    vendor: 'dsh-memory-journal',
    validate(value) {
      const issues = []
      const config = {
        enabled: true,
        order: 0,
        injectionBudgetChars: 4000,
        nightHour: 21,
        dataDir: '',
      }
      const input = value && typeof value === 'object' ? value : {}
      if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean') issues.push({ message: 'enabled must be a boolean' })
        else config.enabled = input.enabled
      }
      for (const field of NUMBER_FIELDS) {
        if (input[field] !== undefined) {
          if (!Number.isFinite(input[field]) || input[field] < 0) {
            issues.push({ message: `${field} must be a non-negative number` })
          } else {
            config[field] = input[field]
          }
        }
      }
      if (input.dataDir !== undefined) {
        if (typeof input.dataDir !== 'string') issues.push({ message: 'dataDir must be a string' })
        else config.dataDir = input.dataDir
      }
      return issues.length > 0 ? { issues } : { value: config }
    },
  },
}

async function loadConfigSchema() {
  try {
    const loaded = await import('@deepseek-ai/schemastery')
    const z = loaded?.default ?? loaded
    if (typeof z?.object === 'function') {
      return z.object({
        enabled: z.boolean().default(true)
          .description('只在 scopes.json 第一次创建时用作全局默认值（默认开）；此后实际是否注入由 scopes.json（可通过设置页/composer dock 切换）决定，这个字段不再生效'),
        order: z.number().default(0)
          .description('system prompt 段落顺序'),
        injectionBudgetChars: z.number().default(4000)
          .description('SOUL.md/USER.md/MEMORY.md 各自独立的字符预算上限（不是三者总和）；超出时只截断注入副本的结尾，保留开头不变以维持缓存前缀稳定，磁盘原文不受影响'),
        nightHour: z.number().default(21)
          .description('几点（24 小时制，本机时区）之后视为"晚上"，用于提示模型今天的日记还没写'),
        dataDir: z.string().default('')
          .description('记忆文件目录，留空则使用 ~/.dsh-memory-journal 或 DSH_MEMORY_JOURNAL_DATA_DIR'),
      })
    }
  } catch {
    // @deepseek-ai/schemastery not resolvable in this host; fall back below.
  }
  return FALLBACK_CONFIG
}

export const name = 'dsh-memory-journal'
export const inject = ['systemPrompt']
export const Config = await loadConfigSchema()

export function resolveDataDir(config) {
  if (config.dataDir) return config.dataDir
  return process.env.DSH_MEMORY_JOURNAL_DATA_DIR || join(homedir(), '.dsh-memory-journal')
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** Returns the file's current mtime in milliseconds, or `null` if it does
 * not exist — used as the optimistic-concurrency token for the /file POST
 * endpoint (see targetPath/the webServer handler below). */
function statMtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

/** Creates SOUL.md/USER.md/MEMORY.md with starter content as soon as this
 * plugin is mounted (not lazily on first read) — so they show up in the
 * data directory, and through the /file API, right after install. Each
 * file's starter content is read from templates/<file> next to this
 * package, not embedded as a string literal. Never overwrites a file that
 * already exists. */
function seedFilesIfMissing(dataDir) {
  for (const file of TRACKED_FILES) {
    const path = join(dataDir, file)
    if (!existsSync(path)) writeFileAtomic(path, readFileSync(join(TEMPLATES_DIR, file), 'utf8'))
  }
}

function scopesPath(dataDir) {
  return join(dataDir, 'scopes.json')
}

function readScopes(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(scopesPath(dataDir), 'utf8'))
    return {
      global: typeof parsed.global === 'boolean' ? parsed.global : false,
      workspace: parsed.workspace && typeof parsed.workspace === 'object' ? parsed.workspace : {},
      session: parsed.session && typeof parsed.session === 'object' ? parsed.session : {},
    }
  } catch {
    return { global: false, workspace: {}, session: {} }
  }
}

function writeScopes(dataDir, scopes) {
  writeFileAtomic(scopesPath(dataDir), JSON.stringify(scopes, null, 2))
}

/** Creates scopes.json the first time this data directory is seen, seeded
 * from config.enabled as the initial global default. Never overwrites an
 * existing file — once scopes.json exists (including after any dock/API
 * toggle), the static cordis.yml `enabled` field is no longer consulted. */
function seedScopesIfMissing(dataDir, config) {
  if (!existsSync(scopesPath(dataDir))) {
    writeScopes(dataDir, { global: config.enabled, workspace: {}, session: {} })
  }
}

/**
 * Session overrides workspace overrides global — the same "finest wins"
 * three-tier resolution dsh-persona-dafeiyu uses for its own scoping,
 * applied here to "is memory injection on" instead of "which persona".
 * `sessionId`/`cwd` come from the running agent's session header (see
 * buildContextText), not from anything this plugin tracks itself.
 */
export function resolveEnabled(scopes, { sessionId, cwd }) {
  if (sessionId !== undefined && Object.hasOwn(scopes.session, sessionId)) {
    return { enabled: scopes.session[sessionId], level: 'session' }
  }
  if (cwd !== undefined && Object.hasOwn(scopes.workspace, cwd)) {
    return { enabled: scopes.workspace[cwd], level: 'workspace' }
  }
  return { enabled: scopes.global, level: 'global' }
}

/** Local-calendar YYYY-MM-DD, used consistently for the daily file path, the
 * `daily:...` target address, and the /entries listing — never mixed with
 * UTC getters. */
export function isoDate(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthDir(dataDir, year, month) {
  return join(dataDir, 'memory', `${year}-${String(month).padStart(2, '0')}`)
}

function dailyPath(dataDir, date) {
  return join(monthDir(dataDir, date.getFullYear(), date.getMonth() + 1), `${isoDate(date)}.md`)
}

// ISO 8601 week helpers. Everything here stays in local-calendar time
// (Date's local getters/setters) end to end — never mixed with UTC getters —
// so this agrees with dailyPath's local getFullYear/getMonth/getDate. Using
// setDate() for day arithmetic (not raw millisecond offsets) keeps it
// correct across DST transitions.
function addDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}

export function isoWeekInfo(date) {
  const d = addDays(date, 0)
  const dayNum = (d.getDay() + 6) % 7 // Monday=0..Sunday=6
  d.setDate(d.getDate() - dayNum + 3) // Thursday of this ISO week
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const firstDayNum = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
  const isoWeek = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000))
  return { isoYear: d.getFullYear(), isoWeek }
}

export function previousIsoWeek(date) {
  return isoWeekInfo(addDays(date, -7))
}

function mondayOfIsoWeek(isoYear, isoWeek) {
  const simple = new Date(isoYear, 0, 1 + (isoWeek - 1) * 7)
  const dayOfWeek = simple.getDay() || 7 // Sunday=0 -> 7
  simple.setDate(simple.getDate() - dayOfWeek + 1)
  return simple
}

function weeklyLabel(isoYear, isoWeek) {
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`
}

function weeklyPath(dataDir, isoYear, isoWeek) {
  return join(dataDir, 'memory', 'weekly', `${weeklyLabel(isoYear, isoWeek)}.md`)
}

function anyDailyNoteExistsInIsoWeek(dataDir, isoYear, isoWeek) {
  const monday = mondayOfIsoWeek(isoYear, isoWeek)
  for (let offset = 0; offset < 7; offset += 1) {
    if (existsSync(dailyPath(dataDir, addDays(monday, offset)))) return true
  }
  return false
}

/** Resolves an API target string to its file path on disk, or `null` for an
 * unrecognized target. Shared by the /file and /entries handlers so the two
 * endpoints can never disagree about where a target lives. */
function targetPath(dataDir, target) {
  if (typeof target !== 'string') return null
  if (Object.hasOwn(SIMPLE_TARGETS, target)) return join(dataDir, SIMPLE_TARGETS[target])
  const daily = /^daily:(\d{4})-(\d{2})-(\d{2})$/.exec(target)
  if (daily) {
    const [, year, month, day] = daily
    return dailyPath(dataDir, new Date(Number(year), Number(month) - 1, Number(day)))
  }
  const weekly = /^weekly:(\d{4})-W(\d{2})$/.exec(target)
  if (weekly) return weeklyPath(dataDir, Number(weekly[1]), Number(weekly[2]))
  return null
}

/** Lists every existing daily diary entry (one per real `.md` file under
 * `memory/YYYY-MM/`), newest first. Used by the settings-page journal
 * browser to build its month-grouped list — never guesses at entries that
 * do not exist on disk. */
export function listDailyEntries(dataDir) {
  let monthDirs
  try {
    monthDirs = readdirSync(join(dataDir, 'memory'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
  } catch {
    return []
  }
  const entries = []
  for (const monthEntry of monthDirs) {
    const dirPath = join(dataDir, 'memory', monthEntry.name)
    let files
    try {
      files = readdirSync(dirPath)
    } catch {
      continue
    }
    for (const file of files) {
      const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(file)
      if (match) entries.push({ date: match[1], mtimeMs: statMtimeMs(join(dirPath, file)) })
    }
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return entries
}

/** Lists every existing weekly journal entry (one per real `.md` file under
 * `memory/weekly/`), newest first. */
export function listWeeklyEntries(dataDir) {
  let files
  try {
    files = readdirSync(join(dataDir, 'memory', 'weekly'))
  } catch {
    return []
  }
  const entries = []
  for (const file of files) {
    const match = /^(\d{4})-W(\d{2})\.md$/.exec(file)
    if (match) {
      entries.push({
        isoYear: Number(match[1]),
        isoWeek: Number(match[2]),
        label: `${match[1]}-W${match[2]}`,
        mtimeMs: statMtimeMs(join(dataDir, 'memory', 'weekly', file)),
      })
    }
  }
  entries.sort((a, b) => (a.label < b.label ? 1 : a.label > b.label ? -1 : 0))
  return entries
}

const TRUNCATION_HEAD_MARKER = '\n…(更早内容已截断，完整内容可用 memory_get 查询)…'
const TRUNCATION_TAIL_MARKER = '…(更早内容已截断，完整内容可用 memory_get 查询)…\n'

/** Keeps the beginning of `text` and drops the end once over budget, so the
 * kept prefix never shifts as the file grows — used for SOUL.md/USER.md/
 * MEMORY.md so a cached prompt prefix survives their growth. */
export function truncateKeepingHead(text, budget) {
  if (text.length <= budget) return text
  const keep = Math.max(budget - TRUNCATION_HEAD_MARKER.length, 0)
  return `${text.slice(0, keep)}${TRUNCATION_HEAD_MARKER}`
}

/** Keeps the end of `text` and drops the beginning once over budget — used
 * for today's diary, which is already the last thing injected, so keeping
 * its most recent entries is more useful than keeping its oldest. */
export function truncateKeepingTail(text, budget) {
  if (text.length <= budget) return text
  const keep = Math.max(budget - TRUNCATION_TAIL_MARKER.length, 0)
  return `${TRUNCATION_TAIL_MARKER}${text.slice(text.length - keep)}`
}

function isLoopbackRequest(req) {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Builds the per-request Cordis plugin. State (the pending-user-edit flag)
 * lives only in this closure's memory for the process lifetime — see the
 * "Known Limitations" section of the README for what that does and does not
 * detect.
 */
export async function apply(ctx, config) {
  const dataDir = resolveDataDir(config)
  seedFilesIfMissing(dataDir)
  seedScopesIfMissing(dataDir, config)
  const userEditedPending = new Set()

  // AssembleContext.agent is a documented merge-extension (see
  // @deepseek-ai/dsh-agent's runtime-types.ts) set by assembleContextFor()
  // for every real agent turn; absent only for diagnostic/manual assembly.
  function buildContextText(context) {
    const sessionId = context?.agent?.session?.header?.id
    const cwd = context?.agent?.session?.header?.cwd
    const { enabled } = resolveEnabled(readScopes(dataDir), { sessionId, cwd })
    if (!enabled) return ''

    const now = new Date()
    const parts = []

    for (const file of TRACKED_FILES) {
      const text = readFileSafe(join(dataDir, file))
      if (text) parts.push(truncateKeepingHead(text, config.injectionBudgetChars))
    }

    const diaryText = readFileSafe(dailyPath(dataDir, now))
    if (diaryText) parts.push(truncateKeepingTail(diaryText, config.injectionBudgetChars))

    for (const [target, file] of Object.entries(SIMPLE_TARGETS)) {
      if (userEditedPending.has(target)) {
        parts.push(`（提示：用户刚才通过设置页修改了 ${file}，内容可能已更新。）`)
        userEditedPending.delete(target)
      }
    }
    const todayTarget = `daily:${isoDate(now)}`
    if (userEditedPending.has(todayTarget)) {
      parts.push('（提示：用户刚才通过设置页编辑了今天的日记，内容可能已更新。）')
      userEditedPending.delete(todayTarget)
    }

    if (now.getHours() >= config.nightHour && !existsSync(dailyPath(dataDir, now))) {
      parts.push('（提示：今天还没有写日记。如果记得今天发生了什么值得记录的事，请写一篇日记并把其中值得长期记住的内容另外追加进长期记忆。）')
    }

    const { isoYear, isoWeek } = previousIsoWeek(now)
    if (!existsSync(weeklyPath(dataDir, isoYear, isoWeek)) && anyDailyNoteExistsInIsoWeek(dataDir, isoYear, isoWeek)) {
      parts.push(`（提示：${weeklyLabel(isoYear, isoWeek)} 这一周还没有写周记，可以读取该周每天的日记后生成一份周记。）`)
    }

    parts.push('以上内容每次对话都会自动带上。仅当用户明确要求"记住"或"回想"某事时，才调用记忆检索/写入工具做精确操作，不需要每轮都主动查询。')

    return parts.join('\n\n')
  }

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: config.order,
    text: buildContextText,
    interpolate: false,
  })

  ctx.inject(['webServer'], (scope) => {
    scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-memory-journal/status',
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
        const url = new URL(req.url, 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') || undefined
        const cwd = url.searchParams.get('cwd') || undefined
        const scopes = readScopes(dataDir)
        sendJson(res, 200, {
          dataDir,
          injectionBudgetChars: config.injectionBudgetChars,
          scopes,
          resolved: resolveEnabled(scopes, { sessionId, cwd }),
        })
      },
    })

    scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-memory-journal/scope',
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const { level, key, enabled } = JSON.parse(body)
            if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
            const scopes = readScopes(dataDir)
            if (level === 'global') {
              scopes.global = enabled
            } else if (level === 'workspace' || level === 'session') {
              if (typeof key !== 'string' || key.length === 0) {
                throw new Error(`${level} scope requires a non-empty string key`)
              }
              scopes[level][key] = enabled
            } else {
              throw new Error(`unknown level: ${String(level)} (expected 'global', 'workspace', or 'session')`)
            }
            writeScopes(dataDir, scopes)
            sendJson(res, 200, { ok: true, scopes })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message })
          }
        })
      },
    })

    // Lists every diary/weekly entry that actually exists on disk, for the
    // settings-page journal browser's left-hand list. memory.md/soul.md/
    // user.md are not included here — they are singletons the client
    // already knows about statically, addressed directly through /file.
    scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-memory-journal/entries',
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'forbidden' })
        sendJson(res, 200, { daily: listDailyEntries(dataDir), weekly: listWeeklyEntries(dataDir) })
      },
    })

    // Addresses any single file this plugin owns — soul/user/memory, or a
    // specific day/week's journal entry — by the same `target` vocabulary
    // py-mcp's MemoryStore uses. GET returns the file's current mtime
    // alongside its content; POST must echo back the mtime it read (or
    // `null` for a file that did not exist yet) as `expectedMtimeMs`, and is
    // rejected with 409 if the file changed on disk since — e.g. the model
    // wrote a diary entry through the MCP server while this was open for
    // editing — rather than silently overwriting whichever side saved last.
    scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-memory-journal/file',
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'forbidden' })

        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const target = url.searchParams.get('target')
          const path = targetPath(dataDir, target)
          if (!path) return sendJson(res, 400, { error: 'unknown target' })
          return sendJson(res, 200, { target, content: readFileSafe(path), mtimeMs: statMtimeMs(path) })
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const { target, content, expectedMtimeMs } = JSON.parse(body)
              const path = targetPath(dataDir, target)
              if (!path) throw new Error('unknown target')
              if (typeof content !== 'string') throw new Error('content must be a string')
              const expected = expectedMtimeMs === undefined ? null : expectedMtimeMs
              const currentMtimeMs = statMtimeMs(path)
              if (currentMtimeMs !== expected) {
                sendJson(res, 409, { ok: false, error: 'conflict', currentMtimeMs })
                return
              }
              writeFileAtomic(path, content)
              userEditedPending.add(target)
              sendJson(res, 200, { ok: true, mtimeMs: statMtimeMs(path) })
            } catch (error) {
              sendJson(res, 400, { ok: false, error: error.message })
            }
          })
          return
        }

        sendJson(res, 405, { error: 'method not allowed' })
      },
    })
  })
}
