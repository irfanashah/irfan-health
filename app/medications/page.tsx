import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchMedications, fetchAdherence } from './actions'
import { MedicationsClient } from './MedicationsClient'
import './medications.css'

export default async function MedicationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 30-day window for the medications-page heat-strip. Independent of
  // the dashboard panel's read — both call fetchAdherence with the
  // window they actually render.
  const [meds, adherence] = await Promise.all([fetchMedications(), fetchAdherence(30)])

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Medications</h1>
        </div>
        <Link
          href="/report"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Doctor report →
        </Link>
      </header>
      <MedicationsClient meds={meds} adherence={adherence} />
    </div>
  )
}
