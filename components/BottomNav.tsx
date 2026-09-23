'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Dices, ArrowUpDown, BarChart3 } from 'lucide-react'

const items = [
  { name: 'Inicio',       href: '/dashboard',    icon: LayoutDashboard },
  { name: 'Apuestas',     href: '/bets',         icon: Dices },
  { name: 'Bankroll',     href: '/bankroll',     icon: ArrowUpDown },
  { name: 'Stats',        href: '/stats',        icon: BarChart3 },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-gray-700/60 bg-gray-900/95 backdrop-blur-xl safe-area-bottom">
      <div className="flex items-stretch h-16">
        {items.map(item => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                isActive ? 'text-emerald-400' : 'text-gray-500'
              )}
            >
              <item.icon className={cn('w-5 h-5', isActive && 'drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]')} />
              {item.name}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
