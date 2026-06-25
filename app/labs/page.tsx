import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LabsClient } from './LabsClient'
import { fetchAllPanels, fetchAllMarkerTrends } from './actions'
import './labs.css'

export default async function LabsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [panels, trends] = await Promise.all([
    fetchAllPanels(),
    fetchAllMarkerTrends(),
  ])

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
          <h1 className="text-lg font-semibold text-foreground">Labs</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="labs-page">
        <LabsClient initialPanels={panels} initialTrends={trends} />
      </main>
    </div>
  )
}
