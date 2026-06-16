# Slice 0 — Next.js Scaffold Implementation Spec

**For:** Claude Code  
**Date:** 2026-06-16  
**Project:** Irfan's personal health data platform  
**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS + Supabase  

---

## Context

This is a personal, single-user health data platform. The database already exists (a dedicated Supabase project). This slice creates the Next.js application that will serve as the dashboard and the host for all ingestion API routes.

Do not add multi-tenancy, sign-up flows, or any features beyond what is listed here. The goal of this slice is a working foundation: the app initialises, auth works, the dashboard is protected, and the Supabase clients are wired up correctly.

---

## What this spec produces

By the end of this spec, the following must work:

1. `npm run dev` starts the app with no errors.
2. Visiting `/` while unauthenticated redirects to `/login`.
3. Logging in with a valid Supabase email/password session redirects to `/`.
4. The dashboard at `/` shows "Health Platform" and a working Sign Out button.
5. Signing out redirects back to `/login`.
6. Visiting `/login` while already authenticated redirects to `/`.

---

## Step 1 — Initialise the project

Run this command in the `/Users/irfan/Documents/irfan-health/` directory:

```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

When prompted to overwrite existing files (the directory already contains `.md` and `.sql` files), choose **Yes** only for the files Next.js needs to create (`package.json`, `tsconfig.json`, etc.). Do not delete or overwrite the existing `.md` and `.sql` files.

After the project is created, install one additional package:

```bash
npm install @supabase/ssr @supabase/supabase-js
```

---

## Step 2 — Environment variables

Create a file named `.env.local` in the project root. This file is never committed to git.

```
NEXT_PUBLIC_SUPABASE_URL=<paste Project URL here>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon/public key here>
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key here>
```

The `NEXT_PUBLIC_` prefix makes the first two variables available in the browser. The service role key has no `NEXT_PUBLIC_` prefix — it must never reach the browser.

Also create `.env.local.example` in the project root (this one IS committed to git, as a reference):

```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Confirm `.env.local` is in `.gitignore`. Next.js adds it by default; verify it is present.

---

## Step 3 — Supabase client utilities

Create the directory `lib/supabase/` and the following three files inside it.

### `lib/supabase/client.ts`

Browser-side Supabase client. Use this in Client Components.

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### `lib/supabase/server.ts`

Server-side Supabase client. Use this in Server Components, Server Actions, and Route Handlers. Uses the anon key + user session (RLS applies).

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookie writes are a no-op here.
            // The middleware handles session refresh.
          }
        },
      },
    }
  )
}
```

### `lib/supabase/service.ts`

Service role client. Use this ONLY in server-side ingestion API routes. This key bypasses RLS — never expose it to the browser or import this file from any Client Component.

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase service role environment variables')
  }

  return createSupabaseClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
```

---

## Step 4 — Middleware

Create `middleware.ts` in the project root (next to `package.json`). This runs on every request and handles two jobs: session refresh (keeps the user logged in) and route protection (redirects unauthenticated users to `/login`).

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session. Must call getUser(), not getSession() — getSession()
  // reads from the cookie only and cannot detect an expired server-side session.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLoginPage = request.nextUrl.pathname.startsWith('/login')
  const isAuthCallback = request.nextUrl.pathname.startsWith('/auth/callback')

  // Not logged in and not already on login or callback → redirect to login
  if (!user && !isLoginPage && !isAuthCallback) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already logged in and trying to access login → redirect to dashboard
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

---

## Step 5 — Auth callback route

Create `app/auth/callback/route.ts`. This handles the redirect back from Supabase after email-based auth flows (email confirmation, magic links). Even though we are using password-only login right now, this route must exist or Supabase Auth will have nowhere to redirect to.

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
```

---

## Step 6 — Login page

Create `app/login/page.tsx`. This is a Client Component (needs interactivity). It renders a simple email/password form. On success, redirects to `/`. On failure, shows an inline error message. No sign-up link — this app has one user.

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-gray-900 mb-8 text-center">
          Health Platform
        </h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
                         focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
                         focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-gray-900 text-white text-sm font-medium
                       rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

---

## Step 7 — Root layout

Replace the contents of `app/layout.tsx` with this. Keep it minimal — no unnecessary providers or imports.

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Health Platform',
  description: 'Personal health data platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

---

## Step 8 — Dashboard page (placeholder)

Replace the contents of `app/page.tsx` with this. This is a Server Component. It reads the current user from the server-side Supabase client and renders the dashboard placeholder. The sign-out action is a Server Action.

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Health Platform</h1>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign out
          </button>
        </form>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <p className="text-gray-500 text-sm">
          Signed in as {user.email}
        </p>
        <p className="text-gray-400 text-sm mt-2">
          Dashboard coming in Slice 7.
        </p>
      </main>
    </div>
  )
}
```

---

## Step 9 — Create the adapters directory

Create an empty directory `adapters/` in the project root. Add a `.gitkeep` file inside it so git tracks the directory. This is where all source adapters will live from Slice 1 onward.

```
adapters/
└── .gitkeep
```

---

## Step 10 — Verify the build

Run:

```bash
npm run build
```

The build must complete with no TypeScript errors and no missing module errors. Fix any errors before considering this slice done.

Then run:

```bash
npm run dev
```

Manually test the following:

1. Visit `http://localhost:3000` → should redirect to `/login`.
2. Enter wrong credentials → should show an error message below the form.
3. Enter correct credentials (the account created in Supabase dashboard under Authentication → Users) → should redirect to `/` and show the dashboard.
4. Click Sign out → should redirect to `/login`.
5. Visit `http://localhost:3000/login` while logged in → should redirect to `/`.

All five must pass before this slice is complete.

---

## Step 11 — Create your Supabase user account

This step is done manually in the Supabase dashboard, not in code.

1. In the Supabase project dashboard, go to **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter Irfan's email address and a strong password.
4. Ensure **Auto Confirm User** is checked (so no email confirmation is needed).
5. Click **Create User**.

This is the only user account. There is no sign-up page in the app.

Also, in **Authentication → Providers**, disable email sign-up so no one can create additional accounts:
- Under **Email**, turn off **Enable email signups**.
- Leave **Enable Email provider** on (needed for login).

---

## Step 12 — Push to GitHub

A private GitHub repository named `irfan-health` has already been created at `https://github.com/<username>/irfan-health.git` (empty, no README). Run the following to initialise git and push:

```bash
git init
git remote add origin https://github.com/<username>/irfan-health.git
git add .
git commit -m "Slice 0: initial scaffold"
git branch -M main
git push -u origin main
```

Replace `<username>` with the actual GitHub username. After this push, the repository is ready to connect to Vercel.

---

## Step 13 — Vercel deployment

1. In Vercel, click **Add New Project** and import the GitHub repo.
3. Vercel will auto-detect Next.js. Accept all defaults.
4. Before deploying, go to **Environment Variables** in the Vercel project settings and add all three variables from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy. The build must succeed.
6. Test login on the Vercel URL — same five checks from Step 10.

---

## What this slice does NOT include

- Any database reads or writes from the app (that starts in Slice 1)
- Any dashboard UI (Slice 7)
- Any ingestion API routes (Slice 1)
- Any adapter code (Slice 1)
- OAuth login (Supabase password auth only — no Google/Apple sign-in)

---

## File tree at end of this slice

```
irfan-health/
├── adapters/
│   └── .gitkeep
├── app/
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts
│   ├── login/
│   │   └── page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   └── supabase/
│       ├── client.ts
│       ├── server.ts
│       └── service.ts
├── middleware.ts
├── .env.local                  ← not committed to git
├── .env.local.example          ← committed to git
├── .gitignore
├── health-platform-handover_v1_2026-06-16.md
├── health-platform-data-model-spec_v1_2026-06-16.md
├── migration_001_initial_schema.sql
├── slice-0-scaffold-spec.md    ← this file
├── next.config.ts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```
