import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fetchMeals } from './actions'
import { FoodClient } from './FoodClient'
import './food.css'

export const maxDuration = 60

export default async function FoodPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const initialMeals = await fetchMeals(7)
  const llmAvailable = !!process.env.ANTHROPIC_API_KEY

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Food diary</h1>
          <span className="text-xs text-muted-foreground italic">
            Estimates — for pattern-spotting, not clinical counting
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        <FoodClient initialMeals={initialMeals} llmAvailable={llmAvailable} />
      </main>
    </div>
  )
}
