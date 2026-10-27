// Offline self-validation for the js-shell half of dsh-memory-journal.
// Runs with plain Node — no real Cordis/dsh host required, and never
// touches the developer's real ~/.dsh-memory-journal directory.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, Config, previousMonth, truncateKeepingTail } from '../lib/index.js'

function makeFakeCtx() {
  let section = null
  let webServerCallback = null
  return {
    systemPrompt: {
      section: (opts) => { section = opts },
    },
    inject: (deps, callback) => {
      if (deps.includes('webServer')) webServerCallback = callback
    },
    getSection: () => section,
    hasWebServerCallback: () => webServerCallback !== null,
  }
}

async function validateConfig(overrides) {
  const result = Config['~standard'].validate(overrides)
  assert.ok(!result.issues, `config validation failed: ${JSON.stringify(result.issues)}`)
  return result.value
}

// truncateKeepingTail: keeps content under budget unchanged, truncates from the head
// otherwise, and the result never exceeds the requested budget.
assert.equal(truncateKeepingTail('abc', 10), 'abc')
const truncated = truncateKeepingTail('a'.repeat(100), 50)
assert.equal(truncated.length, 50)
assert.ok(truncated.endsWith('a'.repeat(10)))

// previousMonth: handles the January boundary.
assert.deepEqual(previousMonth(new Date(2026, 0, 15)), { year: 2025, month: 12 })
assert.deepEqual(previousMonth(new Date(2026, 9, 15)), { year: 2026, month: 9 })

const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
try {
  process.env.DSH_MEMORY_JOURNAL_DATA_DIR = dir

  // Disabled scope: the section is registered but injects nothing.
  const disabledConfig = await validateConfig({ enabled: false })
  const disabledCtx = makeFakeCtx()
  await apply(disabledCtx, disabledConfig)
  assert.equal(disabledCtx.getSection().name, 'memory-journal:context')
  assert.equal(disabledCtx.getSection().text(), '')
  assert.equal(disabledCtx.hasWebServerCallback(), true)

  // Enabled scope: text() returns a non-empty string once a disk file exists.
  process.env.DSH_MEMORY_JOURNAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'dsh-memory-journal-test-'))
  const enabledConfig = await validateConfig({ enabled: true, injectionBudgetChars: 50 })
  const enabledCtx = makeFakeCtx()
  await apply(enabledCtx, enabledConfig)
  const text = enabledCtx.getSection().text()
  assert.equal(typeof text, 'string')
  assert.ok(text.includes('仅当用户明确要求'))
} finally {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_MEMORY_JOURNAL_DATA_DIR
}

console.log('dsh-memory-journal (js-shell) offline verification passed')
