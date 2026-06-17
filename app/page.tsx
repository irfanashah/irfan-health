import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ThemeToggle } from '@/components/ThemeToggle'
import { DiagnoseButton } from '@/components/DiagnoseButton'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Health Platform</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/log"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Quick log →
          </Link>
          <ThemeToggle />
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <p className="text-muted-foreground text-sm">
          Signed in as {user.email}
        </p>
        <p className="text-muted-foreground/70 text-sm mt-2">
          Dashboard coming in Slice 7.
        </p>

        <DiagnoseButton />
      </main>
    </div>
  )
}
