// Unit tests for the open-redirect guard on the auth callback's `?next=`
// param (backlog H7). Every case is a concrete attack string or a
// legitimate value — no tautological "returns whatever it returns."

import { describe, it, expect } from 'vitest'
import { safeRedirectPath } from './safe-redirect'

describe('safeRedirectPath', () => {
  it('passes through a legitimate same-origin relative path unchanged', () => {
    expect(safeRedirectPath('/baselines')).toBe('/baselines')
    expect(safeRedirectPath('/report')).toBe('/report')
    expect(safeRedirectPath('/')).toBe('/')
  })

  it('defaults to "/" for null/undefined/empty', () => {
    expect(safeRedirectPath(null)).toBe('/')
    expect(safeRedirectPath(undefined)).toBe('/')
    expect(safeRedirectPath('')).toBe('/')
  })

  it('blocks protocol-relative URLs ("//host" — the classic open-redirect vector)', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/')
    expect(safeRedirectPath('//evil.com/phish')).toBe('/')
  })

  it('blocks backslash-disguised protocol-relative URLs (browser-normalised "\\" -> "/")', () => {
    expect(safeRedirectPath('/\\evil.com')).toBe('/')
  })

  it('blocks absolute URLs with a scheme (no leading "/")', () => {
    expect(safeRedirectPath('http://evil.com')).toBe('/')
    expect(safeRedirectPath('https://evil.com')).toBe('/')
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/')
  })

  it('blocks a bare host/schemeless-absolute string with no leading "/"', () => {
    expect(safeRedirectPath('evil.com')).toBe('/')
    expect(safeRedirectPath('@evil.com')).toBe('/')
  })
})
