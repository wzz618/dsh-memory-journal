// DSH Web client plugin — NOT standard ESM. The host loads this file through
// its own runtime module loader (window.__ModuleLoader__), which calls
// `factory(require)` and expects `module.exports` back; `require` only
// resolves host-provided modules (react, react/jsx-runtime, ...). This
// wrapper shape, the slots/locale registration, and the composer-dock's
// styling below mirror dsh-persona-dafeiyu's lib/client.js (MIT License) —
// see README.
//
// Two slot contributions:
//   - `conversation.composer.dock`: a small chip showing whether memory
//     injection is on for this conversation and at which level (global/
//     workspace/session), with a tap target per level to flip it.
//   - `settings.section`: a full "记忆/Memory" page in the host's Settings
//     dialog for browsing and editing SOUL.md/USER.md/MEMORY.md and every
//     diary/weekly journal entry that exists on disk. Unlike
//     dsh-persona-dafeiyu's own settings section (which treats persona text
//     as an immutable, reimport-to-change blob), existing files here are
//     editable in place with Save/Cancel — see the README for why, and for
//     the optimistic-concurrency check that guards a save against a
//     concurrent write from the MCP server.
window.__ModuleLoader__.load({
	id: 'dsh-memory-journal',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')
		const jsxRuntime = require('react/jsx-runtime')
		const { MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives')
		const h = jsxRuntime.jsx

		// Same keys and --dsw-alias-* design tokens as dsh-persona-dafeiyu's
		// dock/settings section, so this plugin looks native to the host's
		// theme (light/dark) instead of unstyled plain text.
		const styles = {
			dock: {
				display: 'flex',
				alignItems: 'center',
				flexWrap: 'wrap',
				gap: '6px',
				fontSize: '11px',
				color: 'var(--dsw-alias-label-tertiary)',
			},
			wrapper: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
			// On/off is conveyed by brightness alone, not by text: `bright` is the
			// lit (on) look, `dim` is the same shape with lowered opacity and
			// muted color (off). Both the trigger and every popover row use
			// whichever of these two matches their own current value.
			bright: {
				font: 'inherit',
				fontSize: '11px',
				padding: '1px 8px',
				borderRadius: '999px',
				border: '1px solid var(--dsw-alias-state-business-primary, #4b7bec)',
				background: 'transparent',
				color: 'var(--dsw-alias-state-business-primary, #4b7bec)',
				cursor: 'pointer',
				opacity: 1,
			},
			dim: {
				font: 'inherit',
				fontSize: '11px',
				padding: '1px 8px',
				borderRadius: '999px',
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'transparent',
				color: 'var(--dsw-alias-label-tertiary)',
				cursor: 'pointer',
				opacity: 0.5,
			},
			// Opens upward (bottom: 100%) since the dock sits at the bottom of the
			// screen, right above the composer — a downward popover would run
			// off-screen. left: 0 keeps it flush with the trigger it belongs to.
			popover: {
				position: 'absolute',
				bottom: 'calc(100% + 4px)',
				left: 0,
				display: 'flex',
				flexDirection: 'column',
				gap: '4px',
				padding: '4px',
				borderRadius: '10px',
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'var(--dsw-alias-bg-layer, #fff)',
				boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
				zIndex: 10,
			},
			popoverItemLayout: { textAlign: 'left', whiteSpace: 'nowrap' },
			messageError: {
				fontSize: '13px',
				margin: '0 0 10px',
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				color: 'var(--dsw-alias-state-error-primary, #d4380d)',
			},

			// --- settings.section: the "记忆/Memory" page ---
			sectionRoot: { display: 'flex', flexDirection: 'column', gap: '8px', height: '100%', minHeight: 0 },
			sectionHeading: { margin: 0, fontSize: '16px', fontWeight: 600 },
			sectionIntro: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
			split: {
				display: 'flex',
				flex: '1 1 auto',
				minHeight: 0,
				border: '1px solid var(--dsw-alias-border-l4)',
				borderRadius: '10px',
				overflow: 'hidden',
			},
			list: {
				width: '220px',
				flex: '0 0 220px',
				borderRight: '1px solid var(--dsw-alias-border-l4)',
				background: 'var(--dsw-alias-bg-layer-2)',
				overflowY: 'auto',
				padding: '6px 0',
			},
			detail: { flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: '16px 20px' },
			groupLabel: {
				padding: '8px 12px 2px',
				fontSize: '11px',
				fontWeight: 700,
				letterSpacing: '0.02em',
				textTransform: 'uppercase',
				color: 'var(--dsw-alias-label-tertiary)',
			},
			groupHeader: {
				display: 'flex',
				alignItems: 'center',
				gap: '4px',
				padding: '5px 12px',
				fontSize: '12px',
				fontWeight: 600,
				color: 'var(--dsw-alias-label-secondary)',
				cursor: 'pointer',
				userSelect: 'none',
			},
			row: {
				padding: '4px 12px 4px 28px',
				margin: '0 6px',
				fontSize: '13px',
				borderRadius: '6px',
				color: 'var(--dsw-alias-label-primary)',
				cursor: 'pointer',
			},
			topLevelRow: {
				padding: '5px 12px',
				margin: '0 6px',
				fontSize: '13px',
				fontWeight: 500,
				borderRadius: '6px',
				color: 'var(--dsw-alias-label-primary)',
				cursor: 'pointer',
			},
			rowSelected: { background: 'var(--dsw-alias-interactive-bg-hover)' },
			rowDim: { color: 'var(--dsw-alias-label-tertiary)', fontStyle: 'italic' },
			divider: { height: '1px', margin: '8px 6px', background: 'var(--dsw-alias-border-l4)' },
			emptyHint: { padding: '8px 12px', fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
			detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' },
			detailTitle: { fontSize: '15px', fontWeight: 600 },
			detailActions: { display: 'flex', gap: '6px' },
			button: {
				font: 'inherit',
				fontSize: '12px',
				padding: '4px 10px',
				borderRadius: '6px',
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'transparent',
				color: 'var(--dsw-alias-label-primary)',
				cursor: 'pointer',
			},
			primaryButton: {
				font: 'inherit',
				fontSize: '12px',
				padding: '4px 10px',
				borderRadius: '6px',
				border: '1px solid var(--dsw-alias-state-business-primary, #4b7bec)',
				background: 'transparent',
				color: 'var(--dsw-alias-state-business-primary, #4b7bec)',
				cursor: 'pointer',
			},
			textarea: {
				font: 'inherit',
				fontSize: '13px',
				lineHeight: 1.6,
				padding: '10px 12px',
				borderRadius: '10px',
				border: '1px solid var(--dsw-alias-border-l2)',
				background: 'transparent',
				color: 'inherit',
				width: '100%',
				minHeight: '120px',
				resize: 'vertical',
				boxSizing: 'border-box',
				overflowY: 'hidden',
			},
			messageOk: {
				fontSize: '13px',
				margin: '0 0 10px',
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				color: 'var(--dsw-alias-state-success-primary, #2f9e44)',
			},
		}

		/** 字典命名空间。 */
		const NS = 'memoryJournal'
		/** composer dock 席位 id。 */
		const DOCK_ID = 'memory-journal-dock'
		/** settings.section 席位 id。 */
		const SECTION_ID = 'memory-journal-settings'
		/** 宿主接口（见 lib/index.js）。 */
		const STATUS_PATH = '/api/dsh-memory-journal/status'
		const SCOPE_PATH = '/api/dsh-memory-journal/scope'
		const ENTRIES_PATH = '/api/dsh-memory-journal/entries'
		const FILE_PATH = '/api/dsh-memory-journal/file'

		const STATIC_ITEMS = [
			{ target: 'memory', labelKey: 'memoryLabel' },
			{ target: 'soul', labelKey: 'soulLabel' },
			{ target: 'user', labelKey: 'userLabel' },
		]

		const zh = {
			icon: '📓',
			label: '记忆',
			level_global: '全局',
			level_workspace: '工作区',
			level_session: '会话',
			state_on: '开',
			state_off: '关',
			loading: '加载中',
			error: '出错了',

			sectionNav: '记忆',
			sectionTitle: '记忆',
			sectionIntro: '浏览和编辑长期记忆文件与日记。日记/周记通常由模型通过工具写入，这里也可以手动编辑或补写。',
			journalGroup: '日记',
			weeklyGroup: '周记',
			emptyJournal: '还没有日记',
			emptyWeekly: '还没有周记',
			notWrittenSuffix: '（未写）',
			memoryLabel: 'MEMORY.md',
			soulLabel: 'SOUL.md',
			userLabel: 'USER.md',
			selectHint: '从左侧选择一项查看',
			loadingList: '加载中…',
			errorList: '列表加载失败',
			loadingContent: '加载中…',
			errorContent: '加载失败',
			editAction: '编辑',
			saveAction: '保存',
			cancelAction: '取消',
			savingBusy: '保存中…',
			savedOk: '已保存',
			conflictError: '内容已被改动，请先刷新',
			reloadAction: '刷新',
			mdCopy: '复制',
			mdCopied: '已复制',
			mdFootnotes: '脚注',
		}
		const en = {
			icon: '📓',
			label: 'Memory',
			level_global: 'Global',
			level_workspace: 'Workspace',
			level_session: 'Session',
			state_on: 'On',
			state_off: 'Off',
			loading: 'Loading',
			error: 'Error',

			sectionNav: 'Memory',
			sectionTitle: 'Memory',
			sectionIntro: "Browse and edit long-term memory files and the diary. Entries are normally written by the model through tools, but you can edit or fill them in by hand here too.",
			journalGroup: 'Journal',
			weeklyGroup: 'Weekly',
			emptyJournal: 'No diary entries yet',
			emptyWeekly: 'No weekly journals yet',
			notWrittenSuffix: '(not written)',
			memoryLabel: 'MEMORY.md',
			soulLabel: 'SOUL.md',
			userLabel: 'USER.md',
			selectHint: 'Select an item on the left',
			loadingList: 'Loading…',
			errorList: 'Failed to load the list',
			loadingContent: 'Loading…',
			errorContent: 'Failed to load',
			editAction: 'Edit',
			saveAction: 'Save',
			cancelAction: 'Cancel',
			savingBusy: 'Saving…',
			savedOk: 'Saved',
			conflictError: 'Content changed elsewhere — reload before saving',
			reloadAction: 'Reload',
			mdCopy: 'Copy',
			mdCopied: 'Copied',
			mdFootnotes: 'Footnotes',
		}

		const inject = ['slots', 'locale']

		function levelLabel(t, level) {
			if (level === 'workspace') return t('level_workspace')
			if (level === 'session') return t('level_session')
			return t('level_global')
		}

		async function fetchStatus(sessionId, cwd) {
			const query = new URLSearchParams()
			if (sessionId) query.set('sessionId', sessionId)
			if (cwd) query.set('cwd', cwd)
			const qs = query.toString()
			const res = await fetch(`${STATUS_PATH}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' } })
			if (!res.ok) throw new Error(`status request failed: ${res.status}`)
			return res.json()
		}

		async function postScope(level, key, enabled) {
			const res = await fetch(SCOPE_PATH, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ level, key, enabled }),
			})
			const body = await res.json()
			if (!res.ok || body.ok !== true) throw new Error(body.error || `scope request failed: ${res.status}`)
			return body.scopes
		}

		async function fetchEntries() {
			const res = await fetch(ENTRIES_PATH, { headers: { accept: 'application/json' } })
			if (!res.ok) throw new Error(`entries request failed: ${res.status}`)
			return res.json()
		}

		async function fetchFile(target) {
			const res = await fetch(`${FILE_PATH}?target=${encodeURIComponent(target)}`, { headers: { accept: 'application/json' } })
			if (!res.ok) throw new Error(`file request failed: ${res.status}`)
			return res.json()
		}

		/** Throws an `Error` with `.conflict = true` on a 409 (the file changed
		 * on disk since `expectedMtimeMs` was read) instead of overwriting it. */
		async function saveFile(target, content, expectedMtimeMs) {
			const res = await fetch(FILE_PATH, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ target, content, expectedMtimeMs }),
			})
			if (res.status === 409) {
				const error = new Error('conflict')
				error.conflict = true
				throw error
			}
			const body = await res.json()
			if (!res.ok || body.ok !== true) throw new Error(body.error || `save request failed: ${res.status}`)
			return body
		}

		function isoDateLabel(date) {
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			return `${year}-${month}-${day}`
		}

		// Mirrors lib/index.js's isoWeekInfo exactly (same algorithm, same
		// Monday-start/Thursday-anchored ISO 8601 definition) — duplicated here
		// because this file runs in the browser and cannot import the Node-only
		// host half. Keep the two in sync if either changes.
		function isoWeekLabel(date) {
			const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
			const dayNum = (d.getDay() + 6) % 7
			d.setDate(d.getDate() - dayNum + 3)
			const firstThursday = new Date(d.getFullYear(), 0, 4)
			const firstDayNum = (firstThursday.getDay() + 6) % 7
			firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3)
			const isoWeek = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000))
			return `${d.getFullYear()}-W${String(isoWeek).padStart(2, '0')}`
		}

		/** Groups daily entries by `YYYY-MM`, newest month and newest day within
		 * each month first. Inserts a `missing: true` placeholder for today if no
		 * real entry exists yet, so an empty day is still a clickable row (new
		 * diary entries are created by editing that placeholder), not invisible. */
		function buildDailyGroups(dailyEntries, todayIso) {
			const byMonth = new Map()
			function bucket(key) {
				if (!byMonth.has(key)) byMonth.set(key, [])
				return byMonth.get(key)
			}
			for (const entry of dailyEntries) bucket(entry.date.slice(0, 7)).push({ ...entry, missing: false })
			const todayBucket = bucket(todayIso.slice(0, 7))
			if (!todayBucket.some((entry) => entry.date === todayIso)) {
				todayBucket.push({ date: todayIso, mtimeMs: null, missing: true })
			}
			for (const days of byMonth.values()) days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
			return [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
		}

		/** Same as buildDailyGroups, grouped by ISO year instead, with a
		 * placeholder for the current ISO week. */
		function buildWeeklyGroups(weeklyEntries, thisWeekLabel) {
			const byYear = new Map()
			function bucket(key) {
				if (!byYear.has(key)) byYear.set(key, [])
				return byYear.get(key)
			}
			for (const entry of weeklyEntries) bucket(String(entry.isoYear)).push({ ...entry, missing: false })
			const thisYearBucket = bucket(thisWeekLabel.slice(0, 4))
			if (!thisYearBucket.some((entry) => entry.label === thisWeekLabel)) {
				thisYearBucket.push({ label: thisWeekLabel, mtimeMs: null, missing: true })
			}
			for (const weeks of byYear.values()) weeks.sort((a, b) => (a.label < b.label ? 1 : a.label > b.label ? -1 : 0))
			return [...byYear.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
		}

		/** Grows (or shrinks) the textarea to exactly fit its current content,
		 * instead of a fixed guessed height — a short file would otherwise sit
		 * inside a tall, mostly-empty fixed-height box. */
		function autoSizeTextarea(el) {
			if (!el) return
			el.style.height = 'auto'
			el.style.height = `${el.scrollHeight}px`
		}

		function MemoryDock(props) {
			const t = typeof props?.t === 'function' ? props.t : (key) => key
			const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
			const useSessions = props?.useSessions
			const cwd = typeof useSessions === 'function'
				? useSessions((snapshot) => {
					const entry = sessionId.length > 0 && snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined
					return entry && typeof entry.cwd === 'string' && entry.cwd.length > 0 ? entry.cwd : undefined
				})
				: undefined

			const [state, setState] = react.useState({ status: 'loading' })
			const [busy, setBusy] = react.useState(false)
			const [toggleError, setToggleError] = react.useState(null)
			const [open, setOpen] = react.useState(false)

			const load = react.useCallback(() => {
				fetchStatus(sessionId, cwd)
					.then((body) => setState({ status: 'ready', scopes: body.scopes, resolved: body.resolved }))
					.catch((error) => setState({ status: 'error', message: error.message }))
			}, [sessionId, cwd])

			react.useEffect(() => { load() }, [load])

			if (state.status === 'loading') {
				return h('div', { style: styles.dock, children: `${t('icon')} ${t('loading')}` })
			}
			if (state.status === 'error') {
				return h('div', { style: styles.dock, children: `${t('icon')} ${t('error')}` })
			}

			const { scopes, resolved } = state
			const keyByLevel = { global: undefined, workspace: cwd, session: sessionId }

			// No "unset" state — a row with no stored value of its own just
			// shows (and, on click, flips away from) the overall effective
			// result, same as the global row always does for its own value.
			function displayValue(level) {
				if (level === 'global') return scopes.global
				if (level === 'workspace') return cwd && Object.hasOwn(scopes.workspace, cwd) ? scopes.workspace[cwd] : resolved.enabled
				return sessionId && Object.hasOwn(scopes.session, sessionId) ? scopes.session[sessionId] : resolved.enabled
			}

			function stateLabel(level) {
				return displayValue(level) ? t('state_on') : t('state_off')
			}

			function styleFor(level, layoutStyle) {
				const base = displayValue(level) ? styles.bright : styles.dim
				return layoutStyle ? { ...base, ...layoutStyle } : base
			}

			function onToggle(level) {
				const key = keyByLevel[level]
				if (level !== 'global' && !key) return // no workspace/session identity yet
				setBusy(true)
				setToggleError(null)
				setOpen(false)
				postScope(level, key, !displayValue(level))
					.then(() => load())
					.catch((error) => setToggleError(error.message))
					.then(() => setBusy(false))
			}

			const triggerLabel = `${t('icon')} ${t('label')} · ${levelLabel(t, resolved.level)} ${open ? '▴' : '▾'}`

			const children = [h('button', {
				type: 'button',
				style: styleFor(resolved.level),
				disabled: busy,
				title: `${levelLabel(t, resolved.level)}(${stateLabel(resolved.level)})`,
				'aria-expanded': open,
				onClick: () => setOpen((wasOpen) => !wasOpen),
				children: triggerLabel,
			}, 'trigger')]

			if (open) {
				children.push(h('div', {
					style: styles.popover,
					children: ['global', 'workspace', 'session'].map((level) => h('button', {
						type: 'button',
						style: styleFor(level, styles.popoverItemLayout),
						disabled: busy || (level !== 'global' && !keyByLevel[level]),
						title: `${levelLabel(t, level)}(${stateLabel(level)})`,
						onClick: () => onToggle(level),
						children: levelLabel(t, level),
					}, level)),
				}, 'popover'))
			}

			if (toggleError !== null) {
				children.push(h('span', { style: styles.messageError, children: toggleError }, 'failure'))
			}

			return h('div', {
				style: styles.wrapper,
				'data-dsh-memory-journal-dock': resolved.level,
				children,
			})
		}

		function MemorySettingsSection(props) {
			const t = typeof props?.t === 'function' ? props.t : (key) => key

			const [entries, setEntries] = react.useState({ status: 'loading' })
			const [expandedMonths, setExpandedMonths] = react.useState(new Set())
			const [expandedYears, setExpandedYears] = react.useState(new Set())
			const [selected, setSelected] = react.useState(null)
			const [file, setFile] = react.useState(null)
			const [mode, setMode] = react.useState('view')
			const [draft, setDraft] = react.useState('')
			const [busy, setBusy] = react.useState(false)
			const [message, setMessage] = react.useState(null)
			// Only auto-expand the latest month/year the first time entries load —
			// a later reload (after saving a journal entry) must not collapse
			// whatever the person had already opened by hand.
			const expandedInitialized = react.useRef(false)
			const textareaRef = react.useRef(null)

			react.useEffect(() => {
				if (mode === 'edit') autoSizeTextarea(textareaRef.current)
			}, [mode, selected])

			function handleDraftChange(event) {
				setDraft(event.target.value)
				autoSizeTextarea(event.target)
			}

			const loadEntries = react.useCallback(() => {
				fetchEntries()
					.then((body) => {
						setEntries({ status: 'ready', daily: body.daily, weekly: body.weekly })
						if (!expandedInitialized.current) {
							expandedInitialized.current = true
							const dGroups = buildDailyGroups(body.daily, isoDateLabel(new Date()))
							const wGroups = buildWeeklyGroups(body.weekly, isoWeekLabel(new Date()))
							setExpandedMonths(new Set(dGroups.length > 0 ? [dGroups[0][0]] : []))
							setExpandedYears(new Set(wGroups.length > 0 ? [wGroups[0][0]] : []))
						}
					})
					.catch((error) => setEntries({ status: 'error', error: error.message }))
			}, [])

			react.useEffect(() => { loadEntries() }, [loadEntries])

			function toggleMonth(key) {
				setExpandedMonths((prev) => {
					const next = new Set(prev)
					if (next.has(key)) next.delete(key)
					else next.add(key)
					return next
				})
			}

			function toggleYear(key) {
				setExpandedYears((prev) => {
					const next = new Set(prev)
					if (next.has(key)) next.delete(key)
					else next.add(key)
					return next
				})
			}

			function selectRow(target, missing) {
				setSelected(target)
				setMessage(null)
				if (missing) {
					setFile({ status: 'ready', target, content: '', mtimeMs: null })
					setMode('edit')
					setDraft('')
					return
				}
				setMode('view')
				setFile({ status: 'loading', target })
				fetchFile(target)
					.then((body) => setFile({ status: 'ready', target, content: body.content, mtimeMs: body.mtimeMs }))
					.catch((error) => setFile({ status: 'error', target, error: error.message }))
			}

			function startEdit() {
				setMessage(null)
				setMode('edit')
				setDraft(file.content)
			}

			function cancelEdit() {
				setMessage(null)
				if (file.mtimeMs === null) {
					// Never existed on disk — there is nothing to go back to viewing.
					setSelected(null)
					setFile(null)
					setMode('view')
					return
				}
				setMode('view')
			}

			function save() {
				const target = file.target
				setBusy(true)
				setMessage(null)
				saveFile(target, draft, file.mtimeMs)
					.then((body) => {
						setFile({ status: 'ready', target, content: draft, mtimeMs: body.mtimeMs })
						setMode('view')
						setMessage({ kind: 'ok', text: t('savedOk') })
						if (target.startsWith('daily:') || target.startsWith('weekly:')) loadEntries()
					})
					.catch((error) => {
						if (error.conflict) setMessage({ kind: 'error', text: t('conflictError'), conflict: true })
						else setMessage({ kind: 'error', text: error.message })
					})
					.finally(() => setBusy(false))
			}

			function reloadAfterConflict() {
				setMessage(null)
				selectRow(file.target, false)
			}

			function titleFor(target) {
				if (target === 'memory') return t('memoryLabel')
				if (target === 'soul') return t('soulLabel')
				if (target === 'user') return t('userLabel')
				if (target.startsWith('daily:')) return target.slice('daily:'.length)
				if (target.startsWith('weekly:')) return target.slice('weekly:'.length)
				return target
			}

			function rowStyle(target, missing, topLevel) {
				let style = topLevel ? styles.topLevelRow : styles.row
				if (selected === target) style = { ...style, ...styles.rowSelected }
				if (missing) style = { ...style, ...styles.rowDim }
				return style
			}

			function renderListPanel() {
				if (entries.status === 'loading') {
					return [h('div', { style: styles.emptyHint, children: t('loadingList') }, 'loading')]
				}
				if (entries.status === 'error') {
					return [h('div', { style: styles.emptyHint, children: `${t('errorList')}: ${entries.error}` }, 'error')]
				}

				const todayIso = isoDateLabel(new Date())
				const thisWeekLabel = isoWeekLabel(new Date())
				const dailyGroups = buildDailyGroups(entries.daily, todayIso)
				const weeklyGroups = buildWeeklyGroups(entries.weekly, thisWeekLabel)
				const rows = []

				rows.push(h('div', { style: styles.groupLabel, children: t('journalGroup') }, 'journal-label'))
				if (dailyGroups.length === 0) {
					rows.push(h('div', { style: styles.emptyHint, children: t('emptyJournal') }, 'journal-empty'))
				}
				for (const [monthKey, days] of dailyGroups) {
					const expanded = expandedMonths.has(monthKey)
					rows.push(h('div', {
						style: styles.groupHeader,
						onClick: () => toggleMonth(monthKey),
						children: `${expanded ? '▾' : '▸'} ${monthKey} (${days.length})`,
					}, `month-${monthKey}`))
					if (expanded) {
						for (const day of days) {
							const target = `daily:${day.date}`
							rows.push(h('div', {
								style: rowStyle(target, day.missing),
								onClick: () => selectRow(target, day.missing),
								children: day.date.slice(5) + (day.missing ? ` ${t('notWrittenSuffix')}` : ''),
							}, target))
						}
					}
				}

				rows.push(h('div', { style: styles.groupLabel, children: t('weeklyGroup') }, 'weekly-label'))
				if (weeklyGroups.length === 0) {
					rows.push(h('div', { style: styles.emptyHint, children: t('emptyWeekly') }, 'weekly-empty'))
				}
				for (const [yearKey, weeks] of weeklyGroups) {
					const expanded = expandedYears.has(yearKey)
					rows.push(h('div', {
						style: styles.groupHeader,
						onClick: () => toggleYear(yearKey),
						children: `${expanded ? '▾' : '▸'} ${yearKey} (${weeks.length})`,
					}, `year-${yearKey}`))
					if (expanded) {
						for (const week of weeks) {
							const target = `weekly:${week.label}`
							rows.push(h('div', {
								style: rowStyle(target, week.missing),
								onClick: () => selectRow(target, week.missing),
								children: week.label.slice(5) + (week.missing ? ` ${t('notWrittenSuffix')}` : ''),
							}, target))
						}
					}
				}

				rows.push(h('div', { style: styles.divider }, 'divider'))
				for (const item of STATIC_ITEMS) {
					rows.push(h('div', {
						style: rowStyle(item.target, false, true),
						onClick: () => selectRow(item.target, false),
						children: t(item.labelKey),
					}, item.target))
				}

				return rows
			}

			function renderDetailPanel() {
				if (selected === null) {
					return h('div', { style: styles.emptyHint, children: t('selectHint') })
				}
				if (!file || file.status === 'loading') {
					return h('div', { style: styles.emptyHint, children: t('loadingContent') })
				}
				if (file.status === 'error') {
					return h('div', { style: styles.messageError, children: `${t('errorContent')}: ${file.error}` })
				}

				const dirty = mode === 'edit' && draft !== file.content
				const header = h('div', {
					style: styles.detailHeader,
					children: [
						h('div', { style: styles.detailTitle, children: titleFor(selected) }, 'title'),
						mode === 'view'
							? h('button', { type: 'button', style: styles.button, onClick: startEdit, children: t('editAction') }, 'edit')
							: h('div', {
								style: styles.detailActions,
								children: [
									h('button', {
										type: 'button',
										style: busy || !dirty ? { ...styles.primaryButton, opacity: 0.5 } : styles.primaryButton,
										disabled: busy || !dirty,
										onClick: save,
										children: busy ? t('savingBusy') : t('saveAction'),
									}, 'save'),
									h('button', {
										type: 'button',
										style: busy ? { ...styles.button, opacity: 0.5 } : styles.button,
										disabled: busy,
										onClick: cancelEdit,
										children: t('cancelAction'),
									}, 'cancel'),
								],
							}, 'actions'),
					],
				}, 'header')

				const messageEl = message === null
					? null
					: h('div', {
						style: message.kind === 'ok' ? styles.messageOk : styles.messageError,
						children: message.conflict
							? [message.text, h('button', { type: 'button', style: styles.button, onClick: reloadAfterConflict, children: t('reloadAction') }, 'reload')]
							: message.text,
					}, 'message')

				const body = mode === 'edit'
					? h('textarea', {
						ref: textareaRef,
						style: styles.textarea,
						value: draft,
						disabled: busy,
						onChange: handleDraftChange,
					}, 'textarea')
					: h(MarkdownText, {
						text: file.content,
						labels: { code: { copyLabel: t('mdCopy'), copiedLabel: t('mdCopied') }, footnotes: t('mdFootnotes') },
						variant: 'body',
					}, 'markdown')

				return h('div', { children: [header, messageEl, body].filter((child) => child !== null) })
			}

			return h('div', {
				style: styles.sectionRoot,
				children: [
					h('h2', { style: styles.sectionHeading, children: t('sectionTitle') }, 'heading'),
					h('p', { style: styles.sectionIntro, children: t('sectionIntro') }, 'intro'),
					h('div', {
						style: styles.split,
						children: [
							h('div', { style: styles.list, children: renderListPanel() }, 'list'),
							h('div', { style: styles.detail, children: renderDetailPanel() }, 'detail'),
						],
					}, 'split'),
				],
			})
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory-journal: dictionaries')
			const t = ctx.locale.bind(NS)
			ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
				name: 'conversation.composer.dock',
				id: DOCK_ID,
				order: 60,
				locale: NS,
				inject: () => ({ t }),
			}, MemoryDock))
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: SECTION_ID,
				order: 50,
				label: () => t('sectionNav'),
				locale: NS,
				inject: () => ({ t }),
			}, MemorySettingsSection))
		}

		exports.apply = apply
		exports.inject = inject
		exports.NS = NS
		exports.DOCK_ID = DOCK_ID
		exports.SECTION_ID = SECTION_ID
		exports.MemoryDock = MemoryDock
		exports.MemorySettingsSection = MemorySettingsSection
		return module.exports
	},
})
