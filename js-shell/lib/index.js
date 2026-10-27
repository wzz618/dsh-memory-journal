/**
 * dsh-memory-journal (js-shell): forces USER.md/MEMORY.md into every system
 * prompt assembly and exposes a loopback-only HTTP API for reading/editing
 * the Markdown memory files. Explicit recall/write/review tools live in the
 * companion py-mcp MCP server, not here — this half only does what requires
 * running inside the Cordis process (systemPrompt injection, webServer).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SECTION_NAME = 'memory-journal:context'
const NUMBER_FIELDS = ['order', 'injectionBudgetChars', 'dailyNotesLookbackDays']
const TRACKED_FILES = ['USER.md', 'MEMORY.md']

const FALLBACK_CONFIG = {
  '~standard': {
    version: 1,
    vendor: 'dsh-memory-journal',
    validate(value) {
      const issues = []
      const config = {
        enabled: false,
        order: 0,
        injectionBudgetChars: 4000,
        dailyNotesLookbackDays: 2,
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
        enabled: z.boolean().default(false)
          .description('是否对当前作用域启用记忆注入（全局默认关闭，按工作区/会话单独开启）'),
        order: z.number().default(0)
          .description('system prompt 段落顺序'),
        injectionBudgetChars: z.number().default(4000)
          .description('每次注入 USER.md+MEMORY.md 的字符预算上限，超出时只截断注入副本，不改动磁盘原文'),
        dailyNotesLookbackDays: z.number().default(2)
          .description('保留字段：新会话额外带上最近 N 天日记（当前版本尚未接入，见 README 已知限制）'),
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

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

function monthDir(dataDir, year, month) {
  return join(dataDir, 'memory', `${year}-${String(month).padStart(2, '0')}`)
}

export function previousMonth(date) {
  const currentMonth = date.getMonth() + 1
  const currentYear = date.getFullYear()
  if (currentMonth === 1) return { year: currentYear - 1, month: 12 }
  return { year: currentYear, month: currentMonth - 1 }
}

const TRUNCATION_MARKER = '…(更早内容已截断，完整内容可用 memory_get 查询)…\n'

export function truncateKeepingTail(text, budget) {
  if (text.length <= budget) return text
  const keep = Math.max(budget - TRUNCATION_MARKER.length, 0)
  return `${TRUNCATION_MARKER}${text.slice(text.length - keep)}`
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
  const userEditedPending = new Set()

  function buildContextText() {
    if (!config.enabled) return ''

    const parts = []
    const userText = readFileSafe(join(dataDir, 'USER.md'))
    const memoryText = readFileSafe(join(dataDir, 'MEMORY.md'))
    const combined = [userText, memoryText].filter(Boolean).join('\n\n')
    if (combined) {
      parts.push(truncateKeepingTail(combined, config.injectionBudgetChars))
    }

    for (const file of TRACKED_FILES) {
      if (userEditedPending.has(file)) {
        parts.push(`（提示：用户刚才通过设置页修改了 ${file}，内容可能已更新。）`)
        userEditedPending.delete(file)
      }
    }

    const { year, month } = previousMonth(new Date())
    const reviewMonthDir = monthDir(dataDir, year, month)
    const reviewPath = join(reviewMonthDir, 'review.md')
    if (existsSync(reviewMonthDir) && !existsSync(reviewPath)) {
      const label = `${year}-${String(month).padStart(2, '0')}`
      parts.push(`（提示：${label} 还没有月度回顾，可以调用 memory_get 读取该月全部日记后生成一份回顾，并在 DREAMS.md 追加一条不超过 200 字的小结。）`)
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
        sendJson(res, 200, { enabled: config.enabled, dataDir, injectionBudgetChars: config.injectionBudgetChars })
      },
    })

    scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-memory-journal/file',
      handler: (req, res) => {
        if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'forbidden' })

        const url = new URL(req.url, 'http://localhost')
        const fileName = url.searchParams.get('name')
        if (!TRACKED_FILES.includes(fileName) && fileName !== 'DREAMS.md') {
          return sendJson(res, 400, { error: 'unknown file' })
        }

        if (req.method === 'GET') {
          return sendJson(res, 200, { name: fileName, content: readFileSafe(join(dataDir, fileName)) })
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const { content } = JSON.parse(body)
              if (typeof content !== 'string') throw new Error('content must be a string')
              writeFileAtomic(join(dataDir, fileName), content)
              if (TRACKED_FILES.includes(fileName)) userEditedPending.add(fileName)
              sendJson(res, 200, { ok: true })
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
