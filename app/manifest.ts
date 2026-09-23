import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Win & Dine',
    short_name: 'Win & Dine',
    description: 'Betting Tracker by MM',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0a0f1a',
    theme_color: '#0a0f1a',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}
