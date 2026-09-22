import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'mm_b3t — Betting Tracker',
  description: 'Control profesional de apuestas deportivas',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#0a0f1a] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
