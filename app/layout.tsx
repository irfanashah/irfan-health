import type { Metadata } from 'next'
import { Inter, Geist } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'
import { ThemeProvider } from 'next-themes'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

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
    <html
      lang="en"
      className={cn('font-sans', geist.variable)}
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
