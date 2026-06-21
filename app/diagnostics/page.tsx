import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DiagnoseButton } from '@/components/DiagnoseButton'

export default async function DiagnosticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

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
          <h1 className="text-lg font-semibold text-foreground">Diagnostics</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-muted-foreground mb-4">
          Source-vs-DB reconciliation. Runs Whoop + Withings + Nightscout diagnose routes
          in parallel and surfaces any per-metric gap.
        </p>
        <DiagnoseButton />
      </main>
    </div>
  )
}
