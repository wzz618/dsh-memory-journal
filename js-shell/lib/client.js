// DSH Web client plugin — NOT standard ESM. The host loads this file through
// its own runtime module loader (window.__ModuleLoader__), which calls
// `factory(require)` and expects `module.exports` back; `require` only
// resolves host-provided modules (react, react/jsx-runtime, ...). This
// wrapper shape and the slots/locale registration pattern below mirror
// dsh-persona-dafeiyu's lib/client.js (MIT License) — see README.
//
// Scope: a single `conversation.composer.dock` entry showing whether memory
// injection is on for this conversation and at which level (global/
// workspace/session) that came from, with a tap target per level to flip
// it. No settings-page section yet (SOUL.md/USER.md/MEMORY.md/diary
// viewing) — that is unbuilt; see README "Known limitations".
window.__ModuleLoader__.load({
	id: 'dsh-memory-journal',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')

		/** 字典命名空间。 */
		const NS = 'memoryJournal'
		/** composer dock 席位 id。 */
		const DOCK_ID = 'memory-journal-dock'
		/** 宿主接口（见 lib/index.js）。 */
		const STATUS_PATH = '/api/dsh-memory-journal/status'
		const SCOPE_PATH = '/api/dsh-memory-journal/scope'

		const zh = {
			icon: '📓',
			label: '记忆',
			level_global: '全局',
			level_workspace: '工作区',
			level_session: '会话',
			state_on: '开',
			state_off: '关',
			state_unset: '未设置',
			error: '出错了',
		}
		const en = {
			icon: '📓',
			label: 'Memory',
			level_global: 'Global',
			level_workspace: 'Workspace',
			level_session: 'Session',
			state_on: 'On',
			state_off: 'Off',
			state_unset: 'Unset',
			error: 'Error',
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

		// Cycles a level's own stored value: unset -> true -> false -> unset.
		// "global" has no unset state (it always holds a boolean).
		function nextValue(level, current) {
			if (level === 'global') return !current
			if (current === undefined) return true
			if (current === true) return false
			return undefined
		}

		function MemoryDock(props) {
			const t = typeof props?.t === 'function' ? props.t : (key) => key
			const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
			const useSessions = props?.useSessions
			const cwd = typeof useSessions === 'function'
				? useSessions((snapshot) => {
					const entry = sessionId.length > 0 && snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined
					return entry && typeof entry.cwd === 'string' ? entry.cwd : undefined
				})
				: undefined

			const [scopes, setScopes] = react.useState(null)
			const [resolved, setResolved] = react.useState(null)
			const [error, setError] = react.useState(null)

			const reload = react.useCallback(() => {
				fetchStatus(sessionId, cwd)
					.then((body) => {
						setScopes(body.scopes)
						setResolved(body.resolved)
						setError(null)
					})
					.catch((err) => setError(err.message))
			}, [sessionId, cwd])

			react.useEffect(() => { reload() }, [reload])

			if (error) {
				return react.createElement('span', { title: error }, `${t('icon')} ${t('error')}`)
			}
			if (!scopes || !resolved) {
				return react.createElement('span', null, t('icon'))
			}

			const currentValueByLevel = {
				global: scopes.global,
				workspace: cwd ? scopes.workspace[cwd] : undefined,
				session: sessionId ? scopes.session[sessionId] : undefined,
			}
			const keyByLevel = { global: undefined, workspace: cwd, session: sessionId }

			function stateLabel(level) {
				const value = currentValueByLevel[level]
				if (value === undefined) return t('state_unset')
				return value ? t('state_on') : t('state_off')
			}

			function onToggle(level) {
				const key = keyByLevel[level]
				if (level !== 'global' && !key) return // no workspace/session identity yet
				const next = nextValue(level, currentValueByLevel[level])
				postScope(level, key, next === undefined ? false : next)
					.then(() => reload())
					.catch((err) => setError(err.message))
			}

			return react.createElement(
				'span',
				{ title: `${t('label')} · ${levelLabel(t, resolved.level)}` },
				`${t('icon')} ${t('label')} · ${levelLabel(t, resolved.level)} `,
				...['global', 'workspace', 'session'].map((level) => react.createElement(
					'button',
					{
						key: level,
						type: 'button',
						disabled: level !== 'global' && !keyByLevel[level],
						onClick: () => onToggle(level),
					},
					`${levelLabel(t, level)}(${stateLabel(level)})`,
				)),
			)
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
		}

		exports.apply = apply
		exports.inject = inject
		exports.NS = NS
		exports.DOCK_ID = DOCK_ID
		exports.MemoryDock = MemoryDock
		return module.exports
	},
})
