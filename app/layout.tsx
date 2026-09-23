import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Win & Dine',
  description: 'Sports betting tracker by MM',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
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
