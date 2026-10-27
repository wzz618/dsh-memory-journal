/**
 * Client-side entry point (reserved).
 *
 * Phase 1 ships only the Host-side plugin (./index.js) and its loopback
 * HTTP API (`/api/dsh-memory-journal/status`, `/api/dsh-memory-journal/file`).
 * A settings-page UI that calls that API from the Web client has not been
 * built yet: registering a component against `@deepseek-ai/dsh-client-ui-renderer`
 * needs its own research pass against that package's real API before any
 * code here can be trusted, so this file intentionally does nothing rather
 * than ship an unverified, possibly-wrong registration call.
 *
 * Until then, the HTTP API above is reachable directly (e.g. via curl from
 * the host machine) for viewing/editing USER.md, MEMORY.md, and DREAMS.md.
 */
export const name = 'dsh-memory-journal-client'
export const inject = []

export function apply() {
  // No UI slots registered yet — see the comment above.
}
