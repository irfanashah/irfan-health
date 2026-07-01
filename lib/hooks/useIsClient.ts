'use client'

import { useSyncExternalStore } from 'react'

// A store that never changes — `useSyncExternalStore` resolves the
// server/client snapshot mismatch (false during SSR, true once mounted on
// the client) on its own via React's built-in hydration reconciliation,
// with no `useEffect` + `setState` needed. This is the modern replacement
// for the classic `useState(false)` + `useEffect(() => setMounted(true), [])`
// "avoid SSR/CSR mismatch" pattern — same resolution timing (flips true
// immediately once React can re-render post-hydration), just via the
// primitive React now provides specifically for reading an external,
// environment-dependent value safely.
const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * True once mounted on the client; false during server rendering / the
 * initial hydration pass. Use to gate any client-only value (theme, current
 * time, localStorage) that would otherwise cause a hydration mismatch.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
