import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LabsClient } from './LabsClient'
import './labs.css'

// Server actions invoked from this route segment inherit this ceiling.
// `extractFromStorage` calls Anthropic (vision path on big multi-page
// scans can take a while); 800s matches the platform's other heavy
// routes (refill/diagnose) and the Pro plan's function maxDuration cap.
export const maxDuration = 800

/**
 * /labs is the IMPORT TOOL — upload → review → commit. Data viz (panels
 * list + key-marker trends) lives in the dashboard's Labs tab so it
 * renders in the dashboard palette alongside the other health signals.
 * This page is intentionally thin: the upload form + the review draft
 * after extract. The CTA at the top points back at the dashboard tab
 * where the imported data shows up.
 */
export default async function LabsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
          <h1 className="text-lg font-semibold text-foreground">Labs · import</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="labs-page">
        <LabsClient />
      </main>
    </div>
  )
}
