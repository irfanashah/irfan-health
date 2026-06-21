import type { Metadata } from 'next'
import { Inter, Geist, Manrope } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'
import { ThemeProvider } from 'next-themes'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

const inter = Inter({ subsets: ['latin'] })

// Dashboard typeface (Slice 7.1). The dashboard.css `.app` font-family
// references 'Manrope' explicitly; this loads the variable so it resolves
// instead of falling through to system-ui.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' })

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
    <html
      lang="en"
      className={cn('font-sans', geist.variable, manrope.variable)}
      suppressHydrationWarning
    >
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
