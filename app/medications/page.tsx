import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchMedications } from './actions'
import { MedicationsClient } from './MedicationsClient'
import './medications.css'

export default async function MedicationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const meds = await fetchMedications()

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
      <MedicationsClient meds={meds} />
    </div>
  )
}
