import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Win & Dine',
  description: 'Sports betting tracker by MM',
  appleWebApp: {
    capable: true,
    title: 'Win & Dine',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark">
      <head>
        <meta name="theme-color" content="#0a0f1a" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-screen bg-[#0a0f1a] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
