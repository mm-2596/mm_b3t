import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Win & Dine',
  description: 'Sports betting tracker by MM',
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
