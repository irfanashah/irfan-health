import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ThemeToggle } from '@/components/ThemeToggle'

export default async function LogPage() {
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
          <h1 className="text-lg font-semibold text-foreground">Quick log</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <p className="text-muted-foreground text-sm">Slice 3 stub — UI coming.</p>
      </main>
    </div>
  )
}
