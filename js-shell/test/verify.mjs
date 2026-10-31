// Offline self-validation for the js-shell half of dsh-memory-journal.
// Runs with plain Node — no real Cordis/dsh host required, and never
// touches the developer's real ~/.dsh-memory-journal directory.
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  apply,
  Config,
  isoDate,
  isoWeekInfo,
  listDailyEntries,
  listWeeklyEntries,
  previousIsoWeek,
  resolveDataDir,
  resolveEnabled,
  truncateKeepingHead,
  targetPath,
  truncateKeepingTail,
  withWriteLock,
  writeFileAtomic,
} from '../lib/index.js'

const SEEDED_FILES = ['SOUL.md', 'USER.md', 'MEMORY.md']

// Every default-directory resolution below must see a throwaway home, so the
// legacy-migration check never reads the developer's real ~/.dsh-memory-journal.
const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-home-'))
process.env.HOME = fakeHome

function addLocalDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}

function mondayOfIsoWeekForTest(isoYear, isoWeek) {
  const simple = new Date(isoYear, 0, 1 + (isoWeek - 1) * 7)
  const dayOfWeek = simple.getDay() || 7
  simple.setDate(simple.getDate() - dayOfWeek + 1)
  return simple
}

function isoDateLabel(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dailyFilePath(dataDir, date) {
  const label = isoDateLabel(date)
  return join(dataDir, 'memory', label.slice(0, 7), `${label}.md`)
}

function makeFakeCtx(options = {}) {
  let section = null
  let webServerCallback = null
  return {
    systemPrompt: {
      section: (opts) => { section = opts },
    },
    inject: (deps, callback) => {
      if (deps.includes('webServer')) webServerCallback = callback
    },
    // Mirrors Cordis's optional-service read; absent unless a test supplies it.
    get: (name) => (name === 'dshHomePath' ? options.dshHomePath : undefined),
    getSection: () => section,
    hasWebServerCallback: () => webServerCallback !== null,
  }
}

async function validateConfig(overrides) {
  const result = Config['~standard'].validate(overrides)
  assert.ok(!result.issues, `config validation failed: ${JSON.stringify(result.issues)}`)
  return result.value
}

function withDataDir(dir, fn) {
  process.env.DSH_MEMORY_JOURNAL_DATA_DIR = dir
  return fn()
}

// truncateKeepingHead: keeps the beginning fixed as content grows past budget.
assert.equal(truncateKeepingHead('abc', 10), 'abc')
const headTruncated = truncateKeepingHead('a'.repeat(100), 50)
assert.equal(headTruncated.length, 50)
assert.ok(headTruncated.startsWith('a'.repeat(10)))
// Growing the input further must not change the kept prefix — that's the
// whole point (a stable prompt-cache prefix).
const headTruncatedMore = truncateKeepingHead(`${'a'.repeat(100)}${'b'.repeat(50)}`, 50)
assert.equal(headTruncated.slice(0, 20), headTruncatedMore.slice(0, 20))

// truncateKeepingTail: keeps the end fixed (used only for today's diary, the
// last element in the injected text, where recency matters more).
assert.equal(truncateKeepingTail('abc', 10), 'abc')
const tailTruncated = truncateKeepingTail('a'.repeat(100), 50)
assert.equal(tailTruncated.length, 50)
assert.ok(tailTruncated.endsWith('a'.repeat(10)))

// resolveEnabled: session overrides workspace overrides global ("finest
// wins", same rule dsh-persona-dafeiyu uses for persona scoping).
const scopesFixture = { global: false, workspace: { '/proj': true }, session: { sess1: false } }
assert.deepEqual(resolveEnabled(scopesFixture, {}), { enabled: false, level: 'global' })
assert.deepEqual(resolveEnabled(scopesFixture, { cwd: '/proj' }), { enabled: true, level: 'workspace' })
assert.deepEqual(resolveEnabled(scopesFixture, { cwd: '/proj', sessionId: 'sess1' }), { enabled: false, level: 'session' })
assert.deepEqual(resolveEnabled(scopesFixture, { cwd: '/other' }), { enabled: false, level: 'global' })
assert.deepEqual(resolveEnabled(scopesFixture, { sessionId: 'unknown-session' }), { enabled: false, level: 'global' })

// isoWeekInfo / previousIsoWeek: internal consistency, all in local time —
// every day of a Monday-start week must resolve to the same ISO week, and
// "7 days ago" must land in that same earlier week.
const aMonday = new Date(2026, 9, 26) // 2026-10-26 is a Monday
const sameWeek = isoWeekInfo(aMonday)
for (let offset = 1; offset <= 6; offset += 1) {
  assert.deepEqual(isoWeekInfo(addLocalDays(aMonday, offset)), sameWeek, `offset ${offset} should stay in the same ISO week`)
}
const nextMonday = addLocalDays(aMonday, 7)
assert.deepEqual(previousIsoWeek(nextMonday), sameWeek)
// mondayOfIsoWeekForTest must round-trip back to the same week.
assert.deepEqual(isoWeekInfo(mondayOfIsoWeekForTest(sameWeek.isoYear, sameWeek.isoWeek)), sameWeek)

// isoDate: plain local YYYY-MM-DD, used identically by dailyPath, the
// `daily:...` target address, and listDailyEntries below.
assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05')
assert.equal(isoDate(new Date(2026, 10, 29)), '2026-11-29')

// resolveDataDir: an explicit dataDir wins, then the dedicated env override,
// then the host's own dshHomePath result. The last is what a real harness
// hands over via ctx.get('dshHomePath'), so the plugin follows whatever home
// the host resolved instead of re-deriving it.
assert.equal(resolveDataDir({ dataDir: '/explicit' }, (...s) => `/host/${s.join('/')}`), '/explicit')
const savedDataDirOverride = process.env.DSH_MEMORY_JOURNAL_DATA_DIR
const savedDshHome = process.env.DSH_HOME
try {
  process.env.DSH_MEMORY_JOURNAL_DATA_DIR = '/from-env'
  assert.equal(resolveDataDir({ dataDir: '' }, (...s) => `/host/${s.join('/')}`), '/from-env')
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
  assert.equal(resolveDataDir({ dataDir: '' }, (...s) => `/host/${s.join('/')}`), '/host/storages/dsh-memory-journal')
  // Without the host service, fall back to DSH's own documented rule.
  assert.equal(resolveDataDir({ dataDir: '' }), join(homedir(), '.dsh', 'storages', 'dsh-memory-journal'))
  // A blank $DSH_HOME is unset, not the current working directory.
  process.env.DSH_HOME = '   '
  assert.equal(resolveDataDir({ dataDir: '' }), join(homedir(), '.dsh', 'storages', 'dsh-memory-journal'))
  process.env.DSH_HOME = '/custom/home'
  assert.equal(resolveDataDir({ dataDir: '' }), '/custom/home/storages/dsh-memory-journal')
} finally {
  if (savedDataDirOverride === undefined) delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
  else process.env.DSH_MEMORY_JOURNAL_DATA_DIR = savedDataDirOverride
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
}

const disabledDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const enabledDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const soulKeepDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const nightDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const weeklyDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const scopeDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const entriesDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
const hostHomeDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
let legacyHome
let explicitDir
let lockDir
try {
  // Seeding only happens for a directory that does not exist yet, so each
  // scenario points at a fresh subdirectory of its own temp root.
  const dataOf = (root) => join(root, 'data')

  // Disabled scope: the section is registered but injects nothing.
  withDataDir(dataOf(disabledDir), () => {})
  const disabledConfig = await validateConfig({ enabled: false })
  const disabledCtx = makeFakeCtx()
  await apply(disabledCtx, disabledConfig)
  assert.equal(disabledCtx.getSection().name, 'memory-journal:context')
  assert.equal(disabledCtx.getSection().text(), '')
  assert.equal(disabledCtx.hasWebServerCallback(), true)
  // Seeding happens even for a disabled scope — it's a directory concern,
  // not an injection concern.
  for (const file of SEEDED_FILES) {
    assert.ok(readFileSync(join(dataOf(disabledDir), file), 'utf8').length > 0, `${file} should be seeded even when disabled`)
  }

  // Enabled scope: all three files get seeded with real content and injected.
  withDataDir(dataOf(enabledDir), () => {})
  const enabledConfig = await validateConfig({ enabled: true, injectionBudgetChars: 4000 })
  const enabledCtx = makeFakeCtx()
  await apply(enabledCtx, enabledConfig)
  const text = enabledCtx.getSection().text()
  assert.equal(typeof text, 'string')
  assert.ok(text.includes('大肥鱼'), 'injected text should include the seeded SOUL.md persona')
  assert.ok(text.includes('仅当用户明确要求'))
  for (const file of SEEDED_FILES) {
    assert.ok(readFileSync(join(dataOf(enabledDir), file), 'utf8').length > 0)
  }

  // An existing data directory is never seeded: a file someone deleted stays
  // deleted, and a hand-written SOUL.md is not replaced by the template.
  mkdirSync(dataOf(soulKeepDir), { recursive: true })
  writeFileSync(join(dataOf(soulKeepDir), 'SOUL.md'), '已经有真实人设了', 'utf8')
  withDataDir(dataOf(soulKeepDir), () => {})
  await apply(makeFakeCtx(), await validateConfig({ enabled: true }))
  assert.equal(readFileSync(join(dataOf(soulKeepDir), 'SOUL.md'), 'utf8'), '已经有真实人设了')
  assert.ok(!existsSync(join(dataOf(soulKeepDir), 'USER.md')), 'an existing directory is not topped up')

  // Night nudge: nightHour: 0 makes "now.getHours() >= nightHour" always
  // true, so this is deterministic regardless of when the test actually
  // runs. No diary written yet today -> nudge appears.
  withDataDir(dataOf(nightDir), () => {})
  const nightCtx = makeFakeCtx()
  await apply(nightCtx, await validateConfig({ enabled: true, nightHour: 0 }))
  assert.ok(nightCtx.getSection().text().includes('还没有写日记'))

  // Once today's diary file exists, the nudge stops.
  mkdirSync(dirname(dailyFilePath(dataOf(nightDir), new Date())), { recursive: true })
  writeFileSync(dailyFilePath(dataOf(nightDir), new Date()), '# 今天\n', 'utf8')
  assert.ok(!nightCtx.getSection().text().includes('还没有写日记'))

  // Weekly nudge: a daily note exists for a completed ISO week with no
  // weekly journal yet -> nudge appears, keyed off that week's label.
  withDataDir(dataOf(weeklyDir), () => {})
  const weeklyCtx = makeFakeCtx()
  await apply(weeklyCtx, await validateConfig({ enabled: true }))
  const lastWeek = previousIsoWeek(new Date())
  const lastWeekLabel = `${lastWeek.isoYear}-W${String(lastWeek.isoWeek).padStart(2, '0')}`
  const aDayLastWeek = mondayOfIsoWeekForTest(lastWeek.isoYear, lastWeek.isoWeek)
  mkdirSync(dirname(dailyFilePath(dataOf(weeklyDir), aDayLastWeek)), { recursive: true })
  writeFileSync(dailyFilePath(dataOf(weeklyDir), aDayLastWeek), '# 上周某一天\n', 'utf8')
  assert.ok(weeklyCtx.getSection().text().includes(`${lastWeekLabel} 这一周还没有写周记`))

  // Once that week's journal file exists, the nudge stops.
  const weeklyFilePath = join(dataOf(weeklyDir), 'memory', 'weekly', `${lastWeekLabel}.md`)
  mkdirSync(dirname(weeklyFilePath), { recursive: true })
  writeFileSync(weeklyFilePath, '# 周记\n', 'utf8')
  assert.ok(!weeklyCtx.getSection().text().includes('这一周还没有写周记'))

  // scopes.json wins over config.enabled once it exists: pre-seed a session
  // override before apply() ever runs, so seedScopesIfMissing must not
  // clobber it even though config.enabled says the opposite.
  mkdirSync(dataOf(scopeDir), { recursive: true })
  writeFileSync(
    join(dataOf(scopeDir), 'scopes.json'),
    JSON.stringify({ global: false, workspace: {}, session: { 'session-a': true } }),
    'utf8',
  )
  withDataDir(dataOf(scopeDir), () => {})
  const scopeCtx = makeFakeCtx()
  await apply(scopeCtx, await validateConfig({ enabled: false }))
  const scopedText = scopeCtx.getSection().text
  assert.ok(scopedText({ agent: { session: { header: { id: 'session-a', cwd: '/proj' } } } }).length > 0,
    'session-a override should turn injection on despite config.enabled: false')
  assert.equal(scopedText({ agent: { session: { header: { id: 'session-b', cwd: '/proj' } } } }), '',
    'an unrelated session should fall through to the global default (false)')
  assert.equal(scopedText(), '', 'no agent/session context (e.g. diagnostics) should fall through to global too')

  // When the host provides dshHomePath, the plugin stores under the home the
  // harness itself resolved — no env var, no hardcoded path here.
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
  const hostCtx = makeFakeCtx({ dshHomePath: (...segments) => join(hostHomeDir, ...segments) })
  await apply(hostCtx, await validateConfig({ enabled: true }))
  for (const file of SEEDED_FILES) {
    assert.ok(readFileSync(join(hostHomeDir, 'storages', 'dsh-memory-journal', file), 'utf8').length > 0,
      `${file} should be seeded under the host-resolved home`)
  }

  // Upgrading from before 0.1.0: files kept in ~/.dsh-memory-journal must
  // follow the plugin into $DSH_HOME/storages, and the old directory must
  // survive untouched.
  legacyHome = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
  const legacyRoot = join(legacyHome, '.dsh-memory-journal')
  mkdirSync(join(legacyRoot, 'memory', '2026-10'), { recursive: true })
  mkdirSync(join(legacyRoot, '.write.lock'))
  writeFileSync(join(legacyRoot, 'SOUL.md'), '旧版本的人设', 'utf8')
  writeFileSync(join(legacyRoot, 'memory', '2026-10', '2026-10-05.md'), '# 旧日记\n', 'utf8')
  const savedHome = process.env.HOME
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
  process.env.HOME = legacyHome
  const migratedCtx = makeFakeCtx()
  await apply(migratedCtx, await validateConfig({ enabled: true }))
  const migratedDir = join(legacyHome, '.dsh', 'storages', 'dsh-memory-journal')
  assert.equal(readFileSync(join(migratedDir, 'SOUL.md'), 'utf8'), '旧版本的人设')
  assert.ok(existsSync(join(migratedDir, 'memory', '2026-10', '2026-10-05.md')))
  assert.ok(!existsSync(join(migratedDir, '.write.lock')), 'lock directories are not memory content')
  assert.ok(migratedCtx.getSection().text().includes('旧版本的人设'), 'migrated content is injected')
  assert.ok(existsSync(join(legacyRoot, 'SOUL.md')), 'the legacy directory stays intact')

  // An explicit dataDir is a deliberate choice, so nothing is copied into it.
  explicitDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
  writeFileSync(join(legacyRoot, 'USER.md'), '旧版本的用户档案', 'utf8')
  withDataDir(dataOf(explicitDir), () => {})
  await apply(makeFakeCtx(), await validateConfig({ enabled: true }))
  assert.ok(!readFileSync(join(dataOf(explicitDir), 'USER.md'), 'utf8').includes('旧版本'))
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
  process.env.HOME = savedHome

  // A lock directory left behind by a crashed process is reclaimed instead of
  // blocking every later save.
  lockDir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
  const lockPath = join(lockDir, '.write.lock')
  mkdirSync(lockPath)
  const longAgo = new Date(Date.now() - 60_000)
  utimesSync(lockPath, longAgo, longAgo)
  let entered = false
  withWriteLock(lockDir, () => { entered = true })
  assert.equal(entered, true)
  assert.ok(!existsSync(lockPath), 'the lock is released when the callback returns')

  // targetPath rejects impossible dates and ISO weeks instead of normalizing
  // them into some other entry, matching py-mcp's MemoryStore.
  assert.ok(targetPath('/data', 'soul'))
  assert.equal(targetPath('/data', 'not-a-target'), null)
  assert.equal(targetPath('/data', 'daily:2026-02-30'), null)
  assert.equal(targetPath('/data', 'daily:2026-13-40'), null)
  assert.equal(targetPath('/data', 'weekly:2026-W00'), null)
  assert.equal(targetPath('/data', 'weekly:2026-W99'), null)
  assert.ok(targetPath('/data', 'daily:2026-10-05'))
  assert.ok(targetPath('/data', 'weekly:2026-W43'))

  // Saving over a symlinked memory file keeps the link: the replacement names
  // the file it points at, so a dotfiles-style link survives.
  const linkRoot = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
  const realFile = join(linkRoot, 'real-memory.md')
  const linkedFile = join(linkRoot, 'MEMORY.md')
  writeFileSync(realFile, '原有内容\n', 'utf8')
  symlinkSync(realFile, linkedFile)
  writeFileAtomic(linkedFile, '替换内容\n')
  assert.ok(lstatSync(linkedFile).isSymbolicLink(), 'the symlink is still a symlink')
  assert.equal(readFileSync(realFile, 'utf8'), '替换内容\n')
  rmSync(linkRoot, { recursive: true, force: true })

  // listDailyEntries/listWeeklyEntries: newest first, across multiple
  // months/years, and empty (not throwing) when memory/ does not exist yet.
  assert.deepEqual(listDailyEntries(entriesDir), [])
  assert.deepEqual(listWeeklyEntries(entriesDir), [])
  function localDateFromIso(label) {
    const [year, month, day] = label.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  for (const label of ['2026-09-30', '2026-10-01', '2026-10-15']) {
    const path = dailyFilePath(entriesDir, localDateFromIso(label))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `# ${label}\n`, 'utf8')
  }
  const dailyEntries = listDailyEntries(entriesDir)
  assert.deepEqual(dailyEntries.map((entry) => entry.date), ['2026-10-15', '2026-10-01', '2026-09-30'])
  assert.ok(dailyEntries.every((entry) => typeof entry.mtimeMs === 'number'))

  for (const label of ['2025-W52', '2026-W01', '2026-W10']) {
    const path = join(entriesDir, 'memory', 'weekly', `${label}.md`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `# ${label}\n`, 'utf8')
  }
  const weeklyEntries = listWeeklyEntries(entriesDir)
  assert.deepEqual(weeklyEntries.map((entry) => entry.label), ['2026-W10', '2026-W01', '2025-W52'])
  assert.ok(weeklyEntries.every((entry) => typeof entry.mtimeMs === 'number'))
} finally {
  for (const dir of [disabledDir, enabledDir, soulKeepDir, nightDir, weeklyDir, scopeDir, entriesDir, hostHomeDir, legacyHome, explicitDir, lockDir, fakeHome]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
}

console.log('dsh-memory-journal (js-shell) offline verification passed')
