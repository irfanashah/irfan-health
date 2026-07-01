'use client'

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Timeline } from '../ui/Timeline'
import type { RecentEntry } from '@/app/log/_lib/types'

interface Props {
  entries: RecentEntry[]
}

export function TimelinePanel({ entries }: Props) {
  // Render relative time on the client only — avoids SSR/CSR mismatch around
  // "just now" / "5m ago" boundaries.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    // Defer the initial resolve into a callback (not a bare synchronous call
    // as the effect's first statement) — same near-immediate timing, avoids
    // the direct-setState-in-effect pattern. Subsequent ticks already go
    // through the setInterval callback, which is the sanctioned shape.
    const initial = setTimeout(() => setNow(new Date()), 0)
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => { clearTimeout(initial); clearInterval(t) }
  }, [])

  return (
    <Card className="col-7">
      <PanelHeader
        icon={<Activity size={18} />}
        title="Recent activity"
        accent="var(--amber)"
        right={<span className="muted-note">{entries.length} entries</span>}
      />
      <Timeline entries={entries} now={now ?? new Date(0)} />
    </Card>
  )
}
