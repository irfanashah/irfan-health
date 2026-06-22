import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { BaselinesClient } from './BaselinesClient'
import '../dashboard.css'

export default async function BaselinesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Lists for the visibility surface on the page.
  const service = createServiceClient()
  const [anchorsRes, contextsRes, medChangesRes] = await Promise.all([
    service.from('anchor_sets')
      .select('id, source_start, source_end, set_at, note, active')
      .order('set_at', { ascending: false }),
    service.from('context_periods')
      .select('id, start_date, end_date, type, suppress_alerts, exclude_from_baseline, note, active, created_at')
      .order('start_date', { ascending: false }),
    service.from('med_changes')
      .select('id, change_date, label, affected_metrics, note, active, created_at')
      .order('change_date', { ascending: false }),
  ])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-txt">
              <div className="greet">Baselines & context</div>
              <div className="greet-sub">Set anchor · context periods · med changes · exclude days</div>
            </div>
          </div>
          <div className="topbar-ctrls">
            <Link href="/" className="diag-link">← Dashboard</Link>
          </div>
        </div>
      </header>

      <main className="grid" style={{ marginTop: 18 }}>
        <BaselinesClient
          anchors={(anchorsRes.data ?? []) as Array<{ id: string; source_start: string; source_end: string; set_at: string; note: string | null; active: boolean }>}
          contexts={(contextsRes.data ?? []) as Array<{ id: string; start_date: string; end_date: string; type: 'ramadan' | 'travel' | 'illness' | 'other' | 'anomaly'; suppress_alerts: boolean; exclude_from_baseline: boolean; note: string | null; active: boolean; created_at: string }>}
          medChanges={(medChangesRes.data ?? []) as Array<{ id: string; change_date: string; label: string; affected_metrics: string[]; note: string | null; active: boolean; created_at: string }>}
        />
      </main>
    </div>
  )
}
