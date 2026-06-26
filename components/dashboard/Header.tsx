'use client'

import Link from 'next/link'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { HeartPulse, Moon, Sun, Activity, Sparkles, Compass, TestTube } from 'lucide-react'
import { RANGES, STEMI_DATE, type RangeId } from './thresholds'

export type TabId = 'dashboard' | 'correlations' | 'baselines' | 'labs'

interface Props {
  range: RangeId
  onRangeChange: (r: RangeId) => void
  tab: TabId
  onTabChange: (t: TabId) => void
}

function greeting(h: number): string {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function Header({ range, onRangeChange, tab, onTabChange }: Props) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // Theme toggle relies on next-themes mounting state — render the icon only
  // after the client has picked a theme, otherwise we'd hydrate-mismatch.
  useEffect(() => setMounted(true), [])

  const [now, setNow] = useState<Date | null>(null)
  // Avoid SSR/CSR mismatch on time-of-day text — fix the time client-side only.
  useEffect(() => setNow(new Date()), [])

  const dateLabel = now
    ? now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : ''
  const greet = now ? greeting(now.getHours()) : 'Welcome'
  const recoveryDay = now
    ? Math.max(0, Math.round((now.getTime() - STEMI_DATE.getTime()) / 86400000))
    : 0

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark"><HeartPulse size={22} /></span>
          <div className="brand-txt">
            <div className="greet">{greet}, Irfan</div>
            <div className="greet-sub">
              {dateLabel} · Recovery day {recoveryDay}
            </div>
          </div>
        </div>
        <div className="topbar-ctrls">
          <Link href="/baselines" className="diag-link">Set anchor</Link>
          <Link href="/diagnostics" className="diag-link">Diagnostics</Link>
          <div className="seg range-seg">
            {RANGES.map((r) => (
              <button
                key={r.id}
                className={`seg-btn ${range === r.id ? 'active' : ''}`}
                onClick={() => onRangeChange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            className="icon-btn"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {mounted ? (resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />) : <Sun size={18} />}
          </button>
        </div>
      </div>
      <nav className="tabnav">
        <button
          className={`tab ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => onTabChange('dashboard')}
        >
          <Activity size={15} /> Dashboard
        </button>
        <button
          className={`tab ${tab === 'correlations' ? 'active' : ''}`}
          onClick={() => onTabChange('correlations')}
        >
          <Sparkles size={15} /> Correlations
        </button>
        <button
          className={`tab ${tab === 'baselines' ? 'active' : ''}`}
          onClick={() => onTabChange('baselines')}
        >
          <Compass size={15} /> Baselines &amp; drift
        </button>
        <button
          className={`tab ${tab === 'labs' ? 'active' : ''}`}
          onClick={() => onTabChange('labs')}
        >
          <TestTube size={15} /> Labs
        </button>
      </nav>
    </header>
  )
}
