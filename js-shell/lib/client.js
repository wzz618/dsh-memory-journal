// DSH Web client plugin — NOT standard ESM. The host loads this file through
// its own runtime module loader (window.__ModuleLoader__), which calls
// `factory(require)` and expects `module.exports` back; `require` only
// resolves host-provided modules (react, react/jsx-runtime, ...). This
// wrapper shape, the slots/locale registration, and the dock's styling
// below mirror dsh-persona-dafeiyu's lib/client.js (MIT License) — see
// README.
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
		const jsxRuntime = require('react/jsx-runtime')

		// Same keys and --dsw-alias-* design tokens as dsh-persona-dafeiyu's
		// dock, so this chip looks native to the host's theme (light/dark)
		// instead of unstyled plain text.
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
			messageError: { fontSize: '13px', margin: 0, color: 'var(--dsw-alias-state-error-primary, #d4380d)' },
		}

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
			loading: '加载中',
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
			loading: 'Loading',
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
				return jsxRuntime.jsx('div', { style: styles.dock, children: `${t('icon')} ${t('loading')}` })
			}
			if (state.status === 'error') {
				return jsxRuntime.jsx('div', { style: styles.dock, children: `${t('icon')} ${t('error')}` })
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

			const children = [jsxRuntime.jsx('button', {
				type: 'button',
				style: styleFor(resolved.level),
				disabled: busy,
				title: `${levelLabel(t, resolved.level)}(${stateLabel(resolved.level)})`,
				'aria-expanded': open,
				onClick: () => setOpen((wasOpen) => !wasOpen),
				children: triggerLabel,
			}, 'trigger')]

			if (open) {
				children.push(jsxRuntime.jsx('div', {
					style: styles.popover,
					children: ['global', 'workspace', 'session'].map((level) => jsxRuntime.jsx('button', {
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
				children.push(jsxRuntime.jsx('span', { style: styles.messageError, children: toggleError }, 'failure'))
			}

			return jsxRuntime.jsx('div', {
				style: styles.wrapper,
				'data-dsh-memory-journal-dock': resolved.level,
				children,
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
		}

		exports.apply = apply
		exports.inject = inject
		exports.NS = NS
		exports.DOCK_ID = DOCK_ID
		exports.MemoryDock = MemoryDock
		return module.exports
	},
})
